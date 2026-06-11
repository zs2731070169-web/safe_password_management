"""S3 兼容对象存储客户端管理（模块 2：加密备份 blob 存储）。

默认对接自建 MinIO（零成本、零外部依赖），同一套 boto3 S3 客户端亦可直接连
Cloudflare R2 / Backblaze B2 / AWS S3——仅 endpoint/AK/SK/region 不同。沿用 oss_* 命名与
init_oss/put_object 等函数名仅为兼容既有引用，语义已是「通用 S3 兼容对象存储」，与阿里云无关。

与 redis_client / db_client 一致：进程内维护单个全局 boto3 S3 client 单例，FastAPI 在
lifespan 启动时 init_oss()、关闭时 close_oss()；worker 进程同样可复用 init_oss / get_client。

零知识：本客户端只按字节存取整库密文 blob（ciphertext），服务端永不解析其结构。

同步 SDK 包裹说明：boto3 为**同步阻塞** SDK，直接在 async 事件循环里调用会阻塞整个 worker。
故所有实际网络 IO（put_object）统一用 `anyio.to_thread.run_sync` 丢到线程池执行，避免阻塞
事件循环，与 FastAPI async 链路共存。

MinIO 兼容要点：MinIO（及多数自建 S3）只支持 **path-style** 寻址（http://host/bucket/key），
而 boto3 默认走 virtual-host-style（http://bucket.host）对 MinIO 不可用，故显式配置
`addressing_style="path"` 与 `signature_version="s3v4"`。连 R2/AWS S3 时该配置同样兼容。

缺配置降级：endpoint / bucket / access_key 任一为空即视为「未配置对象存储」——init_oss 仅
logger.warning 并把单例置 None、**不抛错、不阻断应用启动**，使认证等其它模块照常工作；
此时调用 put_object 会显式抛 RuntimeError 提示先配置对象存储。
"""
from __future__ import annotations

import logging

import boto3
from botocore.client import BaseClient as S3Client
from botocore.config import Config

from config import settings

logger = logging.getLogger("safevault.oss")

# 模块级单例：boto3 S3 client。init_oss() 前为 None；缺配置时 init 后仍为 None（降级，不阻断启动）。
_client: S3Client | None = None


def _oss_configured() -> bool:
    """判定对象存储必填项是否齐全（endpoint / bucket / AK / SK 均非空）。"""
    return bool(
        settings.oss_endpoint
        and settings.oss_bucket
        and settings.oss_access_key_id
        and settings.oss_access_key_secret
    )


async def init_oss() -> S3Client | None:
    """创建并缓存全局 boto3 S3 client 单例（幂等）。

    在 FastAPI lifespan 启动阶段调用。缺配置（密钥 / endpoint / bucket 任一为空）时**仅告警、
    不抛错**，置单例为 None 并返回 None，使其它模块照常工作；配置齐全则用 AK/SK 构造 client。

    注意：boto3.client(...) 是纯本地对象创建（不发起网络请求、不建连接），耗时极低，无需丢线程池；
    真正的网络 IO（put_object 等）才需 anyio.to_thread 包裹。

    :returns: 已就绪的 boto3 S3 client；缺配置时为 None
    """
    global _client
    if _client is not None:
        return _client

    if not _oss_configured():
        # 降级：缺配置不阻断启动，仅告警。备份接口被调用时再由 put_object 显式报错。
        logger.warning(
            "对象存储未配置（endpoint/bucket/access_key 缺失），加密备份上传将不可用；"
            "其它模块照常工作。请在 .env 补齐 OSS_* 配置（默认指向自建 MinIO）后重启。"
        )
        _client = None
        return None

    _client = boto3.client(
        "s3",
        endpoint_url=settings.oss_endpoint,
        region_name=settings.oss_region,
        aws_access_key_id=settings.oss_access_key_id,
        aws_secret_access_key=settings.oss_access_key_secret,
        # MinIO 等自建 S3 只支持 path-style 寻址；s3v4 为通用签名版本（MinIO/R2/AWS 均兼容）。
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )
    logger.info(
        "对象存储已初始化：endpoint=%s bucket=%s", settings.oss_endpoint, settings.oss_bucket
    )
    return _client


def get_client() -> S3Client:
    """获取已初始化的 boto3 S3 client；未初始化 / 未配置则抛错提醒先 init 或补配置。

    :raises RuntimeError: 对象存储尚未初始化或缺配置（备份功能不可用）
    """
    if _client is None:
        raise RuntimeError("对象存储尚未初始化或未配置，无法进行加密备份上传")
    return _client


async def close_oss() -> None:
    """释放对象存储单例引用，供 lifespan 收尾调用。

    boto3 client 底层基于连接池，无强制显式关闭接口；这里仅置空单例引用，交由 GC 回收连接，
    与 redis_client / db_client 的 close 风格保持一致。
    """
    global _client
    _client = None
