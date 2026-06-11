import anyio

from client.oss_client import get_client
from config import settings


async def put_object(key: str, data: bytes) -> None:
    """覆盖写一个对象（整库密文 blob）到对象存储。

    用 anyio.to_thread.run_sync 把同步阻塞的 boto3 put_object 丢到线程池，避免阻塞事件循环。
    S3 的 put_object 对同名 key 默认即覆盖写，符合「每账户一份最新快照」的覆盖式上传语义。

    :param key: 对象 key（如 backup/123）
    :param data: 密文字节（ciphertext base64 解码后的原始字节），服务端不透明、按字节存储
    :raises RuntimeError: 对象存储未初始化 / 未配置
    :raises botocore.exceptions.ClientError: 服务端错误（鉴权失败 / 桶不存在 / 配额等），由上层兜底处理
    """
    _client = get_client()
    bucket = settings.oss_bucket
    # to_thread.run_sync 仅接受位置参数，故用 lambda 适配 boto3 的关键字参数调用。
    await anyio.to_thread.run_sync(
        lambda: _client.put_object(Bucket=bucket, Key=key, Body=data)
    )


async def get_object(key: str) -> bytes:
    """读取一个对象（整库密文 blob）的原始字节（模块 2 GET /backup 用）。

    与 put_object 同风格：用 anyio.to_thread.run_sync 把同步阻塞的 boto3 get_object 丢到线程池，
    避免阻塞事件循环。返回的是对象存储里存的「ciphertext base64 解码后的原始字节」（见 upload_backup
    写入逻辑），调用方（services.backup.download_backup）需重新 base64 编码成文本再返回前端契约。

    零知识：服务端只按字节取回，永不解析密文结构。

    :param key: 对象 key（如 backup/123）
    :returns: 对象的原始字节（ciphertext 解码后的字节）
    :raises RuntimeError: 对象存储未初始化 / 未配置（由 get_client 负责兜底抛出）
    :raises botocore.exceptions.ClientError: 对象不存在 / 鉴权失败 / 桶不存在等，由上层兜底处理
    """
    _client = get_client()
    bucket = settings.oss_bucket
    # to_thread.run_sync 仅接受位置参数，故用 lambda 适配 boto3 的关键字参数调用；
    # resp["Body"] 是流式响应体（StreamingBody），整体 read() 取回全部字节（密文体量可控，一次读完）。
    resp = await anyio.to_thread.run_sync(
        lambda: _client.get_object(Bucket=bucket, Key=key)
    )
    return resp["Body"].read()
