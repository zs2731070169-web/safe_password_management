"""应用配置：统一从环境变量 / .env 读取。

所有可调参数集中在此，业务代码只依赖 settings，不直接读 os.environ。
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env 绝对路径：以本文件位置为锚（config.py 在 safevault/app/，.env 在其上一级
# safevault/），使服务无论从 app/ 还是工程根启动都能读到同一份配置，
# 不再依赖进程当前工作目录。
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    """后端运行配置。字段名大小写不敏感，对应 .env 中的同名变量。"""

    # ---------- MySQL ----------
    # 主库：云账户/认证（模块1）、加密备份 blob（模块2）、恢复凭据（模块3 C2）。
    # 用 asyncmy 异步驱动，与 FastAPI async 链路一致。
    database_url: str = "mysql+asyncmy://safevault:safevault@localhost:3306/safevault"
    # SQL 回显开关：本地排查可置 true 打印执行的 SQL
    db_echo: bool = False
    # ---- 连接池（async 引擎默认走 QueuePool；以下参数显式可调）----
    db_pool_size: int = 10        # 连接池常驻连接数（高并发时的稳态容量）
    db_max_overflow: int = 20     # 峰值时允许在 pool_size 之上临时溢出的连接数
    db_pool_timeout: int = 30     # 池满时获取连接的最长等待秒数，超时抛 TimeoutError
    db_pool_recycle: int = 3600   # 连接最长存活秒数，规避 MySQL wait_timeout 主动断连

    # ---------- Redis ----------
    redis_url: str = "redis://localhost:6379/0"

    # ---------- RabbitMQ ----------
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    mail_queue: str = "mail.verify_code"
    # 具名持久化交换机（direct）：取代 AMQP 默认交换机，broker 重启后仍在；
    # 队列以 routing_key=队列名 绑定其上。收发两端声明参数须一致。
    mail_exchange: str = "safevault.mail"

    # ---------- Brevo 邮件发送（HTTP API，注册免信用卡，验证发件邮箱即可发任意收件人）----------
    brevo_api_key: str = ""               # Brevo 后台 SMTP & API → API Keys 生成的 v3 API Key
    brevo_sender_email: str = ""          # 已在 Brevo 验证的发件邮箱（或自有域名下地址）
    brevo_sender_name: str = "SafeVault"  # 发件人显示名称
    # 发信代理：本机联调访问境外 api.brevo.com 时填本地代理（如 http://127.0.0.1:7890）；
    # 留空则直连。仅作用于发信请求，且发信不再隐式读取系统代理环境变量（见 worker/brevo_mail.py）。
    mail_proxy: str = ""

    # ---------- 验证码策略 ----------
    code_ttl: int = 300       # 验证码有效期（秒）
    cooldown_ttl: int = 60    # 同邮箱发码冷却（秒）

    # ---------- JWT（Token 服务）----------
    # 签名密钥：开发用默认值，生产必须经环境变量 JWT_SECRET 覆盖（切勿沿用此默认）。
    # 对称 HS256：access / refresh 共用一把密钥，足够单体认证服务使用。
    jwt_secret: str = "dev-only-insecure-change-me-in-production"
    jwt_algorithm: str = "HS256"
    # access token 短时效（分钟），对齐时序图 §2「access(15min)」
    access_token_ttl_minutes: int = 15
    # refresh token 长时效（天），对齐时序图 §2「refresh(30d)」
    refresh_token_ttl_days: int = 30
    # 令牌版本号（token_version）的 Redis 缓存 TTL（秒）。每次 access 鉴权都要比对账户当前
    # token_version，缓存到 Redis(tokenver:{userId}) 降低 DB 压力；缓存未命中回库读一次并回填。
    # 取较长 TTL（默认 7 天）即可，因改密 / 重置自增时会主动刷新缓存，不依赖 TTL 失效保证一致性。
    token_version_cache_ttl: int = 604_800

    # ---------- 服务端口令二次哈希（落库）----------
    # 认证已改为「客户端用服务端公钥非对称封装明文密码上送 → 后端解封得明文 → 叠加 server_salt
    # 用 PBKDF2-HMAC-SHA256 慢哈希一次后落库」（见 services/seal.py、services/password_hash.py）。
    # 慢哈希使得即便库泄露也无法离线爆破出明文口令。迭代次数兼顾安全与登录校验耗时。
    # 字段名沿用 verifier_hash_iterations 仅为兼容既有 .env / 引用，语义即「口令落库慢哈希迭代数」。
    verifier_hash_iterations: int = 200_000

    # ---------- 认证非对称封装（sealed-box：X25519 + HKDF-SHA256 + AES-256-GCM）----------
    # 登录提速方案：替换「客户端本地 PBKDF2 派生 verifier」的零知识认证，改为客户端用服务端 X25519
    # 公钥把明文密码封装（ECIES）后上送，后端用本私钥解封得明文再慢哈希比对/落库。保险库的零知识
    # 加密与 DataKey 派生不受影响（仍在客户端本地完成）。
    #
    # seal_private_key：服务端 X25519 私钥（32 字节原始私钥的 base64）。**开发用默认值，生产必须经
    # 环境变量 SEAL_PRIVATE_KEY 覆盖**（切勿沿用此默认；泄露即可解开所有上送的密码封装）。
    # 对应公钥由私钥推导，经 GET /auth/seal-pubkey 公开下发给客户端（公钥公开不损安全）。
    seal_private_key: str = "EgdiQg6O6rfmItSGym7+2FhkUgCPdnGu4hPIlfp15jk="

    # ---------- 注册接口限流（替代网关，按 IP 维度）----------
    register_rate_limit_ip_per_window: int = 10  # 单 IP 每窗口最大注册尝试次数

    # ---------- 忘记密码重置接口限流（§6，替代网关，按 IP 维度）----------
    # 重置须先收到发往邮箱的真验证码才走得通，正常用户极低频；阈值收紧防滥用 / 撞验证码。
    reset_rate_limit_ip_per_window: int = 10  # 单 IP 每窗口最大重置尝试次数

    # ---------- 登录接口（§3 登录解锁）----------
    # 登录失败计数与临时锁定（按邮箱维度，走 Redis fail:{email}）：
    # 失败次数 >= 阈值即锁定，对外 423；每次失败都续期 TTL，攻击持续期间保持锁定窗口。
    login_fail_threshold: int = 5    # 失败锁定阈值（达到即锁定）
    login_fail_ttl: int = 900        # fail:{email} 计数 TTL（秒），15min 后自动解锁
    # 登录限流（替代网关，按 IP 维度）：独立 key 前缀，避免与发码 / 注册限流互相影响
    login_rate_limit_ip_per_window: int = 20  # 单 IP 每窗口最大登录尝试次数

    # ---------- MQ 幂等 ----------
    # 已成功处理的消息标记在 Redis 的保留时长（秒）。只需覆盖消息可能被重投 / 重投递的
    # 时间窗口即可，默认 24h；标记存在即说明该消息已成功消费过，重复投递将被跳过。
    idempotent_ttl: int = 86400

    # ---------- 限流 ----------
    rate_limit_window: int = 60            # 滑动窗口长度（秒）
    rate_limit_email_per_window: int = 5   # 单邮箱每窗口最大发码次数
    rate_limit_ip_per_window: int = 20     # 单 IP 每窗口最大发码次数

    # ---------- S3 兼容对象存储（模块 2：加密备份 blob 存储）----------
    # 整库 AES-GCM 密文本体存 S3 兼容对象存储（对象 key = `{oss_key_prefix}/{userId}`，覆盖写），
    # 后端对密文完全不透明、永不解析。默认对接自建 MinIO（零成本、零外部依赖）；同一套配置亦可
    # 直接连 Cloudflare R2 / Backblaze B2 / AWS S3——只是 endpoint/AK/SK 换成对应服务的值。
    # 密钥默认空字符串：缺配置时 init_oss 仅告警不阻断启动（见 client/oss_client.py），
    # 认证等其它模块照常工作。
    #
    # 字段沿用 oss_* 前缀仅为兼容既有引用与 .env，语义已是「通用 S3 兼容对象存储」，与阿里云无关。
    # endpoint 须为带 scheme 的完整 URL（MinIO 形如 http://127.0.0.1:9000；R2/S3 用对应 https 端点）。
    oss_endpoint: str = ""             # S3 端点 URL（带 scheme，如 http://127.0.0.1:9000）
    oss_region: str = "us-east-1"      # 区域名（boto3 必填；MinIO 可任意值，R2 填 auto，S3 填真实区域）
    oss_bucket: str = ""               # Bucket 名称
    oss_access_key_id: str = ""        # 访问密钥 ID（MinIO 的 root user 或独立 access key）
    oss_access_key_secret: str = ""    # 访问密钥 Secret（敏感，切勿提交真实值）
    oss_key_prefix: str = "backup"     # 对象 key 前缀，最终 key = `{prefix}/{userId}`

    # 上传备份的密文体积上限（字节，对 ciphertext base64 解码后的原始长度判定）。
    # 默认 5 MiB：整库 JSON 经 AES-GCM 加密后通常远小于此，足够覆盖大量条目 + 回收站；
    # 超限抛 BackupTooLargeError(413)，前端据此提示清理过多条目 / 附件。
    backup_max_size_bytes: int = 5 * 1024 * 1024

    # ---------- CORS（跨域）----------
    # 允许跨域访问的前端来源，逗号分隔；默认 "*" 放行所有来源（开发联调友好）。
    # H5（浏览器）以绝对地址跨源访问后端时需要它；App（uni.request 原生请求）不走 CORS、无影响。
    # 本服务认证走 Authorization: Bearer 头（非 Cookie），无需携带凭据，故可安全使用 "*"。
    # 生产收紧时用 .env 的 CORS_ALLOW_ORIGINS 指定白名单（如 "https://app.example.com,https://www.example.com"）。
    cors_allow_origins: str = "*"

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """单例配置。lru_cache 确保整个进程只解析一次 .env。"""
    return Settings()


# 模块级单例，方便直接 import 使用
settings = get_settings()
