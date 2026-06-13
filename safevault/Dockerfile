# syntax=docker/dockerfile:1
# SafeVault 后端服务 Docker 镜像
# 同一镜像用于 API 服务和邮件消费者（通过不同 command 启动）

# ---- 构建阶段：安装 Python 依赖 ----
FROM python:3.13-slim AS builder

# 从官方镜像复制 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /opt/safevault

# 先复制依赖声明，利用 Docker 层缓存（依赖不变时跳过安装步骤）
COPY pyproject.toml uv.lock ./

# 安装运行时依赖到 .venv（冻结版本、跳过 dev 依赖、不安装项目自身）
RUN uv sync --frozen --no-dev --no-install-project

# ---- 运行阶段：精简最终镜像 ----
FROM python:3.13-slim

# 时区设置
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /opt/safevault

# 从构建阶段复制虚拟环境
COPY --from=builder /opt/safevault/.venv /opt/safevault/.venv

# 复制应用代码
COPY app/ ./app/

# 确保使用虚拟环境中的 Python 和工具
ENV PATH="/opt/safevault/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

# 运行时工作目录：app/ 子目录（与本地开发一致：main、comsumer.xxx 作为顶层模块）
WORKDIR /opt/safevault/app

# 默认启动 API 服务（邮件消费者通过 docker-compose command 覆盖）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
