# TPM 机密医疗助手 Demo

> 基于华为云 QingTian TPM 2.0 + K8s 的机密计算 Demo，展示医疗数据在"可信执行环境"中端到端加密处理的完整链路。

## 业务场景

用户通过浏览器咨询健康问题，敏感的健康数据（症状描述）在浏览器端通过 HPKE 加密后传输，**只有运行在可信 TEE（K8s Pod 内有 TPM 保护的环境）中的服务才能解密并处理**。

若服务运行在不具有 TPM 保护的 Pod 上，则无法解密，请求失败。

## 架构概览

```
Browser (React)                    K8s Pod (Backend+LLM)                 Huawei Cloud ECS
┌─────────────────────┐         ┌──────────────────────────┐         ┌────────────────┐
│                     │         │                          │         │                │
│  1. GET /attestation│────────▶│  /attestation            │────────▶│  /dev/tpm0     │
│     (fetch PCR)     │         │    → go-tpm read PCR    │         │  (QingTian TPM)│
│                     │◀────────│    → return PCR1/4      │◀────────│                │
│  2. Compare PCR     │         │                          │         │                │
│     vs golden       │         │  /key-exchange            │         │                │
│  3. HPKE key gen    │────────▶│    → DH key exchange     │         │                │
│     (X25519)        │         │    → return sessionId    │         │                │
│                     │◀────────│                          │         │                │
│  4. POST /chat      │         │  /chat                   │         │                │
│     (encrypted)     │────────▶│    → look up sessionId   │         │                │
│                     │         │    → decrypt with HPKE   │         │                │
│                     │         │    → call LLM            │         │                │
│                     │         │    → encrypt response    │         │                │
│                     │◀────────│                          │         │                │
│  5. decrypt &       │         │                          │         │                │
│     display         │         │                          │         │                │
└─────────────────────┘         └──────────────────────────┘         └────────────────┘
```

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 前端 | React + Next.js + TypeScript | 现有前端代码，不变 |
| 后端 | Go + `go-tpm` + `go-tpm-tools` | 新建 Go 服务 |
| TPM | 华为云 QingTian TPM 2.0 | 通过 `/dev/tpm0` 访问 |
| 加密 | HPKE (X25519 + HKDF-SHA256 + AES-128-GCM) | 前端用 `@hpke/core`，后端用 `golang.org/x/crypto` |
| LLM | llama.cpp server (qwen3.5-0.8B) | 端口 8001 `/inference` |
| K8s | K8s + device plugin | Pod 需挂载 `/dev/tpm0` |

## 三个核心接口

### 1. `GET /attestation`

前端主动拉取 PCR 值，用于验证后端是否运行在可信环境。

**请求：** 无需参数

**响应：**
```json
{
  "pcrs": { "1": "sha256:abc123...", "4": "sha256:def456..." },
  "publicKey": "base64-encoded-X25519-public-key",
  "mock": false
}
```

前端收到后，与预设的**黄金基线**比对：
- 一致 → 可信，继续密钥协商
- 不一致 → 拒绝通信

### 2. `POST /key-exchange`

前端生成临时 DH 密钥对，把公钥发过来，完成 HPKE 密钥协商。

**请求：**
```json
{
  "clientPublicKey": "base64-encoded-X25519-ephemeral-public-key"
}
```

**响应：**
```json
{
  "sessionId": "uuid-v4-session-id",
  "enc": "base64-ephemeral-public-key",
  "serverPublicKey": "base64-encoded-X25519-public-key"
}
```

后端根据 `sessionId` 维护 `sessionId → responseKey` 的映射，用于后续解密和加密响应。

### 3. `POST /chat`

加密对话接口，所有数据都用 HPKE 加密。

**请求：**
```json
{
  "sessionId": "uuid-v4-session-id",
  "enc": "base64-ephemeral-public-key",
  "ct": "base64-iv-plus-ciphertext"
}
```

**响应：** Streamable HTTP（`application/x-ndjson`），每行一个加密 chunk：
```
{"iv":"base64_iv","ct":"base64_ct"}
{"iv":"base64_iv","ct":"base64_ct"}
```

## PCR 验证流程

```
前端拉取 PCR → 对比黄金基线 → 通过则继续 → Key Exchange → Chat
```

黄金基线是什么？

- `PCR1`：Bootloader + OS loader 的哈希
- `PCR4`：Bootloader

这些值在**首次部署时从可信实例上获取**，配置到前端 Deployment 环境变量中。任何启动链篡改都会导致 PCR 值变化，前端拒绝通信。

**不需要**：TPM 签名验证、证书链验证、EventLog 重放。

## 项目结构

```
nitro-enclave-demo/
├── README.md                    # 本文档
│
├── frontend/                    # 现有 Next.js 前端（待改造指向 Go backend）
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── ...
│
├── backend/                    # 新建 Go 后端
│   ├── main.go                 # HTTP server，3个接口
│   ├── go.mod
│   ├── tpm/
│   │   ├── pcr.go             # PCR 读取
│   │   └── key.go             # HPKE 密钥对管理
│   ├── hpke/
│   │   └── hpke.go            # HPKE 加解密（X25519 + AES-128-GCM）
│   ├── session/
│   │   └── manager.go         # sessionId → responseKey 映射
│   └── llm/
│       └── client.go           # LLM 流式调用
│
├── docs/
│   └── k8s-deployment.md       # K8s 部署指南
│
├── Dockerfile                  # 前端镜像构建
├── Dockerfile.ollama            # LLM 镜像构建
└── Dockerfile.backend          # 后端镜像构建
```

## 环境变量

### Backend

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8000` | HTTP 服务端口 |
| `PCR_INDICES` | `mock` | 要读取的 PCR 索引，逗号分隔，如 `1,4,7`；空或 `mock` 为模拟模式 |
| `PCR_GOLDEN_BASELINE` | 空 | 格式 `1:sha256:abc...,4:sha256:def...`；可选，后端仅记录日志 |
| `TPM_DEVICE` | `/dev/tpm0` | TPM 设备路径 |
| `KEY_PATH` | `/var/lib/backend/enclave-key.json` | 公钥持久化路径 |
| `LLM_BASE_URL` | `http://localhost:8001` | LLM 服务地址 |
| `LLM_MODEL` | `qwen3.5` | 模型名称 |

### Frontend（待改造）

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_API_BASE` | 后端服务地址，如 `http://backend-svc:8000` |
| `NEXT_PUBLIC_PCR_GOLDEN_BASELINE` | 黄金基线，格式同 backend |
| `NEXT_PUBLIC_PCR_INDICES` | 要验证的 PCR 索引，如 `1,4` |

## 华为云 QingTian TPM 约束

- ECS 创建时需选择**启用 QingTian TPM** 的规格
- 镜像需是 **UEFI 启动模式**
- 切换规格时，目标规格**也必须支持 TPM**
- EventLog 上限 **64KB**，超过会导致引导失败

## 参考资料

- [华为云 QingTian TPM 用户指南](https://support.huaweicloud.com/intl/zh-cn/usermanual-ecs/ecs_03_3201.html)
- [华为云 QingTian Enclave SDK](https://support.huaweicloud.com/intl/en-us/usermanual-ecs/ecs_03_1415.html)
- [go-tpm-tools (Google)](https://github.com/google/go-tpm-tools)
- [RFC 9180: HPKE](https://www.rfc-editor.org/rfc/rfc9180.html)
