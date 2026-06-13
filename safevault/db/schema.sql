-- =============================================================================
-- SafeVault 云备份后端 — 数据库表结构（MySQL）
-- =============================================================================
-- 依据：SDD/SafeVault模块和接口设计 v1.0.md、SafeVault模块1-云账户与认证-时序图 v1.0.md
--
-- 核心约束（零知识 Zero-Knowledge）：
--   后端永不接触明文密码 / 明文数据。落库的只有「密码验证器」与「密文 blob 的元信息」。
--   - account 表只存 password_verifier（如 SRP verifier 或「密码+服务端盐」慢哈希），
--     不存明文、不存可还原密钥；后端能验证身份，但拿不到 MasterKey。
--   - backup_blob 表只存「元信息」（object_key/version/checksum/size/kdf_params）——
--     **整库 AES-GCM 密文本体存阿里云 OSS，不进 MySQL**；服务端对密文完全不透明。
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
    `server_salt`      VARCHAR(128)    NOT NULL                COMMENT '服务端盐（base64），用于明文密码的服务端慢哈希；改密/重置时更新',
    `password_verifier` VARCHAR(1024)  NOT NULL                COMMENT '口令慢哈希（base64）：客户端非对称封装上送、后端解封得明文后叠加 server_salt 的 PBKDF2 摘要；非明文、不可还原。列名沿用兼容',
    `kdf_params`       JSON            NOT NULL                COMMENT '账户体系标记（JSON，如 {"scheme":"sealed-v1"}）；认证零知识废除后不参与计算，仅满足 NOT NULL 并留痕',
    `status`           TINYINT         NOT NULL DEFAULT 1      COMMENT '账户状态：1=正常 0=停用（临时锁定走 Redis fail 计数，不落此字段）',
    `token_version`    BIGINT UNSIGNED NOT NULL DEFAULT 1      COMMENT '令牌版本号：access 签发时写入 payload(tv)，每次鉴权比对账户当前值，不一致即拒；改密/重置时自增 → 旧 access 立即失效。运行期缓存到 Redis(tokenver:{userId})',
    `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT '注册时间',
    `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间（改密/重置会刷新）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_account_email` (`email`) COMMENT '邮箱唯一，注册查重 / 登录定位'
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '云账户：身份凭据（口令服务端慢哈希落库，非明文）';

-- -----------------------------------------------------------------------------
-- 模块 2：加密备份 blob 存储（核心业务后端）
-- -----------------------------------------------------------------------------
-- 加密 blob 托管服务：每账户一份「整库密文快照」，覆盖式上传（无多设备同步/合并）。
-- 快照含活跃条目 + 回收站条目（保留 deletedAt），故软删除/恢复也触发上传。
-- 对应接口：PUT /backup、GET /backup、GET /backup/meta、DELETE /backup。
--
-- 【存储分工：OSS + MySQL】（相对早期「ciphertext 直存 LONGBLOB」的调整）
--   整库 AES-GCM 密文本体存**阿里云 OSS**（对象 key = `backup/{account_id}`，覆盖写），
--   本表只存指向该对象的**元信息**：object_key + version + checksum + size + kdf_params。
--   理由：① 大 blob 进 OSS 更省 DB 空间、读写更快、天然支持生命周期治理；
--        ② MySQL 只当「最新有效快照的权威指针」，元信息轻量、查询快（meta 接口高频）；
--        ③ 零知识不变：OSS 与本表都拿不到明文，后端永不解析 ciphertext。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `backup_blob` (
    `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `account_id`  BIGINT UNSIGNED NOT NULL                COMMENT '归属云账户，鉴权后据此定位（换机后同账户登录即可取回）',
    `object_key`  VARCHAR(255)    NOT NULL                COMMENT '密文 blob 在 OSS 的对象 key（如 backup/123）；密文本体存 OSS 不进本表',
    `kdf_params`  JSON            NOT NULL                COMMENT '「密码包裹 DataKey」的 KDF 配方（明文），客户端据此重算包裹密钥解开 wrapped_data_key',
    `wrapped_data_key` TEXT       NULL                    COMMENT '「密码包裹的 DataKey」密文（base64）；随机 DataKey 被密码派生密钥 AES-GCM 包裹后的产物，客户端用密码解开它拿回 DataKey。零知识，后端不解析',
    `version`     BIGINT UNSIGNED NOT NULL                COMMENT '单调递增版本号；服务端拒绝旧版本覆盖新版本（防回退/并发误写）',
    `checksum`    CHAR(64)        NOT NULL                COMMENT 'ciphertext 的 SHA-256 十六进制摘要，校验传输/存储未损坏',
    `size_bytes`  INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '密文字节数，供 GET /backup/meta 展示与计费',
    `valid`       TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '是否可解密：恒置 1（决策点 C2 包裹式密钥下重置不再置 0，旧 blob 可经恢复码恢复）；保留作未来作废位',
    `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT '首次备份时间',
    `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后备份时间（GET /backup/meta 的「上次备份」）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_backup_account` (`account_id`) COMMENT '每账户仅一份最新快照（覆盖式）',
    CONSTRAINT `fk_backup_account` FOREIGN KEY (`account_id`)
        REFERENCES `account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '加密备份元信息：每账户一份整库密文快照的指针（密文存 OSS，零知识，覆盖式）';


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
    `wrapped_data_key` TEXT            NOT NULL                COMMENT '「恢复码包裹的 DataKey」密文（base64）；重置时客户端用恢复码解开它拿回 DataKey。零知识，后端不解析',
    `kdf_params`       JSON            NOT NULL                COMMENT '「恢复码包裹密钥」的 KDF 配方（明文），重置后据此从恢复码重算包裹密钥',
    `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT '创建时间',
    `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_recovery_account` (`account_id`) COMMENT '每账户一份恢复凭据 blob',
    CONSTRAINT `fk_recovery_account` FOREIGN KEY (`account_id`)
        REFERENCES `account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '恢复凭据：用恢复码包裹的 DataKey 副本（决策点 C2，已启用）';
