# 构建指南

## 架构概览

三服务分层：

```
llm (8080) → backend (8000) → frontend (3000)
```

## 构建方式

### 方式一：docker compose（推荐）

```bash
# 构建全部三个服务
docker compose build

# 启动全部
docker compose up -d

# 查看日志
docker compose logs -f
```

### 方式二：docker-build.sh 脚本

```bash
./docker-build.sh build    # 构建所有镜像
./docker-build.sh up       # 启动所有服务
./docker-build.sh down     # 停止
./docker-build.sh all      # 构建 + 启动
```

## 各服务 Dockerfile

| 服务 | Dockerfile | 说明 |
|------|-----------|------|
| LLM 推理 | `Dockerfile.llm` | alpine-llama-cpp-server + GGUF 模型 |
| Go 后端 | `Dockerfile.backend` | golang:alpine 编译 Go 二进制 |
| Next.js 前端 | `Dockerfile.frontend` | 多阶段构建，standalone 输出 |

## 单独构建某个服务

```bash
# LLM 服务
docker build -f Dockerfile.llm -t tpm-app-llm .

# Go 后端
docker build -f Dockerfile.backend -t tpm-app-backend .

# 前端
docker build -f Dockerfile.frontend -t tpm-app-frontend .
```

## 本地开发构建

### 后端

```bash
cd backend
go build -o backend .
./backend
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

## 环境变量

| 服务 | 变量 | 默认值 |
|------|------|--------|
| llm | `PORT` | `8080` |
| llm | `MODEL` | `/models/Qwen2.5-7B-Instruct-Q5_K_M.gguf` |
| backend | `ENCLAVE_MODE` | `false` |
| backend | `LLM_BASE_URL` | `http://llm:8080` |
| frontend | `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |

详见 [docker-guide.md](./docker-guide.md)。
