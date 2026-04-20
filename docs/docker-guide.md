# Docker 使用指南

> 面向 Docker 新手，结合 nitro-enclave-demo 项目实战讲解。

## 1. 核心概念

```
┌─────────────────────────────────────────┐
│  Dockerfile        → 镜像的"配方"（文本文件）  │
│  Image（镜像）      → 打包好的只读模板         │
│  Container（容器）  → 镜像跑起来后的实例        │
└─────────────────────────────────────────┘

Dockerfile ──build──→ Image ──run──→ Container
```

- **镜像** = 操作系统 + 代码 + 依赖，全部打包成一个文件
- **容器** = 镜像的运行实例，隔离的轻量级虚拟环境
- **Dockerfile** = 构建镜像的指令清单

## 2. 常用命令速查

### 构建 & 运行
```bash
# 构建镜像（在 Dockerfile 所在目录）
docker build -t my-app:latest .

# 运行容器
docker run -p 3000:3000 my-app:latest

# 后台运行
docker run -d --name my-container -p 3000:3000 my-app:latest

# 运行并传环境变量
docker run -d -p 3000:3000 -e ENCLAVE_MODE=true my-app:latest
```

### 查看状态
```bash
# 查看运行中的容器
docker ps

# 查看所有容器（包括已停止的）
docker ps -a

# 查看容器日志
docker logs my-container
docker logs -f my-container    # 实时跟踪
docker logs --tail 50 my-container  # 最后 50 行

# 进入容器内部（调试用）
docker exec -it my-container bash
docker exec -it my-container python3 --version
```

### 停止 & 清理
```bash
# 停止容器
docker stop my-container

# 停止后删除
docker stop my-container && docker rm my-container

# 删除镜像
docker rmi my-app:latest

# 清理无用资源（磁盘空间不够时用）
docker system prune -a        # ⚠️ 会删除所有未使用的镜像
docker system prune            # 只清理容器和网络
```

### 镜像管理
```bash
# 查看本地镜像
docker images

# 给镜像打标签（用于推送）
docker tag my-app:latest registry.example.com/my-app:v1.0

# 推送到仓库
docker push registry.example.com/my-app:v1.0

# 从仓库拉取
docker pull registry.example.com/my-app:v1.0
```

## 3. Dockerfile 语法速查

```dockerfile
# 指定基础镜像
FROM ubuntu:24.04

# 设置工作目录
WORKDIR /app

# 复制文件（宿主机 → 镜像）
COPY package.json ./
COPY . .                          # 复制当前目录所有文件

# 执行命令
RUN apt-get update && apt-get install -y curl
RUN npm install

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 声明容器监听端口（文档性质，不实际暴露）
EXPOSE 3000

# 容器启动时执行的命令（只能有一个 CMD）
CMD ["node", "server.js"]
```

### 多阶段构建（本项目用法）

```dockerfile
# 阶段 1：编译
FROM node:20-slim AS builder
WORKDIR /app
COPY . . 
RUN npm run build

# 阶段 2：运行（只拷贝编译产物，不带编译工具）
FROM node:20-slim
COPY --from=builder /app/.next/standalone ./
CMD ["node", "server.js"]
```

**好处：** 最终镜像只包含运行时，不带编译器和源码，体积小很多。

## 4. 本项目架构（Ollama Sidecar 模式）

```
┌── docker-compose ──────────────────────────────────────────────┐
│                                                                 │
│  ┌───── ollama 容器 ─────┐    ┌───── app 容器 ─────┐            │
│  │  Ollama + 模型(GGUF)  │    │  Next.js (Node.js) │            │
│  │  :11434               │←───│  :3000             │            │
│  │  (模型已打包在镜像内)    │    │  (纯 HTTP 调用)     │            │
│  └───────────────────────┘    └────────────────────┘            │
│                                                                 │
│  前端浏览器 ──HTTP──→ :3000/api/chat ──HTTP──→ ollama:11434/v1   │
└─────────────────────────────────────────────────────────────────┘
```

**两个独立容器：**
- `ollama`: 模型推理服务（Ollama 官方镜像 + 本地 GGUF 打包）
- `app`: Next.js Web 应用（纯 Node.js，零编译依赖）

### 构建流程（各镜像独立构建）

```
Dockerfile.ollama:
  ollama/ollama → COPY GGUF 模型 → ollama create → 完成

Dockerfile:
  node:20-slim → npm ci → npm run build → COPY standalone → 完成
```

## 5. docker-compose.yml

管理多个容器（ollama + app）一起启动：

```yaml
services:
  # Ollama 模型服务（模型已打包在镜像内）
  ollama:
    build:
      context: .
      dockerfile: Dockerfile.ollama
    shm_size: "2g"

  # Next.js 应用
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      USE_MOCK_LLM: "false"
      ENCLAVE_MODE: "false"
      LLM_BASE_URL: "http://ollama:11434/v1"
      LLM_MODEL: "qwen3.5"
    depends_on:
      - ollama
```

```bash
# 构建并启动（一条命令）
docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止
docker compose down

# 或用脚本
./docker-build.sh          # 构建 + 启动
./docker-build.sh build    # 只构建
./docker-build.sh down     # 停止
```

## 6. 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENCLAVE_MODE` | `true` | `false` = 明文模式，`true` = 加密模式 |
| `USE_MOCK_LLM` | `true` | `false` = 走真实模型 |
| `LLM_BASE_URL` | `http://ollama:11434/v1` | Ollama API 地址（compose 内用服务名） |
| `LLM_MODEL` | `qwen3.5` | 模型名称（对应 ollama create 时的名字） |
| `SYSTEM_PROMPT` | 内置 | 自定义系统提示词 |

> 旧变量 `LLM_THREADS` 已废弃（llama-server 线程数配置由 Ollama 管理）

## 7. 常见问题

### Q: 构建太慢？
```bash
# 查看哪些步骤耗时
docker build --progress=plain -t my-app .

# 利用缓存（不改的层不会重新构建）
# Dockerfile 中，把不常变的指令放前面
```

### Q: 磁盘空间不够？
```bash
# 查看 Docker 占用
docker system df

# 清理未使用资源
docker system prune -a

# 清理构建缓存
docker builder prune
```

### Q: 容器启动就退出？
```bash
# 查看退出原因
docker logs my-container

# 查看退出状态码
docker inspect my-container --format='{{.State.ExitCode}}'
# 0 = 正常退出，非0 = 有错误
```

### Q: 想修改容器内的文件？
```bash
# 方式 1：exec 进去改（临时）
docker exec -it my-container bash

# 方式 2：挂载宿主机目录（持久化）
docker run -v /host/path:/container/path my-app

# 方式 3：改 Dockerfile 后重新构建（推荐）
```

### Q: 容器内访问不了外网？
```bash
# 检查 DNS
docker exec my-container cat /etc/resolv.conf

# 检查网络
docker exec my-container curl -s http://baidu.com

# 如果 apt-get 装不了东西，换 pip 或用多阶段构建
```

## 8. 进阶：K8s 部署

```bash
# 用项目里的 deployment.yaml
kubectl apply -f k8s/deployment.yaml

# 查看状态
kubectl get pods
kubectl logs -f deployment/nitro-enclave-demo

# 更新配置后重新部署
kubectl rollout restart deployment/nitro-enclave-demo
```
