# Ollama 一体化镜像方案

## 目标
把 GGUF 模型直接打包进 Docker 镜像，启动即用，不需要联网下载。

## 方案

### 1. 新建 Dockerfile.ollama（Ollama 版）

```dockerfile
FROM ollama/ollama:latest

# 把本地 GGUF 模型 COPY 进去
COPY models/Qwen3.5-0.8B-Q4_K_M.gguf /models/Qwen3.5-0.8B-Q4_K_M.gguf

# 创建 Modelfile 并注册模型（构建时就执行 ollama create）
COPY models/Modelfile /models/Modelfile

# 用 RUN 预注册模型（关键！构建时就 create，不用启动后再操作）
RUN /bin/ollama serve & sleep 3 && \
    ollama create qwen3 -f /models/Modelfile && \
    kill %1

# 暴露端口
EXPOSE 11434

# 默认启动 ollama serve（模型已在镜像内）
CMD ["ollama", "serve"]
```

### 2. models/Modelfile

```
FROM /models/Qwen3.5-0.8B-Q4_K_M.gguf
SYSTEM "你是一位专业的运动健康助手，擅长回答运动相关问题。"
```

### 3. Next.js App 的 Dockerfile（纯前端，不装模型）

改用 Ollama sidecar 模式，App 镜像只装 Node.js：
- USE_MOCK_LLM=false
- LLM_BASE_URL=http://ollama:11434/v1
- LLM_MODEL=qwen3

### 4. docker-compose.yml

```yaml
services:
  ollama:
    build:
      context: .
      dockerfile: Dockerfile.ollama
    shm_size: "2g"
    # 不需要 ports，只被 app 内部访问

  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      USE_MOCK_LLM: "false"
      LLM_BASE_URL: "http://ollama:11434/v1"
      LLM_MODEL: "qwen3"
    depends_on:
      - ollama
```

### 5. 验证

```bash
# 构建
sudo docker compose build

# 启动
sudo docker compose up -d

# 测试 ollama
curl http://localhost:11434/v1/chat/completions \
  -d '{"model":"qwen3","messages":[{"role":"user","content":"你好"}]}'

# 测试 app
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

## 关键点

1. **不从 ollama registry 拉模型**，直接 COPY 本地 GGUF
2. 构建时 `RUN ollama create` 预注册模型到镜像内
3. 启动后直接 `ollama serve`，模型已经在了
4. App 镜像彻底干掉 llama-cpp-python，纯 HTTP 调用
5. App 镜像很小（只需要 node + supervisor）
6. 用 docker-compose 管理两个服务

## 当前文件

- 模型文件: `models/Qwen3.5-0.8B-Q4_K_M.gguf` (504MB)
- App 代码: Next.js standalone build
- 需要新建: `Dockerfile.ollama`, `models/Modelfile`, `docker-compose.yml`
- 需要修改: `Dockerfile`（干掉 python 阶段，只保留 node）
