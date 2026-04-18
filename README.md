# Nitro Enclave 机密医疗助手 Demo

> 通过 AWS Nitro Enclave 机密计算能力，展示医疗数据在"可信执行环境"中端到端加密处理的完整链路。

## 业务场景

用户通过浏览器咨询健康问题，敏感的健康数据（症状描述）在浏览器端通过 HPKE 加密后传输，**只有运行在 Nitro Enclave 中的服务才能解密并处理**。若服务运行在普通 VM 上，则无法解密，任务失败。

**对比演示：**
- ✅ Enclave 模式：公钥分发 → HPKE 加密请求 → Enclave 内解密 → LLM 推理 → HPKE 加密响应 → 客户端解密显示
- ❌ Non-Enclave 模式：无法提供可信公钥 → 请求加密后无法解密 → 返回错误

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js (App Router) — 前后端一体 |
| 前端 | React + Vercel AI SDK (`useChat`) + TypeScript |
| 加密 | `@noble/curves` (X25519) + `@noble/ciphers` (AES-256-GCM) + Web Crypto (HKDF-SHA256) |
| 后端 | Next.js API Routes + Vercel AI SDK (`streamText`) |
| LLM | 本地 qwen 模型 (OpenAI 兼容 API)，初始阶段用 mock |

## 加密通信架构

```
Browser (React)                        Next.js Server
┌─────────────────────┐               ┌──────────────────────────┐
│                     │               │                          │
│  1. GET /api/       │               │  /api/attestation        │
│     attestation     │──────────────>│    → 读取 ENCLAVE_MODE   │
│                     │               │    → true: 返回公钥+证明  │
│                     │<──────────────│    → false: 返回未认证    │
│                     │               │                          │
│  2. HPKE.Seal(      │               │  /api/chat               │
│     messages, pk)   │               │                          │
│     → enc + ct      │               │  Enclave 模式:           │
│                     │  POST         │    HPKE.Open(enc,ct,sk)  │
│  3. { enc, ct }     │──────────────>│    → decrypt messages    │
│                     │               │    → LLM.call(messages)  │
│                     │               │    → encrypt response    │
│                     │<──────────────│    → stream encrypted    │
│                     │               │                          │
│  4. decrypt chunks  │               │  Non-Enclave 模式:       │
│     → display       │               │    → reject / 明文直通    │
└─────────────────────┘               └──────────────────────────┘
```

## HPKE 双向加密方案

利用 HPKE 的 `export` 功能派生双向密钥，一次密钥协商同时保护请求和响应：

```
Client                                    Server
  │                                         │
  │  ① generateKeyPair() → (pk_c, sk_c)     │
  │  ② HPKE.Seal(server_pk, prompt)         │
  │     → enc(公钥), ct(密文), ss(共享密钥)    │
  │                                         │
  │  ③ export(ss, "hpke-demo-bidirectional") │
  │     → ikm                               │
  │  ④ HKDF(ikm, "request")  → reqKey       │
  │     HKDF(ikm, "response") → respKey     │
  │                                         │
  │  POST { enc, ct } ───────────────────>   │
  │                                         │  ⑤ Decap(enc, ct, server_sk)
  │                                         │     → ss(共享密钥)
  │                                         │  ⑥ export(ss, "hpke-demo-bidirectional")
  │                                         │     → ikm
  │                                         │  ⑦ HKDF(ikm, "request")  → reqKey
  │                                         │     HKDF(ikm, "response") → respKey
  │                                         │  ⑧ AES-GCM-decrypt(ct, reqKey) → prompt
  │                                         │  ⑨ LLM(prompt) → response
  │                                         │  ⑩ AES-GCM-encrypt(chunk, respKey) → each chunk
  │                                         │
  │  <───── encrypted stream chunks ─────── │
  │  ⑪ AES-GCM-decrypt(chunk, respKey)      │
  │     → display                           │
```

**关键点：**
- 一次 HPKE 握手，派生两个对称密钥（请求密钥 + 响应密钥）
- 请求：HPKE 原生加密（非对称）
- 响应：AES-256-GCM 对称加密（分块加密，保留流式体验）
- Non-Enclave 模式下，服务端没有私钥 → 无法执行步骤 ⑤ → 解密失败

## 流式传输协议选型：SSE vs Streamable HTTP

### 选型结论：Plain 模式用 SSE，Encrypted 模式用 Streamable HTTP

| 维度 | SSE (`text/event-stream`) | Streamable HTTP (Chunked) |
|------|---------------------------|---------------------------|
| **格式** | 强制 `data: ...\n\n` 前缀 | 自由，每块是任意字节 |
| **POST 支持** | `EventSource` 不支持 POST | 天然支持 |
| **代理兼容** | 差 — 很多 CDN/LB 会缓冲或断连 | 好 — 标准 HTTP，所有代理支持 |
| **自定义数据格式** | 需编码到 `data:` 内 | 直接写原始字节 |
| **Vercel AI SDK** | v4 默认 (`toDataStreamResponse`) | v5 趋势 (`toUIMessageStreamResponse`) |

本 Demo 采用**双轨策略**：
- **Plain 模式**：走 Vercel AI SDK 内置 SSE（`useChat` + `streamText`），零额外工作
- **Encrypted 模式**：走 Streamable HTTP（`ReadableStream` + chunked transfer），前端 `fetch` + `getReader()` 逐块读取解密

加密数据本质是二进制/自定义格式，套 SSE 的 `data:` 前缀是多余包装。Streamable HTTP 更直接，和行业趋势（MCP、Vercel AI SDK v5）一致。

### 流式响应加密细节

