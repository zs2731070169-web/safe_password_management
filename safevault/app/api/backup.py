"""加密备份相关路由（模块 2）。

已实现 §1 上传整库快照 `PUT /backup`、§2 下载最新快照 `GET /backup`、§3 仅取元信息
`GET /backup/meta` 与 §4 删除云端备份 `DELETE /backup`（方案 A：开关与删除解耦——关闭云备份
开关只本地停传、不调本接口；仅用户显式点「删除云端备份」并二次确认才走 DELETE）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_user_id
from client.db_client import get_session
from schemas.backup import (
    BackupDeleteResponse,
    BackupDownloadResponse,
    BackupMetaResponse,
    BackupUploadRequest,
    BackupUploadResponse,
    RecoveryBlobDownloadResponse,
    RecoveryBlobUploadRequest,
    RecoveryBlobUploadResponse,
)
from services.backup import (
    delete_backup,
    download_backup,
    get_backup_meta,
    get_recovery_blob,
    upload_backup,
    upsert_recovery_blob,
)

router = APIRouter(prefix="/backup", tags=["backup"])


@router.put("", response_model=BackupUploadResponse)
async def put_backup(
    payload: BackupUploadRequest,
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> BackupUploadResponse:
    """上传整库快照（覆盖式，零知识，对齐时序图 §1）。

    流程对齐时序图 §1：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id
         前置完成，并解析出当前登录用户的 userId，作为 blob 归属）
      2) 校验 size ≤ 上限（对 ciphertext base64 解码后的原始字节数判定）→ 超限 413「备份体积超限」
      3) 校验 checksum 格式（64 位十六进制 SHA-256）→ 不符 400「校验值非法」
      4) SELECT version BY userId → 上传 version ≤ 云端当前版本 且未带 force → 409
         （客户端内部并发信号，非用户冲突：乱序 / 重试旧请求静默丢弃；换机覆盖走 force）
      5) 先 PUT object 写 OSS（覆盖写 ciphertext 字节），成功后再 UPSERT 元信息（顺序关键）
      6) 返回 200 { version, updatedAt }（force 覆盖时 version 为重建后的基线值，客户端据此同步本地）

    零知识：请求体里的 `ciphertext` 是客户端本地 AES-GCM 密文，后端永不解析；`kdfParams`（camelCase）
    为明文派生配方，落库列名 snake_case `kdf_params`，转换在此边界完成。

    force：默认 False 走单调 version 防回退；仅当用户在新设备显式「用本机数据覆盖云端」并二次确认时
    置 True，绕过版本序检查、无条件覆盖并重建单调基线（详见 services/backup.upload_backup）。
    """
    # 2~6) 业务编排（体积校验 → checksum 格式校验 → version 防回退 / force 覆盖 → 先写 OSS → UPSERT）
    result = await upload_backup(
        session=session,
        user_id=user_id,
        ciphertext=payload.ciphertext,
        wrapped_data_key=payload.wrappedDataKey,
        kdf_params=payload.kdfParams,
        version=payload.version,
        checksum=payload.checksum,
        force=payload.force,
    )
    return BackupUploadResponse(**result)


@router.get("", response_model=BackupDownloadResponse)
async def get_backup(
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> BackupDownloadResponse:
    """下载最新整库快照（零知识，对齐时序图 §2）。

    流程对齐时序图 §2：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id
         前置完成，并解析出当前登录用户的 userId，作为 blob 归属）
      2) SELECT object_key, version, checksum, kdf_params BY userId
         - 该账户无备份 → 404「云端暂无备份」（由 service 抛 BackupNotFoundError，统一异常处理器映射）
         - 命中 → 从对象存储 GET object 取回 ciphertext（不透明字节）
      3) 把取回的原始字节重新 base64 编码成文本，返回 200 { ciphertext, kdfParams, version, checksum }

    零知识：后端只取 blob 原样返回，**永不解密 / 不解析** ciphertext；解密在客户端本地完成
    （用账户密码经 kdfParams 重算 DataKey）。`valid` 字段属模块 3，本接口不过滤、不返回。
    """
    result = await download_backup(session=session, user_id=user_id)
    return BackupDownloadResponse(**result)


# 路由顺序说明：`/backup/meta` 为静态子路径，与上方 `@router.get("")`（精确匹配 `/backup`）
# 不冲突——FastAPI 按精确路径匹配，空路径只命中 `/backup`，不会误吃 `/backup/meta`。
@router.get("/meta", response_model=BackupMetaResponse)
async def get_backup_meta_endpoint(
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> BackupMetaResponse:
    """仅取备份元信息（轻量，零知识，对齐时序图 §3）。

    流程对齐时序图 §3：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id
         前置完成，并解析出当前登录用户的 userId，作为 blob 归属）
      2) 仅 SELECT version, size_bytes, updated_at BY userId（**不拉 blob、不查 OSS**，轻量低成本）
         - 该账户无备份 → 200 { hasBackup: false }（**注意是 200 不是 404**，与 §2 下载刻意区分：
           meta 是「查询是否有备份」，«没有» 是正常结果；download 取内容无可取才 404）
         - 命中 → 200 { hasBackup: true, version, size, updatedAt }（size 取库列 size_bytes，
           updatedAt 取库列 updated_at；snake_case → camelCase 转换在 service 边界完成）

    用途：设置页云账户卡片展示「上次备份：刚刚 · 12 KB · v8」。响应**不含** ciphertext / checksum /
    kdfParams（那些属 §2 下载范畴），仅回展示所需三项轻量元信息，无需触达对象存储。
    """
    result = await get_backup_meta(session=session, user_id=user_id)
    # 命中时 result 含 version/size/updatedAt；无备份时仅含 hasBackup=False，
    # 其余字段由 BackupMetaResponse 的默认值 None 补齐（Pydantic 据缺省字段填 None）。
    return BackupMetaResponse(**result)


@router.delete("", response_model=BackupDeleteResponse)
async def delete_backup_endpoint(
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> BackupDeleteResponse:
    """删除云端整库备份（幂等，零知识，对齐时序图 §4，方案 A：开关与删除解耦）。

    语义边界（务必区分）：本接口对应用户在设置页**显式点击「删除云端备份」危险操作并二次确认**触发的
    彻底删除；**关闭云备份开关只是本地停传、不调本接口、不删云端 blob**——两类操作解耦。

    流程对齐时序图 §4：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id
         前置完成，并解析出当前登录用户的 userId，作为 blob 归属）
      2) SELECT object_key BY userId
         - 无备份 → 200 { deleted: true }（**幂等**：本就无备份也视为删除成功，**不报 404**，
           便于客户端无脑重试 / 重复点击）
         - 命中 → **先删元信息**（使云端「逻辑上无备份」即时生效：GET /backup 立即 404、
           GET /backup/meta 立即 hasBackup=false）→ **再尽力清理 OSS blob**（清理失败吞异常并记日志，
           残留对象交由桶生命周期策略兜底，不阻塞删除主链路）→ 200 { deleted: true }

    幂等：重复点击 / 本无备份统一返回 { deleted: true }（详见 services/backup.delete_backup）。
    零知识：本接口只按 object_key 删除不透明字节，**永不解析**密文内容。
    """
    result = await delete_backup(session=session, user_id=user_id)
    return BackupDeleteResponse(**result)


@router.put("/recovery-blob", response_model=RecoveryBlobUploadResponse)
async def put_recovery_blob(
    payload: RecoveryBlobUploadRequest,
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> RecoveryBlobUploadResponse:
    """上传「恢复码包裹的 DataKey」（覆盖式，每账户一份，零知识）。

    包裹式密钥方案下，随机 DataKey 除被密码包裹（随 PUT /backup 上传）外，再被**恢复码**包裹一份独立
    存放于 recovery_blob 表，使忘记密码走重置（决策点 C2）后仍能用恢复码解出 DataKey、以新密码重新包裹，
    旧整库密文无需重传。开户 / 设恢复码时上传一次，后续可覆盖更新。

    流程：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id 前置完成）
      2) UPSERT recovery_blob BY userId（无版本序检查，覆盖即最新）
      3) 返回 200 { success: true }

    零知识：请求体 `wrappedDataKey` 是恢复码包裹后的 DataKey 密文，后端永不解析；`kdfParams`（camelCase）
    为明文派生配方，落库列 snake_case `kdf_params`，转换在此边界完成。
    """
    result = await upsert_recovery_blob(
        session=session,
        user_id=user_id,
        wrapped_data_key=payload.wrappedDataKey,
        kdf_params=payload.kdfParams,
    )
    return RecoveryBlobUploadResponse(**result)


@router.get("/recovery-blob", response_model=RecoveryBlobDownloadResponse)
async def get_recovery_blob_endpoint(
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> RecoveryBlobDownloadResponse:
    """下载「恢复码包裹的 DataKey」（零知识）。

    重置（决策点 C2）时取回：客户端用恢复码经 kdfParams 重算包裹密钥，解开 wrappedDataKey 拿回 DataKey，
    再以新密码重新包裹并重传 backup_blob，使旧整库密文被新密码解开。

    流程：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id 前置完成）
      2) SELECT wrapped_data_key, kdf_params BY userId
         - 无记录 → 404「该账户暂无恢复码包裹的 DataKey」（由 service 抛 RecoveryBlobNotFoundError）
         - 命中 → 返回 200 { wrappedDataKey, kdfParams }
    零知识：后端只取库内字段原样返回，**永不解密 / 不解析**；解密在客户端本地用恢复码完成。
    """
    result = await get_recovery_blob(session=session, user_id=user_id)
    return RecoveryBlobDownloadResponse(**result)
