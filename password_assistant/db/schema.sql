-- =============================================================================
-- SafeVault 云备份后端 — 数据库表结构（MySQL）
-- =============================================================================
-- 依据：SDD/SafeVault模块和接口设计 v1.0.md、SafeVault模块1-云账户与认证-时序图 v1.0.md
--
-- 核心约束（零知识 Zero-Knowledge）：
--   后端永不接触明文密码 / 明文数据。落库的只有「密码验证器」与「密文 blob」。
--   - account 表只存 password_verifier（如 SRP verifier 或「密码+服务端盐」慢哈希），
--     不存明文、不存可还原密钥；后端能验证身份，但拿不到 MasterKey。
--   - backup 表只存整库 AES-GCM 密文，服务端对 ciphertext 完全不透明。
--
-- 仅落库「持久化」数据；以下短时效状态全部走 Redis，不在本表内：
--   验证码 code:{email}（TTL 300s）、发码冷却 cooldown:{email}、登录失败计数
--   fail:{email}、refresh token 白名单 refresh:{userId}。
--
-- 字符集统一 utf8mb4；引擎统一 InnoDB（事务 + 外键）。
-- 二进制/盐/验证器等以 base64 文本存入 VARCHAR，编码由应用层负责。
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `safevault`
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE `safevault`;


-- -----------------------------------------------------------------------------
-- 模块 1：云账户与认证
-- -----------------------------------------------------------------------------
-- 应用唯一身份中枢。注册即建账户（不等「开启云备份」）；冷启动每次重新登录。
-- 对应接口：/auth/verify-code、/auth/register、/auth/login、/auth/refresh、
--           /auth/change-password、/auth/reset-password。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `account` (
    `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账户主键，即时序图中的 userId',
    `email`            VARCHAR(255)    NOT NULL                COMMENT '登录邮箱，已归一化（去空格 + 转小写）',
    `server_salt`      VARCHAR(128)    NOT NULL                COMMENT '服务端盐（base64），用于密码验证器的慢哈希；改密/重置时更新',
    `password_verifier` VARCHAR(1024)  NOT NULL                COMMENT '密码验证器（base64），如 SRP verifier 或「密码+server_salt」慢哈希；零知识，非明文、不可还原密钥',
    `kdf_params`       JSON            NOT NULL                COMMENT '本地密钥派生配方（algorithm/salt/iterations 等），换机后据此重算 MasterKey；后端仅透传，不参与计算',
    `status`           TINYINT         NOT NULL DEFAULT 1      COMMENT '账户状态：1=正常 0=停用（临时锁定走 Redis fail 计数，不落此字段）',
    `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT '注册时间',
    `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间（改密/重置会刷新）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_account_email` (`email`) COMMENT '邮箱唯一，注册查重 / 登录定位'
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '云账户：身份凭据（仅密码验证器，零知识）';


-- -----------------------------------------------------------------------------
-- 模块 2：加密备份 blob 存储（核心业务后端）
-- -----------------------------------------------------------------------------
-- 加密 blob 托管服务：每账户一份「整库密文快照」，覆盖式上传（无多设备同步/合并）。
-- 快照含活跃条目 + 回收站条目（保留 deletedAt），故软删除/恢复也触发上传。
-- 对应接口：PUT /backup、GET /backup、GET /backup/meta、DELETE /backup。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `backup_blob` (
    `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `account_id`  BIGINT UNSIGNED NOT NULL                COMMENT '归属云账户，鉴权后据此定位（换机后同账户登录即可取回）',
    `ciphertext`  LONGBLOB        NOT NULL                COMMENT '整库 JSON 经 AES-GCM 加密后的密文本体；服务端永不解析，仅校验大小上限',
    `kdf_params`  JSON            NOT NULL                COMMENT '密钥派生配方（明文），换机后据此重算 DataKey 包裹密钥',
    `version`     BIGINT UNSIGNED NOT NULL                COMMENT '单调递增版本号；服务端拒绝旧版本覆盖新版本（防回退/并发误写）',
    `checksum`    CHAR(64)        NOT NULL                COMMENT 'ciphertext 的 SHA-256 十六进制摘要，校验传输/存储未损坏',
    `size_bytes`  INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '密文字节数，供 GET /backup/meta 展示与计费',
    `valid`       TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '是否可解密：决策点 C1 重置密码后置 0（旧 blob 不可解密，提示用户重新上传）',
    `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT '首次备份时间',
    `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后备份时间（GET /backup/meta 的「上次备份」）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_backup_account` (`account_id`) COMMENT '每账户仅一份最新快照（覆盖式）',
    CONSTRAINT `fk_backup_account` FOREIGN KEY (`account_id`)
        REFERENCES `account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '加密备份：每账户一份整库密文快照（零知识，覆盖式）';


-- -----------------------------------------------------------------------------
-- 模块 3：恢复凭据（key escrow）—— 仅决策点 C2 启用
-- -----------------------------------------------------------------------------
-- 注册时额外生成「恢复凭据（恢复码/助记词）」包裹一份 DataKey；忘记密码重置后，
-- 用恢复凭据解出 DataKey，再以新密码重新包裹，避免云备份丢失。仍是密文，零知识不破。
-- 决策点 C 若选 C1（接受丢失）/ C3（邮箱托管），本表可不建。
-- 对应接口：POST /backup/recovery-blob、GET /backup/recovery-blob。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `recovery_blob` (
    `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `account_id`       BIGINT UNSIGNED NOT NULL                COMMENT '归属云账户',
    `wrapped_data_key` VARBINARY(512)  NOT NULL                COMMENT '被 RecoveryKey 包裹的 DataKey 密文；服务端不透明',
    `kdf_params`       JSON            NOT NULL                COMMENT '恢复凭据的密钥派生配方，重置后据此从恢复码重算 RecoveryKey',
    `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT '创建时间',
    `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_recovery_account` (`account_id`) COMMENT '每账户一份恢复凭据 blob',
    CONSTRAINT `fk_recovery_account` FOREIGN KEY (`account_id`)
        REFERENCES `account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '恢复凭据：用恢复码包裹的 DataKey 副本（仅决策点 C2 启用）';
