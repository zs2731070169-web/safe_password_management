"""加密备份上传业务编排（对齐时序图 §1 备份服务部分）。

严格按时序图 §1 步骤推进（步骤号与图中 autonumber 对应，鉴权解 userId 已在路由依赖完成）：
  - 校验 size ≤ 上限（对 ciphertext base64 解码后的原始字节数判定）→ 超限 BackupTooLargeError(413)
  - 校验 checksum 格式（64 位十六进制 SHA-256）→ 不符 InvalidChecksumError(400)
  - SELECT version BY userId（当前云端版本）→ 上传 version ≤ 云端 且未带 force →
    BackupVersionConflictError(409)
  - 先 PUT object 写 OSS（覆盖写 ciphertext 字节），成功后再 UPSERT 元信息（顺序关键，见下）
  - 返回 { version, updatedAt }

version 防回退与 force 覆盖的定位（单设备无同步）：单调 version 防的是「网络乱序 / 重试让旧快照
覆盖新快照」这类数据完整性风险，**非多设备写写冲突**。故 409 是**客户端内部并发信号**——日常单
设备本地 version 恒领先、不会触发；触发即「过期上传」，客户端静默丢弃。仅当用户在新设备**显式选择
「用本机数据覆盖云端」**时带 force=True，绕过版本序检查、无条件覆盖，并把落库 version 重置为
max(上传 version, 云端 version + 1) **重建单调基线**（客户端据返回 version 同步本地，后续正常前进，
不会被同一设备的后续上传卡在 409）。force 是一次性人为决策，绝不在自动备份链路默认携带。

零知识：`ciphertext` 是客户端本地 AES-GCM 密文，后端**永不解析**；checksum 在零知识下后端
**不重算 / 不比对** ciphertext 的真实哈希（无法解析密文），只校验其格式合法性后原样存储。

为何先写对象存储再更元信息：元信息库是「最新有效快照」的权威指针。若先更元信息再写 blob 失败，
会指向不存在 / 旧 blob；反之即使元信息更新失败，旧元信息仍指向旧 blob，下次重传可自愈。
"""
from __future__ import annotations

import base64
import binascii
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from core.exception.exceptions import (
    BackupNotFoundError,
    BackupTooLargeError,
    BackupVersionConflictError,
    InvalidChecksumError,
    RecoveryBlobNotFoundError,
)
from core.oss.oss import delete_object, get_object, put_object
from models.backup import BackupBlob
from models.recovery_blob import RecoveryBlob

# 备份模块日志器（命名对齐工程约定 safevault.xxx）。用于「尽力清理 OSS blob」失败时记录告警。
logger = logging.getLogger("safevault.backup")

# SHA-256 十六进制摘要：恰好 64 个十六进制字符（大小写均可）。预编译避免每次上传重复编译。
_CHECKSUM_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _decode_ciphertext(ciphertext: str) -> bytes:
    """把 base64 文本的密文解码为原始字节（**整条链路只解一次**，复用于体积判定与写 OSS）。

    前端契约里 ciphertext 是 base64 文本：体积上限看解码后的原始字节数，写 OSS 也用同一份字节，
    故在此一次性解码、向上返回 bytes，避免对可能达 MB 级的密文重复 base64 解码。base64 本身非法
    （含非法字符 / 填充错误）时按「损坏请求」拒绝。

    :param ciphertext: base64 文本密文
    :returns: 解码后的原始密文字节
    :raises InvalidChecksumError: ciphertext 非合法 base64（400，复用「请求体损坏」通道）
    """
    try:
        # validate=True：严格模式，混入非 base64 字符即报错，避免静默截断后低估体积。
        return base64.b64decode(ciphertext, validate=True)
    except (binascii.Error, ValueError) as exc:
        # ciphertext 非合法 base64：与「校验值非法」同属边界脏数据，用 400 表达「请求体损坏」。
        # 复用 InvalidChecksumError 的 400 通道并给出明确文案，避免脏数据进入 OSS / 元信息库。
        raise InvalidChecksumError("密文格式非法") from exc


