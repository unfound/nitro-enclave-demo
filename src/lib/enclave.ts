/**
 * Enclave 密钥管理与 attestation 认证。
 *
 * 当前实现：Mock 模式，密钥本地生成，attestation 文档为模拟数据。
 *
 * 真实环境部署说明：
 * ==================
 * 1. X25519 密钥对由 Nitro Enclave 内部生成，私钥永远不会离开 Enclave
 * 2. Attestation 文档通过 vsock 从 Nitro Secure Module (NSM) 获取
 * 3. 前端通过 attestation 文档验证服务确实在 Enclave 中运行
 *
 * 迁移到真实环境时，取消注释标记了 [真实环境] 的代码块即可。
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface EnclaveKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

// 密钥对持久化路径（仅 mock 模式使用，真实环境中密钥由 Enclave 内部管理）
const KEYPAIR_PATH = join(process.cwd(), '.enclave-keypair.json');

/**
 * 加载或生成 X25519 密钥对。
 *
 * [Mock 模式] — 当前实现：
 *   密钥本地生成并保存到文件，跨进程复用。
 *
 * [真实环境] — 部署到 Nitro Enclave 时的实现方式：
 *
 *   方式 A：Enclave 内部生成并持久化到 KMS
 *   ----------------------------------------
 *   1. Enclave 启动时，用 x25519 生成密钥对
 *   2. 通过 AWS KMS Encrypt 将私钥加密后存储到 S3/DynamoDB
 *   3. 后续启动从 KMS 解密恢复，确保私钥只在 Enclave 内明文存在
 *
 *   方式 B：使用 Nitro Enclave 内置的 KMS Proxy
 *   ----------------------------------------
 *   1. Enclave 内可通过 vsock 连接 KMS 端点 (127.0.0.1:8001)
 *   2. 使用 GenerateDataKey API 生成对称密钥，由 KMS 保证密封
 *   3. 密钥材料永远不会以明文形式离开 Enclave
 *
 *   代码示例（方式 A）：
 *
 *   // import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
 *
 *   const KMS_KEY_ARN = process.env.KMS_KEY_ARN!; // CMK ARN
 *   const S3_BUCKET = process.env.KEY_STORAGE_BUCKET!;
 *
 *   async function loadOrGenerateKeyPair(): Promise<EnclaveKeyPair> {
 *     const s3 = new S3Client({});
 *
 *     // 尝试从 S3 加载已加密的密钥
 *     try {
 *       const obj = await s3.send(new GetObjectCommand({
 *         Bucket: S3_BUCKET,
 *         Key: 'enclave-keypair.enc',
 *       }));
 *       const encrypted = await obj.Body!.transformToByteArray();
 *
 *       // 通过 KMS 解密（只能在 Enclave 内成功，因为 Enclave 有解密权限）
 *       const kms = new KMSClient({});
 *       const decrypted = await kms.send(new DecryptCommand({
 *         CiphertextBlob: encrypted,
 *       }));
 *
 *       const keyData = JSON.parse(new TextDecoder().decode(decrypted.Plaintext));
 *       return {
 *         publicKey: Uint8Array.from(atob(keyData.pk), c => c.charCodeAt(0)),
 *         privateKey: Uint8Array.from(atob(keyData.sk), c => c.charCodeAt(0)),
 *       };
 *     } catch (e) {
 *       // 首次启动，密钥不存在，需要生成
 *     }
 *
 *     // 生成新密钥对
 *     const privateKey = randomBytes(32);
 *     const publicKey = x25519.getPublicKey(privateKey);
 *
 *     // 用 KMS 加密私钥后存储到 S3
 *     const kms = new KMSClient({});
 *     const plaintext = new TextEncoder().encode(JSON.stringify({
 *       pk: btoa(String.fromCharCode(...publicKey)),
 *       sk: btoa(String.fromCharCode(...privateKey)),
 *     }));
 *     const { CiphertextBlob } = await kms.send(new EncryptCommand({
 *       KeyId: KMS_KEY_ARN,
 *       Plaintext: plaintext,
 *     }));
 *     await s3.send(new PutObjectCommand({
 *       Bucket: S3_BUCKET,
 *       Key: 'enclave-keypair.enc',
 *       Body: CiphertextBlob,
 *     }));
 *
 *     return { publicKey, privateKey };
 *   }
 */
function loadOrGenerateKeyPair(): EnclaveKeyPair {
  // [Mock] 尝试从本地文件加载
  if (existsSync(KEYPAIR_PATH)) {
    try {
      const data = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8'));
      const publicKey = Uint8Array.from(atob(data.publicKey), (c) =>
        c.charCodeAt(0)
      );
      const privateKey = Uint8Array.from(atob(data.privateKey), (c) =>
        c.charCodeAt(0)
      );
      console.log(`[enclave] 已从 ${KEYPAIR_PATH} 加载密钥对`);
      return { publicKey, privateKey };
    } catch (e) {
      console.warn('[enclave] 密钥对加载失败，重新生成:', e);
    }
  }

  // [Mock] 本地生成密钥对
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);

  // [Mock] 持久化到本地文件
  const dir = dirname(KEYPAIR_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    KEYPAIR_PATH,
    JSON.stringify({
      publicKey: btoa(String.fromCharCode(...publicKey)),
      privateKey: btoa(String.fromCharCode(...privateKey)),
    }),
    'utf-8'
  );

  console.log(
    `[enclave] 已生成并保存密钥对，公钥: ${btoa(String.fromCharCode(...publicKey)).slice(0, 20)}...`
  );
  return { publicKey, privateKey };
}

