"""应用配置：统一从环境变量 / .env 读取。

所有可调参数集中在此，业务代码只依赖 settings，不直接读 os.environ。
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env 绝对路径：以本文件位置为锚（config.py 在 password_assistant/app/，.env 在其上一级
# password_assistant/），使服务无论从 app/ 还是工程根启动都能读到同一份配置，
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

    # ---------- 阿里云 OSS（模块2：加密备份 blob 存储）----------
    # 密文 blob 存 OSS（不进 MySQL），MySQL 只存元信息（object_key 等）。
    # endpoint / bucket 走环境变量；access key 默认空串，生产经 .env 注入（切勿硬编码）。
    # 测试 / 无凭据联调时保持空串：业务不在导入期连 OSS，OSS 客户端在 lifespan 显式 init，
    # 单测用 fake 替身注入 oss_client 模块单例，不真连阿里云。
    oss_endpoint: str = ""            # 如 https://oss-cn-hangzhou.aliyuncs.com
    oss_bucket: str = ""              # OSS bucket 名
    oss_access_key_id: str = ""       # AccessKey ID（生产经环境变量注入）
    oss_access_key_secret: str = ""   # AccessKey Secret（生产经环境变量注入，严禁入库 / 入日志）

    # ---------- 备份体积上限（模块2 PUT /backup）----------
    # ciphertext（base64 文本）解出的原始密文字节数上限，超限抛 413「备份体积超限」。
    # 默认 5MB：整库密码 JSON 加密后通常远小于此，留足余量同时挡住异常超大上传 / 滥用。
    backup_max_size_bytes: int = 5 * 1024 * 1024

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

    # ---------- 服务端密码验证器二次哈希（零知识落库）----------
    # 客户端传来的 verifier 已是「明文密码本地派生」的产物（后端拿不到明文）；
    # 落库前再叠加 server_salt 用 PBKDF2-HMAC-SHA256 慢哈希一次，
    # 即便库泄露也无法离线爆破出 verifier 本身。迭代次数兼顾安全与登录校验耗时。
    verifier_hash_iterations: int = 200_000

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