async def upload_backup(
    session: AsyncSession,
    user_id: int,
    ciphertext: str,
    wrapped_data_key: str,
    kdf_params: dict[str, Any],
    version: int,
    checksum: str,
    force: bool = False,
) -> dict[str, Any]:
    """上传整库快照主流程，返回 { version, updatedAt }（对齐时序图 §1）。

    :param session: 异步数据库会话（由路由依赖注入，事务化）
    :param user_id: 当前登录用户的 userId（由 get_current_user_id 鉴权解出）
    :param ciphertext: 整库 AES-GCM 密文（base64 文本），后端不解析
    :param wrapped_data_key: 「密码包裹的 DataKey」密文（base64 文本），后端仅透传存储、永不解析
    :param kdf_params: 「密码包裹 DataKey」的 KDF 配方（明文），后端仅透传存储
    :param version: 客户端本地最新版本（force=False 时须严格大于云端当前版本）
    :param checksum: ciphertext 的 SHA-256 十六进制摘要（64 位 hex）
    :param force: 显式「用本机数据覆盖云端」开关（换机兜底）。False 走单调 version 防回退；
        True 绕过版本序检查、无条件覆盖，并把落库 version 重置为 max(version, 云端+1) 重建基线。
    :returns: {"version": int, "updatedAt": datetime}（force 覆盖时 version 为重建后的基线值）
    :raises BackupTooLargeError: 密文原始字节数 > settings.backup_max_size_bytes（413）
    :raises InvalidChecksumError: checksum 格式非法 / 密文非合法 base64（400）
    :raises BackupVersionConflictError: version ≤ 云端当前版本 且未带 force（409，客户端内部并发信号）
    """
    # 步骤：解码密文（整条链路只解一次，下面体积判定与写 OSS 复用同一份字节）。
    raw_bytes = _decode_ciphertext(ciphertext)
    # 校验 size ≤ 上限。对解码后的**原始字节数**判定（非 base64 文本长度）。
    size_bytes = len(raw_bytes)
    if size_bytes > settings.backup_max_size_bytes:
        raise BackupTooLargeError("备份体积超限")

    # 步骤：校验 checksum 格式（64 位十六进制 SHA-256）。零知识下不重算 / 不比对密文真实哈希，
    # 只挡明显损坏 / 伪造的请求。归一化为小写后存储，使列内格式统一（便于幂等与比对）。
    if not _CHECKSUM_RE.match(checksum):
        raise InvalidChecksumError("校验值非法")
    normalized_checksum = checksum.lower()

    # 步骤：SELECT BY account_id（当前云端记录）。无记录 = 首次备份，视为可写入。
    existing = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == user_id)
    )

    # 步骤：单调 version 防回退（force=False）。上传 version ≤ 云端当前版本（乱序 / 重试旧请求）→ 409。
    # 该 409 是客户端内部并发信号、非用户冲突：客户端静默丢弃此过期上传即可（详见模块顶注释 / 异常类）。
    # force=True（用户显式「用本机覆盖云端」）则绕过本检查；首次无备份（existing is None）天然放行。
    if existing is not None and version <= existing.version and not force:
        raise BackupVersionConflictError("上传版本已过期（乱序或重试的旧快照），客户端可静默丢弃")

    # 步骤：确定落库 version。常规前进取上传值；force 覆盖且本地落后时，重置为 max(上传, 云端+1)
    # 重建单调基线——避免「用本机覆盖云端」后，同一设备的后续上传因仍 ≤ 旧云端 version 而持续 409。
    stored_version = version
    if force and existing is not None:
        stored_version = max(version, existing.version + 1)

    # 步骤：先写对象存储再更元信息（顺序关键，见模块顶注释）。
    # 对象 key = `{prefix}/{userId}`，覆盖写上方已解码的原始字节（OSS 按字节存储，不透明）。
    object_key = f"{settings.oss_key_prefix}/{user_id}"
    await put_object(object_key, raw_bytes)

    # 步骤：UPSERT 元信息。无则 INSERT，有则 UPDATE（version 已在前面判过严格更高）。
    # valid 恒置 1：本接口上传的是以当前密码包裹、可解密的新快照。
    if existing is None:
        blob = BackupBlob(
            account_id=user_id,
            object_key=object_key,
            wrapped_data_key=wrapped_data_key,
            kdf_params=kdf_params,
            version=stored_version,
            checksum=normalized_checksum,
            size_bytes=size_bytes,
            valid=1,
        )
        session.add(blob)
    else:
        existing.object_key = object_key
        existing.wrapped_data_key = wrapped_data_key
        existing.kdf_params = kdf_params
        existing.version = stored_version
        existing.checksum = normalized_checksum
        existing.size_bytes = size_bytes
        existing.valid = 1
        blob = existing

    # flush 触发 INSERT/UPDATE 并回填 updated_at（onupdate=func.now()），但不提交（提交由会话依赖收尾）。
    await session.flush()
    # 刷新拿到库侧 server_default / onupdate 写回的 updated_at（INSERT 后实体上为 None）。
    await session.refresh(blob)

    return {"version": blob.version, "updatedAt": blob.updated_at}