// 模块级缓存（每个 API route 实例独立，但文件是共享的）
let cachedKeyPair: EnclaveKeyPair | null = null;

export function getEnclaveKeyPair(): EnclaveKeyPair {
  if (cachedKeyPair) return cachedKeyPair;
  cachedKeyPair = loadOrGenerateKeyPair();
  return cachedKeyPair;
}

/**
 * 生成 Nitro Enclave attestation 文档。
 *
 * [Mock 模式] — 当前实现：
 *   返回硬编码的模拟数据，前端只做展示。
 *
 * [真实环境] — 部署到 Nitro Enclave 时的实现方式：
 *
 *   Attestation 文档是 Nitro Enclave 的核心安全证明：
 *   1. 由 Nitro Secure Module (NSM) 生成，包含 Enclave 的度量值（PCR）
 *   2. 包含 Enclave 内部请求的公钥（证明该公钥确实在 Enclave 中生成）
 *   3. 由 AWS 证书链签名，客户端可独立验证
 *
 *   获取流程：
 *   1. Enclave 内部通过 vsock 连接 NSM 驱动 (/dev/nsm)
 *   2. 调用 ioctl 发送 attestation 请求，附带公钥作为 user_data
 *   3. NSM 返回签名的 attestation 文档（CBOR 编码）
 *
 *   代码示例：
 *
 *   // import { execSync } from 'child_process';
 *
 *   // 方式 1：通过 nsm-driver CLI 工具
 *   function generateAttestation(publicKeyBase64: string): AttestationDoc {
 *     // nsm-cli 是 AWS 提供的命令行工具，封装了 /dev/nsm 的 ioctl 调用
 *     // user_data 参数会嵌入 attestation 文档，用于绑定公钥
 *     const result = execSync(
 *       `nsm-cli attest --user-data "${publicKeyBase64}"`,
 *       { encoding: 'utf-8' }
 *     );
 *
 *     // 返回 CBOR 编码的 attestation 文档
 *     // 客户端需要用 AWS Nitro Enclave SDK 解析并验证
 *     return JSON.parse(result);
 *   }
 *
 *   // 方式 2：通过 Node.js addon 直接调用 /dev/nsm
 *   // const nsm = require('nsm-addon');
 *   // const attestation = nsm.attest(publicKeyBytes);
 *
 *   attestation 文档结构说明：
 *   {
 *     module_id: "i-0abc...-enc123...",  // Enclave 实例唯一标识
 *     timestamp: "2026-04-19T10:00:00Z",  // 签发时间
 *     digest: "SHA384",                   // PCR 哈希算法
 *     pcrs: {                             // 平台配置寄存器（Enclave 度量值）
 *       0: "sha384:...",                  // PCR0: Enclave 镜像哈希
 *       1: "...",                         // PCR1: 应用程序哈希
 *       2: "...",                         // PCR2: 签名者身份
 *     },
 *     public_key: "MEI...",               // 用户请求嵌入的公钥（DER 编码）
 *     certificate: "MIIC...",             // NSM 签名证书
 *     cabundle: ["MIID...", ...],         // 证书链（用于验证 certificate）
 *   }
 *
 *   客户端验证流程（浏览器侧）：
 *   1. 用 cabundle 构建证书链，验证 certificate 由 AWS 根 CA 签发
 *   2. 用 certificate 验证 attestation 文档签名
 *   3. 检查 PCR 值是否与预期一致（防止镜像篡改）
 *   4. 提取 public_key 用于后续 HPKE 密钥协商
 */
export function generateMockAttestation() {
  // [Mock] 返回模拟数据
  return {
    module_id: 'i-0abc123def456789-enc9876543210fedc',
    timestamp: new Date().toISOString(),
    pcrs: {
      '0':
        'sha384:ab3f7c2e1d4a5b6c8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f',
      '1':
        'sha384:cd7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
      '2':
        'sha384:ef1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    },
    certificate: 'MIICljCCAXwCCQCKu8c8vN...',
    cabundle: ['MIIDMjCCAhqgAwIBAgIJAL...'],
  };
}

/**
 * 判断当前服务是否运行在 Enclave 模式。
 *
 * [Mock]  通过环境变量 ENCLAVE_MODE 控制，默认 true
 * [真实]  可改为检测 /dev/nsm 是否存在，或检查 AWS_NSM_ENDPOINT 环境变量
 *
 * 切换方式：
 *   ENCLAVE_MODE=true  npm run dev  → Enclave 模式（加密通道）
 *   ENCLAVE_MODE=false npm run dev  → 普通 VM 模式（明文通道）
 *
 * 真实环境中，可改为自动检测：
 *
 *   function isEnclaveMode(): boolean {
 *     // 方式 1：检测 NSM 设备文件是否存在
 *     // return existsSync('/dev/nsm');
 *
 *     // 方式 2：检测 vsock 是否可用
 *     // try {
 *     //   execSync('nsm-cli describe', { timeout: 1000 });
 *     //   return true;
 *     // } catch {
 *     //   return false;
 *     // }
 *   }
 */
export function isEnclaveMode(): boolean {
  return process.env.ENCLAVE_MODE !== 'false';
}
