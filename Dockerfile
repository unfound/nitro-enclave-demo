# Dockerfile — Legacy standalone Next.js app (已废弃)
#
# 当前架构已将 LLM 调用迁移到 Go 后端（backend/）。
# 请使用 docker-compose.yml，它会构建以下三个服务：
#
#   1. frontend/   — Next.js 前端（端口 3000）
#   2. backend/     — Go 后端（端口 8000）
#   3. llm/         — llama.cpp server（端口 8080）
#
# 构建全部: docker compose build
# 启动全部: docker compose up -d
#
# 如需单独构建前端:
#   docker build -f frontend/Dockerfile -t nitro-enclave-frontend ./frontend
#
# 如需单独构建后端:
#   docker build -f Dockerfile.backend -t nitro-enclave-backend .