async def download_backup(
    session: AsyncSession,
    user_id: int,
) -> dict[str, Any]:
    """下载最新整库快照，返回 { ciphertext, kdfParams, version, checksum }（对齐时序图 §2）。

    流程严格对齐时序图 §2 备份服务部分（鉴权解 userId 已在路由依赖完成）：
      1) SELECT object_key, version, checksum, kdf_params BY userId（元信息库是「最新有效快照」指针）
      2) 该账户无备份（查无记录）→ 抛 BackupNotFoundError（404「云端暂无备份」）
      3) 命中 → 从对象存储 GET object（key=object_key）取回 ciphertext 原始字节
      4) 把原始字节**重新 base64 编码成文本** 放进 ciphertext 返回（前端契约 ciphertext 为 base64 文本）

    零知识：后端只取 blob 原样返回，**永不解密 / 不解析** ciphertext；客户端凭账户密码经 kdfParams
    重算 DataKey 在本地完成 AES-GCM 解密。`valid`（决策点 C1 重置密码置 0）属模块 3 范畴，本接口
    不过滤、不纳入响应，严格按 §2 只返回这四个字段。

    对象存储里存的是「ciphertext base64 解码后的原始字节」（见 upload_backup 写入逻辑），故此处
    取回字节后需重新 base64 编码，与上传时的 _decode_ciphertext 形成对称（解码存 → 取后编码返回）。

    :param session: 异步数据库会话（由路由依赖注入）
    :param user_id: 当前登录用户的 userId（由 get_current_user_id 鉴权解出，作为 blob 归属）
    :returns: {"ciphertext": str(base64 文本), "kdfParams": dict, "version": int, "checksum": str}
    :raises BackupNotFoundError: 该账户云端暂无备份（404）
    :raises RuntimeError: 对象存储未配置（由 get_object 兜底抛出）
    :raises botocore.exceptions.ClientError: 对象存储侧错误（对象缺失 / 鉴权 / 桶不存在等）
    """
    # 步骤 1) SELECT BY account_id（元信息库权威指针）。
    existing = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == user_id)
    )

    # 步骤 2) 该账户无备份 → 404「云端暂无备份」（仅 GET /backup 在无备份时 404，与 meta/delete 语义区分）。
    if existing is None:
        raise BackupNotFoundError("云端暂无备份")

    # 步骤 3) 从对象存储取回密文原始字节（object_key 为落库指针，即 `{prefix}/{userId}`）。
    raw_bytes = await get_object(existing.object_key)

    # 步骤 4) 原始字节重新 base64 编码成文本，对齐前端契约（ciphertext 为 base64 文本）。
    ciphertext = base64.b64encode(raw_bytes).decode("ascii")

    # 返回 { ciphertext, wrappedDataKey, kdfParams, version, checksum }；库内 snake_case → 对外 camelCase。
    # wrappedDataKey（密码包裹的 DataKey）与 ciphertext 一同下发，客户端先解开它拿回 DataKey 再解密整库。
    return {
        "ciphertext": ciphertext,
        "wrappedDataKey": existing.wrapped_data_key,
        "kdfParams": existing.kdf_params,
        "version": existing.version,
        "checksum": existing.checksum,
    }


