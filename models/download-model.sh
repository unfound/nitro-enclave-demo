#!/bin/bash
# Download Qwen3.5-0.8B GGUF model for local Docker build
set -e

MODEL_DIR="$(dirname "$0")"
MODEL_FILE="Qwen3.5-0.8B-Q4_K_M.gguf"
HF_MIRROR="${HF_MIRROR:-https://hf-mirror.com}"
MODEL_URL="${HF_MIRROR}/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/${MODEL_FILE}"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
    echo "Model already exists: $MODEL_DIR/$MODEL_FILE"
    exit 0
fi

echo "Downloading Qwen3.5-0.8B Q4_K_M (504MB)..."
echo "Mirror: $HF_MIRROR"

curl -L --progress-bar -o "$MODEL_DIR/$MODEL_FILE" "$MODEL_URL"

echo "Done! Model saved to: $MODEL_DIR/$MODEL_FILE"
