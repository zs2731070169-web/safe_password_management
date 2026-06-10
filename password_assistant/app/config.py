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
