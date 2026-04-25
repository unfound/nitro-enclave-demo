# Docker 使用指南

> 面向 Docker 新手，结合 tpm-app-demo 项目实战讲解。

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

## 4. 本项目架构（三服务分层）

```
┌── docker-compose ────────────────────────────────────────────────────┐
│                                                                   │
│  ┌───── llm 容器 ─────┐   ┌───── backend 容器 ────┐  ┌── frontend ──┐ │
│  │  llama-server     │   │  Go + Nitro Enclave   │  │  Next.js     │ │
│  │  :8080            │←──│  :8000                │←─│  :3000       │ │
│  │  (GGUF 模型推理)    │   │  (VDP 加密传输)        │  │  (Web UI)    │ │
│  └───────────────────┘   └────────────────────────┘  └─────────────┘ │
│                                                                   │
│  前端 ──HTTP──→ :3000 ──HTTP──→ :8000/vdp/chat ──HTTP──→ llm:8080   │
└───────────────────────────────────────────────────────────────────┘
```

**三个独立容器：**
- `llm`: GGUF 模型推理服务（llama-server，端口 8080）
- `backend`: Go 后端 + Nitro Enclave（VDP 加密，端口 8000）
- `frontend`: Next.js Web 应用（纯前端，端口 3000）

### 构建流程（各镜像独立构建）

```
Dockerfile.llm:
  alpine-llama-cpp-server → COPY GGUF 模型 → 完成

Dockerfile.backend:
  golang:alpine → go build → 完成

Dockerfile:
  node:20-slim → npm ci → npm run build → COPY standalone → 完成
```

## 5. docker-compose.yml

管理多个容器（llm + backend + frontend）一起启动：

```yaml
services:
  # GGUF 模型推理服务
  llm:
    build:
      context: .
      dockerfile: Dockerfile.llm
    shm_size: "2g"
    ports:
      - "8080:8080"

  # Go 后端 + Nitro Enclave
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8000:8000"
    environment:
      ENCLAVE_MODE: "false"
      LLM_BASE_URL: "http://llm:8080"
    depends_on:
      - llm

  # Next.js 前端
  frontend:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: "http://localhost:8000"
    depends_on:
      - backend
```

```bash
# 构建所有镜像
docker compose -f docker-compose.yml build

# 启动所有服务
docker compose -f docker-compose.yml up -d

# 查看日志
docker compose -f docker-compose.yml logs -f

# 停止
docker compose -f docker-compose.yml down

# 或用脚本
./docker-build.sh build    # 构建所有镜像
./docker-build.sh up       # 启动所有服务
./docker-build.sh down     # 停止
./docker-build.sh all      # 构建 + 启动
```

## 6. 环境变量配置

### llm 服务（llama-server）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | 监听端口 |
| `MODEL` | `/models/Qwen2.5-7B-Instruct-Q5_K_M.gguf` | GGUF 模型路径 |
| `CTX_SIZE` | `1024` | 上下文大小（token） |

### backend 服务（Go）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENCLAVE_MODE` | `false` | `false` = 明文模式，`true` = Nitro Enclave 加密 |
| `LLM_BASE_URL` | `http://llm:8080` | llama-server 地址（compose 内用服务名） |
| `LLM_MODEL` | `qwen2.5` | 模型名称 |

### frontend 服务（Next.js）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | 后端 API 地址（浏览器客户端用） |

> 旧变量 `LLM_THREADS`、`USE_MOCK_LLM`、`LLM_MODEL`（前端侧）已废弃。

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
kubectl logs -f deployment/tpm-app-demo

# 更新配置后重新部署
kubectl rollout restart deployment/tpm-app-demo
```

## 9. 磁盘清理

### 概念：悬空镜像（Dangling Images）

重新构建同名镜像时，旧版本的标签被新版本覆盖，旧镜像变成 `<none>:<none>` 的孤儿：

```bash
# 查看所有镜像（包括悬空的）
docker images -a

# 只看悬空镜像
docker images -f "dangling=true"
```

```
REPOSITORY     TAG       IMAGE ID       SIZE
my-app         latest    abc123         500MB   ← 正常镜像
<none>         <none>    def456         500MB   ← 悬空镜像（旧版，标签被覆盖）
```

### 安全清理命令

```bash
# 只清理悬空镜像（安全 ✅）
docker image prune

# 只清理停止的容器（安全 ✅）
docker container prune

# 只清理构建缓存（安全 ✅）
docker builder prune

# 只清理未使用的网络（安全 ✅）
docker network prune

# 只清理未使用的 volume（安全 ✅）
docker volume prune
```

### 组合清理

```bash
# 清理所有未使用资源（⚠️ 不删除已有镜像）
docker system prune

# 清理所有未使用资源（💀 包括未使用的镜像，会删除一切）
docker system prune -a
```

### 清理力度对比

| 命令 | 清理内容 | 危险程度 |
|------|----------|----------|
| `docker image prune` | 悬空镜像 | 安全 ✅ |
| `docker container prune` | 停止的容器 | 安全 ✅ |
| `docker builder prune` | 构建缓存/中间层 | 安全 ✅ |
| `docker network prune` | 未使用的网络 | 安全 ✅ |
| `docker volume prune` | 未使用的卷 | 安全 ✅ |
| `docker system prune` | 以上全清 | 低危 ⚠️ |
| `docker system prune -a` | 全部清空（含镜像） | 危险 💀 |

### 查看占用空间

```bash
# 查看各类型资源占用
docker system df

# 查看详细（包括悬空镜像）
docker system df -v
```
