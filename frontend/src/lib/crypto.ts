import { x25519 } from '@noble/curves/ed25519.js';
import { gcm } from '@noble/ciphers/webcrypto.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import type { KeyExchangeResponse } from './types';

// ============================================================
// Base64 工具（浏览器内置 btoa/atob）
// ============================================================

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function publicKeyToBase64(publicKey: Uint8Array): string {
  return bytesToBase64(publicKey);
}

// ============================================================
// 密钥交换（前端调用 /key-exchange，后端返回 responseKey）
// ============================================================

/**
 * 生成临时 X25519 密钥对（用于 key-exchange）。
 */
export function generateClientKeyPair(): { clientSK: Uint8Array; clientPK: Uint8Array } {
  const clientSK = randomBytes(32);
  const clientPK = x25519.scalarMultBase(clientSK);
  return { clientSK, clientPK };
}

// ============================================================
// AES-GCM-256 加解密（与后端 hpke.EncryptChunk/Open 完全一致）
// ============================================================

/**
 * 用 responseKey 加密消息（与后端 hpke.EncryptChunk 对称）。
 * responseKey: 32-byte key
 * plaintext: raw string
 * 返回: { iv, ct } (both base64 strings)
 */
export async function encryptWithResponseKey(
  responseKey: Uint8Array,
  plaintext: string
): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12);
  const cipher = gcm(responseKey, iv);
  const ciphertext = await cipher.encrypt(new TextEncoder().encode(plaintext));
  return {
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ciphertext),
  };
}

/**
 * 用 responseKey 解密单个块（与后端 hpke.Open 对称）。
 */
export async function decryptWithResponseKey(
  responseKey: Uint8Array,
  iv: string,
  ct: string
): Promise<string> {
  const cipher = gcm(responseKey, base64ToBytes(iv));
  const plaintext = await cipher.decrypt(base64ToBytes(ct));
  return new TextDecoder().decode(plaintext);
}

// ============================================================
// 辅助
// ============================================================

/**
 * 将 hex string 转成 Uint8Array。
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 合并 IV 和 ciphertext 为后端格式。
 * 后端 ChatRequest.Ct = base64(IV || ciphertext)
 */
export function combineIVAndCiphertext(iv: string, ct: string): string {
  const ivBytes = base64ToBytes(iv);
  const ctBytes = base64ToBytes(ct);
  const combined = new Uint8Array(ivBytes.length + ctBytes.length);
  combined.set(ivBytes, 0);
  combined.set(ctBytes, ivBytes.length);
  return bytesToBase64(combined);
}

/**
 * 验证 /key-exchange 响应。
 */
export function parseKeyExchange(response: KeyExchangeResponse): {
  sessionId: Uint8Array;
  responseKey: Uint8Array;
} {
  const sessionId = hexToBytes(response.sessionId);
  const responseKey = hexToBytes(response.responseKey);
  if (responseKey.length !== 32) {
    throw new Error(`Invalid responseKey length: ${responseKey.length}`);
  }
  return { sessionId, responseKey };
}
