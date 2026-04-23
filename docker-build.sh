#!/bin/bash
# docker-build.sh — 构建并启动全套服务
#
# 用法:
#   ./docker-build.sh          # 构建 + 启动
#   ./docker-build.sh build    # 只构建
#   ./docker-build.sh up       # 只启动（已构建的情况下）
#   ./docker-build.sh down     # 停止

set -e

cd "$(dirname "$0")"

case "${1:-all}" in
  build)
    echo "🔨 构建镜像 (frontend + backend + llm)..."
    sudo docker compose build
    echo "✅ 构建完成"
    ;;
  up)
    echo "🚀 启动服务..."
    sudo docker compose up -d
    echo "✅ 已启动"
    echo "   前端:   http://localhost:3000"
    echo "   后端:   http://localhost:8000"
    echo "   LLM:    http://localhost:8080"
    ;;
  down)
    echo "🛑 停止服务..."
    sudo docker compose down
    echo "✅ 已停止"
    ;;
  all)
    echo "🔨 构建镜像 (frontend + backend + llm)..."
    sudo docker compose build
    echo "🚀 启动服务..."
    sudo docker compose up -d
    echo ""
    echo "✅ 完成！"
    echo "   前端:   http://localhost:3000"
    echo "   后端:   http://localhost:8000"
    echo "   LLM:    http://localhost:8080"
    ;;
  *)
    echo "用法: $0 [build|up|down|all]"
    exit 1
    ;;
esac
