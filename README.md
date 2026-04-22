# TPM 机密医疗助手 Demo

> 基于华为云 QingTian TPM 2.0 + K8s 的机密计算 Demo，展示医疗数据在"可信执行环境"中端到端加密处理的完整链路。

## 业务场景

用户通过浏览器咨询健康问题，敏感的健康数据（症状描述）在浏览器端通过 HPKE 加密后传输，**只有运行在可信 TEE（K8s Pod 内有 TPM 保护的环境）中的服务才能解密并处理**。

若服务运行在不具有 TPM 保护的 Pod 上，则无法解密，请求失败。

## 架构概览

```
Browser (React)                    K8s Pod (Backend)                    Huawei Cloud ECS
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
| 后端 | Go + `go-tpm-tools` | 新建 Go 服务 |
| TPM | 华为云 QingTian TPM 2.0 | 通过 `/dev/tpm0` 访问 |
| 加密 | HPKE (X25519 + HKDF-SHA256 + AES-128-GCM) | 前端用 `@hpke/core`，后端用 `github.com/go hpke/core` |
| LLM | 本地 qwen 模型 (OpenAI 兼容 API) | 端口 8001 `/inference` |
| K8s | K8s + device plugin | Pod 需挂载 `/dev/tpm0` |

## 三个核心接口

### 1. `GET /attestation`

前端主动拉取 PCR 值，用于验证后端是否运行在可信环境。

**请求：** 无需参数

**响应：**
```json
{
  "pcr1": "sha256:abc123...",
  "pcr4": "sha256:def456...",
  "publicKey": "base64-encoded-X25519-public-key"
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
  "enc": "base64-encapsulated-key",
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
{"iv":"base64_iv","ct":"base64_ct"}\n
{"iv":"base64_iv","ct":"base64_ct"}\n
```

## PCR 验证流程

```
前端拉取 PCR → 对比黄金基线 → 通过则继续 → Key Exchange → Chat
```

黄金基线是什么？

- `PCR1`：Bootloader + OS loader 的哈希
- `PCR4`：Bootloader

这些值在**首次部署时从可信实例上获取**，固化到前端代码中。任何启动链篡改都会导致 PCR 值变化，前端拒绝通信。

**不需要**：TPM 签名验证、证书链验证、EventLog 重放。

## 后端：Go + go-tpm-tools

### 为什么用 Go？

| 对比 | Go | Python | TS |
|---|---|---|---|
| TPM 库 | `google/go-tpm`（纯 Go，无 cgo） | `tpm2-pytss`（需 TSS 库 + cgo） | `node-tpm`（需 native addon） |
| 容器内运行 | ✅ 编译成 static binary，无需装包 | ⚠️ 需装 `tpm2-tools` | ❌ 需编译 native addon |
| K8s 兼容 | ✅ 纯 Go，可 multi-arch build | 一般 | 一般 |
| HPKE | `github.com/go hpke/core` | `hpkejs` 或 pyhpke | `@hpke/core` |

Go 的 `google/go-tpm` 是 Google 维护的成熟库，PCR 读取、Quote 生成、密钥 Seal/Unseal 都有完整实现，且**没有 cgo 依赖**，可以编译成完全静态的 binary 放进容器。

### 关键 Go 模块

```
backend/
├── main.go                  # HTTP server，3个接口
├── tpm/
│   └── pcr.go              # PCR 读取封装
├── hpke/
│   └── hpke.go             # HPKE 加解密（X25519 + AES-128-GCM）
├── session/
│   └── manager.go          # sessionId → responseKey 映射
└── llm/
    └── client.go           # 调用本地 LLM 服务（端口8001）
```

### TPM PCR 读取核心代码

```go
import (
    "github.com/google/go-tpm/legacy/tpm2"
    "github.com/google/go-tpm-tools/client"
)

func ReadPCRs() (pcr1, pcr4 string, err error) {
    // 打开 TPM 设备（容器需挂载 /dev/tpm0）
    tpm, err := tpm2.OpenTPM("/dev/tpm0")
    if err != nil {
        return "", "", err
    }
    defer tpm.Close()

    // 读取 PCR1 和 PCR4（SHA256 bank）
    pcrs, err := client.ReadPCRs(tpm, 1, 4)
    if err != nil {
        return "", "", err
    }

    return pcrs[1], pcrs[4], nil
}
```

### 容器内运行前提

K8s Pod 需要能访问 `/dev/tpm0`，通过以下方式之一实现：

1. **Device Plugin**（推荐）：K8s 原生设备发现 + 挂载
2. **HostPath volume**：`hostPath: /dev/tpm0`
3. **Privileged Pod**（不推荐，生产环境禁用）

## 前端：现有 Next.js 代码

前端代码**保持不变**，只需要改造调用后端的地方：

| 改动点 | 说明 |
|--------|------|
| `/api/attestation` → `http://backend:8000/attestation` | 指向 K8s Service |
| 新增 `key-exchange` 调用 | 在发加密消息前先完成密钥协商 |
| `sessionId` 状态管理 | 存储 key-exchange 返回的 sessionId |

前端 HPKE 加密逻辑（`crypto.ts`）**不需要改**，继续用 `@noble/curves` + `@noble/ciphers`。

## HPKE 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| KEM | X25519 | 临时 DH 密钥交换 |
| KDF | HKDF-SHA256 | 密钥派生 |
| AEAD | AES-128-GCM | 对称加密 |

前端用 `@hpke/core`，后端用 Go `github.com/go hpke/core`。

## LLM 服务

独立的 LLM 推理服务，端口 8001：

```
POST /inference
Content-Type: application/json

{"prompt": "user message", "system_prompt": "..."}

响应：SSE 流，逐 token 输出
```

## 项目结构（分支后）

```
nitro-enclave-demo/
├── README.md                    # 本文档
├── frontend/                    # 现有 Next.js 前端（未来迁移到这里）
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── ...
│
└── backend/                    # 新建 Go 后端
    ├── main.go
    ├── go.mod
    ├── go.sum
    ├── tpm/
    │   └── pcr.go
    ├── hpke/
    │   └── hpke.go
    ├── session/
    │   └── manager.go
    └── llm/
        └── client.go
```

## 实施步骤

| # | 内容 | 验证标准 |
|---|------|---------|
| 1 | 创建 `tpm` 分支，提交本文档 | `git log` 可见 |
| 2 | Go 后端骨架：`/attestation` 接口读 PCR | curl 返回真实 PCR 值 |
| 3 | `key-exchange` 接口：HPKE DH + session 管理 | 前后端能建立 session |
| 4 | `chat` 接口：解密 → 调用 LLM → 加密响应 | 加密链路完整 |
| 5 | 前端改造：指向 Go backend + 调用 key-exchange | UI 能跑通 |
| 6 | 部署到 K8s：配置 device plugin 挂载 TPM | Pod 内 `/dev/tpm0` 可访问 |
| 7 | PCR 黄金基线固化到前端 | 重启后 PCR 变化前端拒绝 |

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
