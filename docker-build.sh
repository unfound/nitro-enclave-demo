#!/bin/bash
# 构建并运行 - Ollama sidecar 版本
#
# 用法:
#   ./docker-build.sh          # 构建 + 启动
#   ./docker-build.sh build    # 只构建
#   ./docker-build.sh up       # 只启动（已构建的情况下）
#   ./docker-build.sh down     # 停止

set -e

cd "$(dirname "$0")"
PROJECT="nitro-enclave"

case "${1:-all}" in
  build)
    echo "🔨 构建镜像..."
    sudo docker compose build
    echo "✅ 构建完成"
    ;;
  up)
    echo "🚀 启动服务..."
    sudo docker compose up -d
    echo "✅ 已启动"
    echo "   App:    http://localhost:3000"
    echo "   Ollama: http://localhost:11434 (需取消 docker-compose 注释)"
    ;;
  down)
    echo "🛑 停止服务..."
    sudo docker compose down
    echo "✅ 已停止"
    ;;
  all)
    echo "🔨 构建镜像..."
    sudo docker compose build
    echo "🚀 启动服务..."
    sudo docker compose up -d
    echo ""
    echo "✅ 完成！"
    echo "   App: http://localhost:3000"
    echo ""
    echo "   等待模型加载（约 15 秒后测试）:"
    echo "   curl -s -X POST http://localhost:3000/api/chat \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}'"
    ;;
  *)
    echo "用法: $0 [build|up|down|all]"
    exit 1
    ;;
esac