每个 LLM 流式输出的 chunk 独立 AES-256-GCM 加密：

```
传输格式 (Streamable HTTP, newline-delimited JSON):
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
Transfer-Encoding: chunked

{"iv":"base64_iv","ct":"base64_ct"}\n
{"iv":"base64_iv","ct":"base64_ct"}\n
```

前端读取方式：
```typescript
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop()!; // 保留不完整行
  for (const line of lines) {
    if (!line.trim()) continue;
    const { iv, ct } = JSON.parse(line);
    const plaintext = await decryptChunk(iv, ct, responseKey);
    // append to UI...
  }
}
```

- 每个 chunk 使用独立随机 IV（12 bytes）
- 前端逐行解析 JSON → 解密 → 拼接显示
- 保留流式体验的同时实现端到端加密

## API 设计

### `GET /api/attestation`

返回当前服务的可信环境状态和加密公钥。

**Enclave 模式返回：**
```json
{
  "trusted": true,
  "publicKey": "base64-encoded-X25519-public-key",
  "attestation": {
    "module_id": "i-0abc123...-enc9876...",
    "timestamp": "2026-04-18T09:00:00Z",
    "pcrs": {
      "0": "sha384:ab3f...",
      "1": "sha384:cd7e...",
      "2": "sha384:ef1a..."
    },
    "certificate": "MIIC...",
    "cabundle": ["MIID..."]
  }
}
```

**Non-Enclave 模式返回：**
```json
{
  "trusted": false,
  "publicKey": null,
  "attestation": null
}
```

### `POST /api/chat`

处理对话请求。前端根据模式决定是否加密请求体。

**Plain 模式请求体（non-encrypted，使用 Vercel AI SDK 流式）：**
```json
{
  "messages": [
    { "role": "user", "content": "我头疼发烧怎么办？" }
  ]
}
```
响应：SSE 流（标准 Vercel AI SDK `text/event-stream` 格式）

**Encrypted 模式请求体：**
```json
{
  "encrypted": true,
  "enc": "base64-encapsulated-key",
  "ct": "base64-ciphertext"
}
```
响应：Streamable HTTP 流（`application/x-ndjson`，每行一个加密 chunk JSON）

**解密失败响应（Non-Enclave 收到加密请求）：**
```json
{
  "error": "SERVICE_NOT_IN_ENCLAVE",
  "message": "服务未在可信执行环境中运行，无法处理加密数据"
}
```

## 项目结构

```
nitro-enclave-demo/
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── .env.local                       # ENCLAVE_MODE=true
│
├── src/
│   ├── app/
│   │   ├── layout.tsx               # 根布局
│   │   ├── page.tsx                 # 主页面（组装 attestation + chat）
│   │   ├── globals.css              # 样式
│   │   └── api/
│   │       ├── attestation/
│   │       │   └── route.ts         # 可信环境认证 + 公钥分发
│   │       └── chat/
│   │           └── route.ts         # 对话接口（plain + encrypted 双模）
│   │
│   ├── lib/
│   │   ├── types.ts                 # 类型定义
│   │   ├── enclave.ts               # Enclave 密钥管理（持久化 X25519 密钥对）
│   │   ├── crypto.ts                # HPKE 加解密（X25519 + AES-256-GCM，客户端/服务端共用）
│   │   └── llm.ts                   # LLM 调用（mock → qwen）
│   │
│   └── components/
│       ├── ChatPanel.tsx             # 对话主组件（明文 / 加密双模式）
│       └── AttestationBadge.tsx      # 可信环境状态指示器
│
└── public/
```

## 实施步骤

| # | 内容 | 验证标准 |
|---|------|---------|
| 1 | 项目初始化：create-next-app + 安装依赖 | `npm run dev` 白屏不报错 |
| 2 | 密钥管理：服务端启动时生成 X25519 密钥对 | `curl /api/attestation` 返回公钥 |
| 3 | 前端 HPKE 加密：用 @noble 加密测试文本 | 服务端能正确解密 |
| 4 | 对话 UI：useChat + plain 模式跑通 | 能明文对话并显示 mock 回复 |
| 5 | 端到端加密链路：前端加密 → 后端解密 → mock LLM → 加密响应 → 前端解密 | 整条链路完整跑通 |
| 6 | Enclave 切换：`ENCLAVE_MODE=false` 时拒绝解密 | 前端显示不可信状态，发送加密请求返回错误 |
| 7 | 接真实 LLM：替换 mock 为本地 qwen | 真实推理结果通过加密链路返回 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENCLAVE_MODE` | `true` | `true`=可信环境模式，`false`=普通 VM 模式 |
| `LLM_BASE_URL` | `http://192.168.0.120:8888/v1` | 本地 qwen 模型地址 |
| `LLM_MODEL` | `qwen3.5-9b` | 模型名称 |
| `LLM_API_KEY` | `not-needed` | API Key（本地模型通常不需要） |

## Demo 流程演示脚本

1. 打开页面 → 显示"✅ 可信环境已认证"badge + 公钥指纹
2. 在输入框输入："我最近头疼、发烧38.5°、咳嗽有黄痰，持续3天了"
3. 点击发送 → 消息气泡显示 🔒 图标
4. 后台：前端 HPKE 加密 → POST → 后端解密 → LLM 推理 → 加密响应
5. 前台：收到加密流 → 逐块解密 → 显示医疗建议
6. 点击"切换为普通 VM 模式"→ badge 变红"❌ 未在可信环境运行"
7. 再次发送相同问题 → 收到错误："服务未在可信执行环境中运行，无法处理加密数据"
8. 对比两次结果，演示机密计算的价值