async def get_backup_meta(
    session: AsyncSession,
    user_id: int,
) -> dict[str, Any]:
    """仅取备份元信息，返回 { hasBackup, version?, size?, updatedAt? }（对齐时序图 §3）。

    流程严格对齐时序图 §3（鉴权解 userId 已在路由依赖完成）：
      1) 仅 `SELECT version, size_bytes, updated_at BY userId`——**不拉 blob、不查 OSS**，轻量低成本，
         用于设置页云账户卡片展示「上次备份：刚刚 · 12 KB · v8」。
      2) 该账户无备份（查无记录）→ 返回 `{ hasBackup: False }`（路由层据此回 **200**，而**非** 404）。
      3) 命中 → 返回 `{ hasBackup: True, version, size, updatedAt }`。

    与 download_backup 的关键区别（务必区分，勿照搬其 404 逻辑）：download 在无备份时**抛
    BackupNotFoundError(404)**；本接口无备份时**不抛异常**、按 200 返回 `hasBackup=False`。原因：meta 是
    「查询是否有备份」的轻量探测，«没有» 是一个正常查询结果而非错误（前端据 hasBackup 决定卡片展示
    «上次备份» 还是 «尚未备份»，无需 catch 404）；download 才是「取回备份内容」，无内容可取方为 404。

    本接口响应**不含** ciphertext / checksum / kdfParams（那些是 §2 下载的范畴），只回展示所需的
    version / size / updatedAt 三项轻量元信息，故无需触达对象存储。

    字段名约定：对外 camelCase（`updatedAt`），库列 snake_case（`size_bytes` → `size`、
    `updated_at` → `updatedAt`），转换在此 service 边界完成。

    :param session: 异步数据库会话（由路由依赖注入）
    :param user_id: 当前登录用户的 userId（由 get_current_user_id 鉴权解出，作为 blob 归属）
    :returns: 无备份 → {"hasBackup": False}；命中 → {"hasBackup": True, "version": int,
        "size": int, "updatedAt": datetime}
    """
    # 步骤 1) 仅查展示所需的三列（version / size_bytes / updated_at）BY account_id——不拉 blob、不查 OSS。
    # 选列查询（而非取整行 ORM 实体）贴合 §3「轻量低成本」语义：少回字段、少占内存，且明确不触及密文。
    row = (
        await session.execute(
            select(
                BackupBlob.version,
                BackupBlob.size_bytes,
                BackupBlob.updated_at,
            ).where(BackupBlob.account_id == user_id)
        )
    ).one_or_none()

    # 步骤 2) 该账户无备份 → 200 { hasBackup: False }（与 §2 下载的 404 刻意区分，见上方 docstring）。
    if row is None:
        return {"hasBackup": False}

    # 步骤 3) 命中 → 200 { hasBackup: True, version, size, updatedAt }。
    # 库列 snake_case → 对外 camelCase 的边界转换：size_bytes → size、updated_at → updatedAt。
    return {
        "hasBackup": True,
        "version": row.version,
        "size": row.size_bytes,
        "updatedAt": row.updated_at,
    }


