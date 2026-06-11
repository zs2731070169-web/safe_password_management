#!/usr/bin/env bash
# SafeVault 认证服务启动脚本。
# 关键点：app/ 是源码根，必须在 app/ 目录下运行，main、worker.xxx 才能作为顶层模块被解析。
# 无论从哪里调用，下面这行都会把工作目录切到脚本同级的 app/ 目录。
set -euo pipefail
cd "$(dirname "$0")/app"

# 用 uv 运行，自动使用工程 .venv 与锁定依赖；端口/重载可按需改
exec uv run uvicorn main:app --reload --port 8000
