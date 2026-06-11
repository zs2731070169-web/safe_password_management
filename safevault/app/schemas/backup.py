"""加密备份模块的请求 / 响应模型（模块 2，PUT /backup 上传 + GET /backup 下载 + GET /backup/meta 元信息）。

零知识：`ciphertext` 是客户端本地用 DataKey 加密整库（含回收站）后的 AES-GCM 密文（base64 文本），
后端**永不解析**；`kdfParams` / `version` / `checksum` 为可读的明文元信息。

字段名约定（重要）：请求体字段对齐前端契约与时序图，用 **camelCase**（`kdfParams`）；落库列名
则为 snake_case（`kdf_params`），转换在路由 / service 边界完成。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class BackupUploadRequest(BaseModel):
    """上传整库快照请求体，对齐时序图 §1 `{ ciphertext, kdfParams, version, checksum }`。

    覆盖式上传：每账户一份最新整库密文快照。后端按 §1 顺序处理：体积上限校验 → checksum 格式
    校验 → 单调 version 防回退 → 先写 OSS 再 UPSERT 元信息。
    """

    # 整库 AES-GCM 密文（base64 文本）。min_length=16 拦截明显空 / 残缺值；max_length 给一个宽松
    # 的字符级上限（base64 膨胀约 4/3，约 8MiB 文本对应约 6MiB 原始字节），真正的**原始字节**上限
    # 由 service 对 base64 解码后的长度按 settings.backup_max_size_bytes 精确判定（413）。
    ciphertext: str = Field(min_length=16, max_length=8 * 1024 * 1024)
    # 「密码包裹的 DataKey」密文（base64 文本）。包裹式密钥方案下，整库由随机 DataKey 加密，DataKey 再被
    # 「密码派生的包裹密钥」加密成本字段，与整库密文一同上传。后端零知识、永不解析，原样落库 wrapped_data_key。
    # 长度约束：base64 文本，几十~上百字符（如 32B DataKey + 12B nonce + 16B tag ≈ 60B → base64 约 80 字符）；
    # min/max 给宽松边界，挡明显空/残缺与异常超大值，不强约束具体算法长度。
    wrappedDataKey: str = Field(min_length=16, max_length=4096)
    # 「密码包裹 DataKey」的 KDF 配方（明文）：换机后据此从密码重算包裹密钥，解开 wrappedDataKey 拿回 DataKey；
    # 后端仅透传存储，不解析语义。请求体用 camelCase `kdfParams`，落库列名 snake_case `kdf_params`。
    kdfParams: dict[str, Any]
    # 单调递增版本号（≥1）：服务端拒绝旧 / 乱序请求覆盖新快照（防回退 / 重试误写）。
    version: int = Field(ge=1)
    # ciphertext 的 SHA-256 十六进制摘要：此处仅约束长度（64），合法 hex 字符与大小写归一化的
    # 精确校验放在 service 层，以便格式非法时返回 **400「校验值非法」**（schema 校验器会默认 422）。
    checksum: str = Field(min_length=64, max_length=64)
    # 显式「用本机数据覆盖云端」开关（换机兜底），默认 False：
    # - False（默认 / 自动备份链路）：走单调 version 防回退，version ≤ 云端 → 409（客户端静默丢弃乱序旧请求）。
    # - True（用户在新设备二次确认后的一次性人为决策）：绕过版本序检查、无条件覆盖，并由 service
    #   把落库 version 重置为 max(version, 云端+1) 重建单调基线（客户端据返回 version 同步本地）。
    # 绝不在自动备份链路里默认携带 force，仅在显式「用本机覆盖云端」交互中置 True。
    force: bool = False


class BackupUploadResponse(BaseModel):
    """上传整库快照响应体，对齐时序图 §1 `200 { version, updatedAt }`。

    `version` 为本次成功落库的版本号；`updatedAt` 为元信息的最后更新时间（UPSERT 后的 updated_at），
    供前端更新「上次备份」展示。datetime 经 FastAPI 默认 JSON 编码为 ISO 8601 字符串。
    """

    version: int
    updatedAt: datetime


class BackupDownloadResponse(BaseModel):
    """下载最新整库快照响应体，对齐时序图 §2 `200 { ciphertext, kdfParams, version, checksum }`。

    重装 / 换机后「从云端恢复」：后端只取 blob + 必要明文元信息原样返回，**解密在客户端本地**
    （用云账户密码经 kdfParams 重算 DataKey）。严格按 §2 只返回这四个字段——`valid`（决策点 C1
    重置密码置 0）属模块 3 范畴，本接口不过滤、不纳入响应。

    字段名约定（重要）：响应体对齐前端契约与时序图，用 **camelCase**（`kdfParams`）；库内列名为
    snake_case（`kdf_params`），转换在 service 边界完成。`ciphertext` 是对象存储取回的原始字节
    **重新 base64 编码** 后的文本（前端契约 ciphertext 为 base64 文本），后端永不解析其内容。
    """

    # 整库 AES-GCM 密文（base64 文本）：由对象存储取回的原始字节重新 base64 编码而来；客户端先解开下方
    # wrappedDataKey 拿回 DataKey，再用 DataKey 本地解密还原整库（含回收站）。后端零知识、永不解析。
    ciphertext: str
    # 「密码包裹的 DataKey」密文（base64 文本）：客户端用密码经 kdfParams 重算包裹密钥解开它拿回 DataKey；
    # 由库内 snake_case `wrapped_data_key` 映射而来。后端永不解析。
    wrappedDataKey: str
    # 「密码包裹 DataKey」的 KDF 配方（明文）：客户端据此从密码重算包裹密钥；由库内 snake_case `kdf_params` 映射而来。
    kdfParams: dict[str, Any]
    # 该快照的版本号：客户端据此把本地「上次成功落库 version」同步为云端值，避免后续上传被防回退判 409。
    version: int
    # ciphertext 的 SHA-256 十六进制摘要（64 位 hex）：客户端可本地校验未损坏（后端不重算）。
    checksum: str


class BackupMetaResponse(BaseModel):
    """仅取元信息响应体，对齐时序图 §3 `GET /backup/meta`。

    用途：设置页云账户卡片展示「上次备份：刚刚 · 12 KB · v8」，只需轻量元信息，**不拉 blob、不查 OSS**。
    故响应**不含** ciphertext / checksum / kdfParams（与 §2 下载刻意区分：下载才返回密文与派生配方）。

    无备份 / 命中两态共用同一模型（用 `hasBackup` 区分），且无备份时同样返回 **200**（非 404）——
    这与 §2 下载「无备份返回 404」是刻意的语义区分：meta 是「查询是否有备份」的轻量探测，
    «没有» 本身就是一个正常结果而非错误；下载则是「取回备份内容」，无内容可取才视作 404。

    字段名约定（重要）：对外用 camelCase（`updatedAt`），库列名为 snake_case（`updated_at` / `size_bytes`），
    转换在 service 边界完成（见 services/backup.get_backup_meta）。
    """

    # 是否存在云端备份。无备份 → False（其余字段为 None）；命中 → True（其余字段有值）。
    hasBackup: bool
    # 当前云端快照的版本号（命中时有值）。供卡片展示「v8」并辅助用户判断本地/云端新旧。
    version: int | None = None
    # 密文原始字节数（命中时有值），取库列 size_bytes。前端格式化为「12 KB」展示。
    size: int | None = None
    # 元信息最后更新时间（命中时有值），取库列 updated_at。datetime 经 FastAPI 默认编码为 ISO 8601；
    # 前端格式化为「刚刚 / x 分钟前」相对时间。
    updatedAt: datetime | None = None


class RecoveryBlobUploadRequest(BaseModel):
    """上传「恢复码包裹的 DataKey」请求体（PUT /backup/recovery-blob，覆盖式，每账户一份）。

    包裹式密钥方案下，随机 DataKey 除被密码包裹（随 backup 上传）外，再被**恢复码**包裹一份独立存放，
    使忘记密码走重置（决策点 C2）后仍能用恢复码解出 DataKey、以新密码重新包裹，旧整库密文无需重传。
    开户/设恢复码时上传一次，后续可覆盖式更新。后端零知识、永不解析 wrappedDataKey。

    字段名约定：请求体对外 camelCase（`wrappedDataKey` / `kdfParams`），落库列 snake_case
    （`wrapped_data_key` / `kdf_params`），转换在路由 / service 边界完成。
    """

    # 「恢复码包裹的 DataKey」密文（base64 文本）。约束同 BackupUploadRequest.wrappedDataKey：宽松上下限，
    # 挡明显空/残缺与异常超大值。后端原样落库 recovery_blob.wrapped_data_key，永不解析。
    wrappedDataKey: str = Field(min_length=16, max_length=4096)
    # 「恢复码包裹密钥」的 KDF 配方（明文）：客户端据此从恢复码重算包裹密钥；后端仅透传存储，不解析语义。
    kdfParams: dict[str, Any]


class RecoveryBlobUploadResponse(BaseModel):
    """上传「恢复码包裹的 DataKey」响应体（PUT /backup/recovery-blob `200 { success: true }`）。

    UPSERT 成功的极简成功体，与备份下载/上传不同此处无版本/校验语义（恢复 blob 不做单调 version 防回退，
    覆盖即最新）。前端据 success 判定恢复码包裹是否就绪。
    """

    success: bool = True


class RecoveryBlobDownloadResponse(BaseModel):
    """下载「恢复码包裹的 DataKey」响应体（GET /backup/recovery-blob `200 { wrappedDataKey, kdfParams }`）。

    重置（决策点 C2）时取回：客户端用恢复码经 kdfParams 重算包裹密钥，解开 wrappedDataKey 拿回 DataKey，
    再以新密码重新包裹并重传 backup_blob。后端只取库内字段原样返回，**永不解密 / 不解析**。无记录 → 404。

    字段名约定：对外 camelCase（`wrappedDataKey` / `kdfParams`），库列 snake_case
    （`wrapped_data_key` / `kdf_params`），转换在 service 边界完成。
    """

    # 「恢复码包裹的 DataKey」密文（base64 文本）：由库内 snake_case `wrapped_data_key` 映射而来。后端永不解析。
    wrappedDataKey: str
    # 「恢复码包裹密钥」的 KDF 配方（明文）：客户端据此从恢复码重算包裹密钥；由库内 snake_case `kdf_params` 映射而来。
    kdfParams: dict[str, Any]
