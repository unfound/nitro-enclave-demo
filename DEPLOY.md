# tpm-app 部署指南

## 目录

- [架构概览](#架构概览)
- [快速本地运行](#快速本地运行)
- [构建镜像](#构建镜像)
- [环境变量参考](#环境变量参考)
- [Kubernetes 部署](#kubernetes-部署)
- [网络通信排查](#网络通信排查)
- [日志解读](#日志解读)

---

## 架构概览

```
用户浏览器 (3000)
     │
     │ HTTP (Next.js API Routes)
     ▼
┌─────────────────────────────────────────────┐
│  Frontend  tpm-frontend                      │
│  Next.js Web UI + 加密/解密                   │
│  Port 3000                                  │
└──────────────┬──────────────────────────────┘
               │ HTTP /chat /key-exchange /attestation
               ▼
┌─────────────────────────────────────────────┐
│  Backend   tpm-backend                       │
│  Go TPM Attestation + HPKE 加密通信           │
│  Port 8000                                  │
└──────────────┬──────────────────────────────┘
               │ HTTP Streaming
               ▼
┌─────────────────────────────────────────────┐
│  LLM        tpm-llm                          │
│  llama.cpp server + Qwen3.5 GGUF             │
│  Port 8080                                  │
└─────────────────────────────────────────────┘
```

---

## 快速本地运行

```bash
# 1. 启动 LLM
docker run -d --name llm -p 8080:8080 tpm-llm

# 2. 启动 Backend（mock 模式）
docker run -d --name backend \
  -p 8000:8000 \
  -e USE_MOCK_TPM=true \
  -e LLM_BASE_URL=http://host.docker.internal:8080/v1/chat/completions \
  -e SYSTEM_PROMPT="你是tpm-app的智能助手，运行在Nitro Enclave中，回复简洁专业。" \
  tpm-backend

# 3. 启动 Frontend
docker run -d --name frontend \
  -p 3000:3000 \
  -e BACKEND_URL=http://host.docker.internal:8000 \
  tpm-frontend

# 4. 打开浏览器
open http://localhost:3000
```

> **注意**: macOS/Windows 上用 `host.docker.internal` 让容器访问宿主机。Linux 上用 `--add-host=host.docker.internal:host-gateway`。

---

## 构建镜像

### LLM（支持 multi-arch，x86 + ARM64 一次打完）

```bash
# 同时打两个平台
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.llm -t tpm-llm .

# 或只打当前机器架构
docker build -f Dockerfile.llm -t tpm-llm .
```

### Frontend（multi-arch 同上）

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.frontend -t tpm-frontend .
```

### Backend

**x86_64**（Docker 内编译）:
```bash
docker build -f Dockerfile.backend -t tpm-backend .
```

**ARM64**（需本地交叉编译后再打包）:
```bash
# 步骤 1: 本地编译 ARM64 binary
cd backend
GOOS=linux GOARCH=arm64 GOPROXY=https://goproxy.cn,direct \
  go build -ldflags="-s -w" -o backend .

# 步骤 2: 打包 ARM64 镜像
cd ..
docker buildx build --platform linux/arm64 \
  -f Dockerfile.backend.arm -t tpm-backend:arm64 .
```

---

## 环境变量参考

### Backend (`tpm-backend`)

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `8000` | 服务端口 |
| `USE_MOCK_TPM` | 开发/测试 | `false` | `true`=使用模拟 TPM，返回固定的 mock PCR 值 |
| `USE_MOCK_LLM` | 否 | `false` | `true`=使用模拟 LLM，不调用真实模型 |
| `ENCLAVE_MODE` | 否 | `false` | `true`=强制检查 TPM 设备 |
| `TPM_DEVICE` | 否 | `/dev/tpm0` | TPM 设备路径 |
| `LLM_BASE_URL` | **是** | - | LLM API 完整地址，**必须包含路径**，如 `http://llm:8080/v1/chat/completions` |
| `LLM_MODEL` | 否 | `qwen3.5` | 模型名称（传给 LLM API 的 model 字段） |
| `SYSTEM_PROMPT` | 否 | 空 | 系统提示词，注入每次 LLM 对话的起始位置 |
| `KEY_PATH` | 否 | - | 密钥文件路径 |
| `PCR_INDICES` | 否 | 空 | PCR 索引列表，逗号分隔，如 `0,1,2,3,4` |
| `PCR_GOLDEN_BASELINE` | 否 | 空 | Golden baseline，格式 `idx:value;idx:value`，如 `1:sha256:abc;4:sha256:def` |

### Frontend (`tpm-frontend`)

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `BACKEND_URL` | **是** | `http://localhost:8000` | Backend 服务地址（容器内访问时用 K8s Service DNS） |
| `NEXT_PUBLIC_API_BASE` | 否 | `http://localhost:8000` | 同 BACKEND，供客户端使用 |
| `NEXT_PUBLIC_PCR_GOLDEN_BASELINE` | 否 | mock 值 | 前端页面显示用的 baseline，格式 `1:sha256:...` |
| `NODE_ENV` | 否 | `production` | 固定为 `production` |
| `PORT` | 否 | `3000` | 服务端口 |

### LLM (`tpm-llm`)

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LLAMA_ARG_MODEL` | 是 | - | 模型文件路径，镜像内为 `/models/Qwen3.5-0.8B-Q4_K_M.gguf` |
| `LLAMA_ARG_ALIAS` | 否 | `qwen3.5` | API 模型名称 |
| `LLAMA_ARG_CTX_SIZE` | 否 | `1024` | 上下文窗口大小 |
| `LLAMA_ARG_N_PREDICT` | 否 | `256` | 最大生成长度 |
| `LLAMA_ARG_REASONING` | 否 | `off` | `off`=关闭 Qwen 思考模式（CPU 推荐关闭） |

---

## Kubernetes 部署

### 前提条件

- Kubernetes 1.24+
- 支持 ARM64 节点（或用 amd64 镜像）
- 已构建并推送镜像到 Registry

### 推送镜像示例

```bash
# 登录 Registry
docker login your-registry.com

# 给镜像打标签
docker tag tpm-llm:arm64   your-registry.com/tpm/tpm-llm:v1.0
docker tag tpm-frontend:arm64 your-registry.com/tpm/tpm-frontend:v1.0
docker tag tpm-backend:arm64  your-registry.com/tpm/tpm-backend:v1.0

# 推送
docker push your-registry.com/tpm/tpm-llm:v1.0
docker push your-registry.com/tpm/tpm-frontend:v1.0
docker push your-registry.com/tpm/tpm-backend:v1.0
```

### 完整 K8s 部署 YAML

```yaml
# namespace
apiVersion: v1
kind: Namespace
metadata:
  name: tpm-app
---
# LLM Service
apiVersion: v1
kind: Service
metadata:
  name: tpm-llm
  namespace: tpm-app
spec:
  selector:
    app: tpm-llm
  ports:
    - name: http
      port: 8080
      targetPort: 8080
---
# Backend Service
apiVersion: v1
kind: Service
metadata:
  name: tpm-backend
  namespace: tpm-app
spec:
  selector:
    app: tpm-backend
  ports:
    - name: http
      port: 8000
      targetPort: 8000
---
# Frontend Service
apiVersion: v1
kind: Service
metadata:
  name: tpm-frontend
  namespace: tpm-app
spec:
  type: LoadBalancer
  selector:
    app: tpm-frontend
  ports:
    - name: http
      port: 80
      targetPort: 3000
---
# LLM Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tpm-llm
  namespace: tpm-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: tpm-llm
  template:
    metadata:
      labels:
        app: tpm-llm
    spec:
      containers:
        - name: tpm-llm
          image: your-registry.com/tpm/tpm-llm:v1.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "2"
              memory: 4Gi
            limits:
              cpu: "4"
              memory: 8Gi
          env:
            - name: LLAMA_ARG_MODEL
              value: /models/Qwen3.5-0.8B-Q4_K_M.gguf
            - name: LLAMA_ARG_ALIAS
              value: qwen3.5
            - name: LLAMA_ARG_REASONING
              value: "off"
            - name: LLAMA_ARG_CTX_SIZE
              value: "1024"
          # 健康检查
          livenessProbe:
            httpGet:
              path: /v1/models
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /v1/models
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
---
# Backend Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tpm-backend
  namespace: tpm-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: tpm-backend
  template:
    metadata:
      labels:
        app: tpm-backend
    spec:
      containers:
        - name: tpm-backend
          image: your-registry.com/tpm/tpm-backend:v1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "500m"
              memory: 256Mi
            limits:
              cpu: "2"
              memory: 1Gi
          env:
            # ── LLM 配置（必填）─────────────────────────────
            # 注意: LLM_BASE_URL 必须包含完整路径 /v1/chat/completions
            - name: LLM_BASE_URL
              value: http://tpm-llm:8080/v1/chat/completions
            - name: LLM_MODEL
              value: qwen3.5
            # ── TPM 配置──────────────────────────────────────
            # 开发/测试: USE_MOCK_TPM=true
            # 生产: 设 false，并配置 PCR_INDICES 和 PCR_GOLDEN_BASELINE
            - name: USE_MOCK_TPM
              value: "true"
            - name: USE_MOCK_LLM
              value: "false"
            - name: ENCLAVE_MODE
              value: "false"
            # ── 系统提示词（可在 ConfigMap 或这里直接配置）─────
            - name: SYSTEM_PROMPT
              value: "你是tpm-app的智能助手，运行在Nitro Enclave中，回复简洁专业。"
            # ── 生产环境 PCR 配置（USE_MOCK_TPM=false 时）────
            # - name: PCR_INDICES
            #   value: "0,1,2,3,4"
            # - name: PCR_GOLDEN_BASELINE
            #   value: "1:sha256:your_baseline_1;4:sha256:your_baseline_4"
          # 健康检查
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 3
            periodSeconds: 10
---
# Frontend Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tpm-frontend
  namespace: tpm-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: tpm-frontend
  template:
    metadata:
      labels:
        app: tpm-frontend
    spec:
      containers:
        - name: tpm-frontend
          image: your-registry.com/tpm/tpm-frontend:v1.0
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: "200m"
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 1Gi
          env:
            - name: BACKEND_URL
              # K8s 内部 DNS: service-name.namespace.svc.cluster.local
              value: http://tpm-backend:8000
            - name: NEXT_PUBLIC_API_BASE
              value: http://tpm-backend:8000
            - name: NODE_ENV
              value: production
            # Mock 模式的 golden baseline（生产时替换为真实值）
            - name: NEXT_PUBLIC_PCR_GOLDEN_BASELINE
              value: "1:sha256:mock_pcr1_value_for_demo,4:sha256:mock_pcr4_value_for_demo"
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
```

### 部署命令

```bash
kubectl apply -f deployment.yaml
# 查看 pod 状态
kubectl get pods -n tpm-app
# 查看 backend 日志
kubectl logs -n tpm-app -l app=tpm-backend -f
# 查看 frontend 日志
kubectl logs -n tpm-app -l app=tpm-frontend -f
```

### 生产环境关键变更

1. **`USE_MOCK_TPM=false`** — 启用真实 TPM
2. **配置 `PCR_INDICES`** — 指定要读取的 PCR 索引（需要和 Nitro Enclave 的 PCR 值对应）
3. **配置 `PCR_GOLDEN_BASELINE`** — 设置 expected PCR 值用于校验
4. **`ENCLAVE_MODE=true`** — 开启 Enclave 严格模式
5. **配置 `SYSTEM_PROMPT`** — 根据业务需求设定系统提示词
6. **配置真实镜像 Tag** — 将 `v1.0` 替换为实际版本

---

## 网络通信排查

### 常见问题 1: frontend 连不上 backend

**症状**: attestation 显示"未在可信环境运行"，前端控制台有 fetch 错误

**排查步骤**:

```bash
# 1. 确认 backend 已启动
kubectl get pods -n tpm-app -l app=tpm-backend

# 2. 在 frontend pod 里测试连通性
kubectl exec -n tpm-app -it deploy/tpm-frontend -- sh -c "wget -q -O- http://tpm-backend:8000/health"

# 3. 检查 BACKEND_URL 环境变量
kubectl exec -n tpm-app deploy/tpm-frontend -- env | grep BACKEND

# 4. 查看 frontend 日志（浏览器控制台或 pod 日志）
kubectl logs -n tpm-app -l app=tpm-frontend --tail=50
```

**常见原因**:
- `BACKEND_URL` 设为 `localhost:8000` — 容器内 localhost 指自己，应设为 `http://tpm-backend:8000`
- Backend 未就绪 — 前端在 Backend 启动前就发起请求（添加 readinessProbe 解决）

---

### 常见问题 2: backend 连不上 LLM

**症状**: 后端日志显示 `LLM Stream: status=404` 或 `connection refused`

**排查步骤**:

```bash
# 1. 确认 LLM 已启动
kubectl get pods -n tpm-app -l app=tpm-llm

# 2. 在 backend pod 里测试连通性
kubectl exec -n tpm-app -it deploy/tpm-backend -- wget -q -O- http://tpm-llm:8080/v1/models

# 3. 检查 LLM_BASE_URL 配置
#    必须包含完整路径: http://tpm-llm:8080/v1/chat/completions
#    如果只设了 http://tpm-llm:8080 会 404（代码直接拼接路径，不二次处理）
kubectl exec -n tpm-app deploy/tpm-backend -- env | grep LLM_BASE_URL

# 4. 查看 backend 日志
kubectl logs -n tpm-app -l app=tpm-backend --tail=30
```

**常见原因**:
- `LLM_BASE_URL` 缺少 `/v1/chat/completions` 路径
- LLM 启动慢，backend 启动时 LLM 还未就绪（加 `wait-for` initContainer 解决）

---

### 常见问题 3: attestation 始终显示"未在可信环境"

**排查步骤**:

```bash
# 1. 直接查 backend attestation 接口
kubectl exec -n tpm-app deploy/tpm-backend -- \
  wget -q -O- http://localhost:8000/attestation

# 2. 观察 backend 日志的 [TPM] 输出
kubectl logs -n tpm-app -l app=tpm-backend -f | grep TPM
```

**Mock 模式** (`USE_MOCK_TPM=true`) 应该返回:
```json
{"pcrs":{"1":"sha256:mock_pcr1_value_for_demo","4":"sha256:mock_pcr4_value_for_demo"},"trusted":true,"mock":true}
```

**真实 TPM 模式** (`USE_MOCK_TPM=false`) 需要:
- TPM 设备挂载到容器 (`/dev/tpm0`)
- 正确配置 `PCR_INDICES` 和 `PCR_GOLDEN_BASELINE`

---

### 网络连通性测试脚本

```bash
# 在集群内任意 pod 里测试
kubectl run debug --image=busybox --rm -it --restart=Never -- \
  sh -c "
  # 测试 frontend → backend
  wget -q -O- http://tpm-backend:8000/health && echo 'backend OK'

  # 测试 backend → LLM
  wget -q -O- http://tpm-llm:8080/v1/models && echo 'llm OK'
  "
```

---

## 日志解读

### Backend 日志前缀

| 前缀 | 含义 |
|------|------|
| `[HTTP   IN ]` | 收到 HTTP 请求 |
| `[HTTP   OUT]` | HTTP 响应发出 |
| `[HTTP   ERR]` | HTTP 处理内部错误 |
| `[TPM         ]` | TPM 操作（mock/真实 PCR 读取） |
| `[HPKE        ]` | HPKE 密钥交换、解密操作 |
| `[LLM         ]` | LLM API 调用（OUT=发请求，IN=收响应，ERR=错误） |
| `[LLM   OUT ]` | LLM client 发出请求（可看完整 body） |
| `[LLM   IN  ]` | LLM client 收到响应（可看完整响应） |

### 典型正常流程日志

```
main.go:136: [HTTP   IN ] GET /attestation
main.go:150: [TPM         ] Mock 模式，返回模拟 PCR 值
main.go:183: [HTTP   OUT] /attestation trusted=true mock=true pcrs=2

main.go:189: [HTTP   IN ] POST /key-exchange
main.go:218: [HPKE        ] 收到客户端公钥 len=44
main.go:220: [HPKE        ] 密钥交换成功，sessionID=... responseKey=...
main.go:234: [HTTP   OUT] /key-exchange 200 sessionID=...

main.go:236: [HTTP   IN ] POST /chat
main.go:251: [HTTP        ] sessionID=... ct_len=...
main.go:253: [HPKE        ] 解密成功 plaintext_len=...
main.go:258: [LLM         ] 调用 LLM prompt_len=...
client.go:88: [LLM   OUT ] POST http://.../v1/chat/completions | bodylen=...
client.go:95: [LLM   IN ] status=200
client.go:106: [LLM   IN ] 开始读取流...
client.go:140: [LLM   IN ] 流正常结束，共 15 chunks
main.go:310: [LLM         ] LLM 流正常结束
main.go:312: [HTTP   OUT] /chat 完成
```

### 常见错误模式

```
# LLM 404 — LLM_BASE_URL 路径不对
[LLM   OUT ] POST http://llm:8080 | bodylen=115
[LLM   IN ] status=404

# 连接被拒绝 — LLM 未启动或 IP 错误
[LLM   ERR] 连接失败: dial tcp ...: connection refused

# Session 不存在 — key-exchange 未完成或 sessionID 过期
[HTTP   ERR] Session 不存在 sessionID=...

# TPM 读取失败 — 真实 TPM 模式下设备不可用
[TPM         ] PCR 读取失败: open /dev/tpm0: no such file or directory

# PCR 不匹配 — Golden baseline 和实际 PCR 值不符
[TPM         ] 警告: PCR1 不匹配 — 收到 sha256:abc，期望 sha256:def
```

### 前端日志（浏览器控制台）

```
[API /attestation] → GET http://backend:8000/attestation
[API /attestation] ← trusted=true mock=true publicKey=7FdpPugBsoN...

[API /key-exchange] → POST http://backend:8000/key-exchange clientPublicKey=AAAA...
[API /key-exchange] ← sessionId=ffa345787eb8d1d9 responseKey=a0ca0377... serverPublicKey=4yrq...

[API /chat] → POST http://backend:8000/chat sessionId=ffa34578... ct_len=512
[API /chat] ← 流结束 chunkCount=15
```