async def delete_backup(
    session: AsyncSession,
    user_id: int,
) -> dict[str, Any]:
    """删除云端整库备份，返回 { deleted: True }（对齐时序图 §4，方案 A：开关与删除解耦）。

    语义边界（务必区分，勿与「关闭云备份开关」混淆）：本接口是用户在设置页**显式点击「删除云端备份」
    危险操作并二次确认**后才触发的彻底删除；而「关闭云备份开关」仅是本地停传、**不调本接口、不删云端
    blob**。两类操作解耦——开关控制「以后还传不传」，删除控制「云端现有那份还留不留」。

    流程严格对齐时序图 §4 备份服务部分（鉴权解 userId 已在路由依赖完成）：
      1) SELECT BackupBlob BY userId（元信息库是「最新有效快照」的权威指针）
      2) 无记录 → 直接返回 { deleted: True }（**幂等**：本就无备份也视为删除成功，不报 404，便于客户端
         无脑重试 / 重复点击）
      3) 命中 → **先删元信息**（session.delete + flush）使云端「逻辑上无备份」即时生效：此后 GET /backup
         立即 404、GET /backup/meta 立即 hasBackup=False；**再尽力清理 OSS blob**（delete_object），
         清理失败**吞异常并记日志**——元信息已删、对客户端语义上「已无备份」，残留对象交由桶生命周期策略
         兜底回收，绝不让 blob 清理失败把整个删除接口拖成失败。

    为何「先删元信息再清 blob」（与上传的「先写 blob 再更元信息」相反）：元信息库是权威指针。删除时先抹掉
    指针，云端立刻表现为「无备份」，符合用户「点了删除就该没了」的直觉；纵使随后清 OSS 失败，也只是留下
    一份**无人可索引、无指针指向**的孤儿对象（生命周期策略回收），不影响正确性。反之若先删 blob 失败 /
    先删 blob 后删元信息失败，则可能出现「指针还在但对象已没」的悬空指针，下载即报错。

    零知识：本接口只按 object_key 删除不透明字节，**永不解析**密文内容。

    :param session: 异步数据库会话（由路由依赖注入，事务化，退出自动提交）
    :param user_id: 当前登录用户的 userId（由 get_current_user_id 鉴权解出，作为 blob 归属）
    :returns: {"deleted": True}（幂等：命中删除、本无备份、重复删除均返回此结果）
    """
    # 步骤 1) SELECT BY account_id（元信息库权威指针）。
    existing = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == user_id)
    )

    # 步骤 2) 无记录 → 幂等成功（本就无备份也视为已删除，不报 404）。
    # 这里直接返回，既不触库写、也不触 OSS——客户端重复点击 / 删除一个本无备份的账户都稳定得到成功。
    if existing is None:
        return {"deleted": True}

    # 步骤 3a) 先删元信息：抹掉权威指针，使云端「逻辑上无备份」即时生效（GET /backup 即 404、
    # GET /backup/meta 即 hasBackup=False）。先取出 object_key，delete 后实体已与会话分离不便再读属性。
    object_key = existing.object_key
    await session.delete(existing)
    # flush 立即把 DELETE 下发到库（但不提交，提交由会话依赖收尾），确保后续同事务内查询即看不到该记录，
    # 也确保「元信息已删」先于「清 OSS」落地——契合「先删元信息再清 blob」的顺序承诺。
    await session.flush()

    # 步骤 3b) 再尽力清理 OSS 实体 blob。清理失败**不应让整个删除失败**：元信息已删、语义上已无备份，
    # 残留对象交由桶生命周期策略兜底回收。故此处宽口径捕获并吞掉所有异常、仅记 error 日志。
    # 注：此为「尽力清理」的最外层兜底，捕获 Exception 是有意为之（已记录日志并转为不阻塞主链路），
    # 不属于「裸 except 兜底业务异常」的反模式。
    try:
        await delete_object(object_key)
    except Exception:  # noqa: BLE001 - 尽力清理：清 OSS 失败不阻塞删除主链路，记日志由生命周期策略兜底
        # 不带敏感信息（object_key 仅为 backup/{userId} 指针，非密文内容）；userId 便于排查孤儿对象。
        logger.error(
            "删除云端备份：元信息已删但清理 OSS 对象失败，残留对象交由生命周期策略回收 "
            "userId=%s object_key=%s",
            user_id,
            object_key,
            exc_info=True,
        )

    return {"deleted": True}


