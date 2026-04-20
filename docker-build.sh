#!/bin/bash
# Docker 多架构构建脚本
set -e

IMAGE_NAME="${IMAGE_NAME:-nitro-enclave-demo}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
REGISTRY="${REGISTRY:-}"  # e.g. "registry.cn-hangzhou.aliyuncs.com/your-ns/"
PLATFORMS="${PLATFORMS:-}"

# ---- 下载模型（如不存在） ----
MODEL_FILE="models/Qwen3.5-0.8B-Q4_K_M.gguf"
if [ ! -f "$MODEL_FILE" ]; then
    echo ">>> 模型不存在，先下载..."
    bash models/download-model.sh
fi

# ---- 构建模式 ----
if [ -n "$PLATFORMS" ]; then
    # 多平台构建（需要 buildx）
    FULL_IMAGE="${REGISTRY}${IMAGE_NAME}:${IMAGE_TAG}"
    echo ">>> 多平台构建: $PLATFORMS"
    echo ">>> 镜像: $FULL_IMAGE"

    docker buildx create --name multiarch --use 2>/dev/null || docker buildx use multiarch

    docker buildx build \
        --platform "$PLATFORMS" \
        -t "$FULL_IMAGE" \
        ${PUSH:+--push} \
        ${LOAD:+--load} \
        .
else
    # 单平台构建（当前架构）
    FULL_IMAGE="${REGISTRY}${IMAGE_NAME}:${IMAGE_TAG}"
    ARCH=$(uname -m)
    echo ">>> 单平台构建: $ARCH"
    echo ">>> 镜像: $FULL_IMAGE"

    docker build -t "$FULL_IMAGE" .

    if [ -n "$REGISTRY" ]; then
        echo ">>> 推送到 $REGISTRY..."
        docker push "$FULL_IMAGE"
    fi
fi

echo ">>> 完成! $FULL_IMAGE"