async def upsert_recovery_blob(
    session: AsyncSession,
    user_id: int,
    wrapped_data_key: str,
    kdf_params: dict[str, Any],
) -> dict[str, Any]:
    """UPSERT「恢复码包裹的 DataKey」，每账户一份，返回 { success: True }（PUT /backup/recovery-blob）。

    包裹式密钥方案下，随机 DataKey 除被密码包裹（随 backup 上传）外再被**恢复码**包裹一份独立存放，
    使忘记密码走重置（决策点 C2）后仍能用恢复码解出 DataKey、以新密码重新包裹，旧整库密文无需重传。
    覆盖式：无记录则 INSERT，有则 UPDATE（不做单调 version 防回退——恢复 blob 覆盖即最新）。

    零知识：wrapped_data_key 是恢复码包裹后的 DataKey 密文，后端**永不解析**，原样落库；kdf_params 为
    明文派生配方，仅透传存储。

    :param session: 异步数据库会话（由路由依赖注入，事务化，退出自动提交）
    :param user_id: 当前登录用户的 userId（由 get_current_user_id 鉴权解出，作为 blob 归属）
    :param wrapped_data_key: 「恢复码包裹的 DataKey」密文（base64 文本），后端不解析
    :param kdf_params: 「恢复码包裹密钥」的 KDF 配方（明文），后端仅透传存储
    :returns: {"success": True}
    """
    # SELECT BY account_id（每账户一份）。无记录 = 首次设置恢复 blob，视为可写入。
    existing = await session.scalar(
        select(RecoveryBlob).where(RecoveryBlob.account_id == user_id)
    )

    # UPSERT：无则 INSERT，有则 UPDATE（覆盖式，无版本序检查）。
    if existing is None:
        blob = RecoveryBlob(
            account_id=user_id,
            wrapped_data_key=wrapped_data_key,
            kdf_params=kdf_params,
        )
        session.add(blob)
    else:
        existing.wrapped_data_key = wrapped_data_key
        existing.kdf_params = kdf_params

    # flush 触发 INSERT/UPDATE（提交由会话依赖收尾）。无需回填字段返回，故不 refresh。
    await session.flush()

    return {"success": True}


async def get_recovery_blob(
    session: AsyncSession,
    user_id: int,
) -> dict[str, Any]:
    """取「恢复码包裹的 DataKey」，返回 { wrappedDataKey, kdfParams }（GET /backup/recovery-blob）。

    重置（决策点 C2）时取回：客户端用恢复码经 kdfParams 重算包裹密钥，解开 wrappedDataKey 拿回 DataKey，
    再以新密码重新包裹并重传 backup_blob。后端只取库内字段原样返回，**永不解密 / 不解析**。

    无记录 → 抛 RecoveryBlobNotFoundError(404)，语义与 download_backup 的 404 对称（无内容可取才 404）。

    :param session: 异步数据库会话（由路由依赖注入）
    :param user_id: 当前登录用户的 userId（由 get_current_user_id 鉴权解出，作为 blob 归属）
    :returns: {"wrappedDataKey": str(base64 文本), "kdfParams": dict}
    :raises RecoveryBlobNotFoundError: 该账户云端暂无恢复码包裹的 DataKey（404）
    """
    # SELECT BY account_id。
    existing = await session.scalar(
        select(RecoveryBlob).where(RecoveryBlob.account_id == user_id)
    )

    # 无记录 → 404「未设置恢复码 / 无法用恢复码恢复」（与 GET /backup 的 404 语义对称）。
    if existing is None:
        raise RecoveryBlobNotFoundError("该账户暂无恢复码包裹的 DataKey")

    # 库内 snake_case → 对外 camelCase 的边界转换。
    return {
        "wrappedDataKey": existing.wrapped_data_key,
        "kdfParams": existing.kdf_params,
    }
