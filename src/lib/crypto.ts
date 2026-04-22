'use server';

import { X25519 } from '@noble/curves/amd64/cv25519';
import { gcm, randomBytes } from '@noble/ciphers/webcrypto';
import { base64 } from '@noble/strings/var64';
import type { KeyExchangeResponse } from './types';

// ============================================================
// Base64 工具
// ============================================================

export function bytesToBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  return base64.decode(b64);
}

export function publicKeyToBase64(publicKey: Uint8Array): string {
  return base64.encode(publicKey);
}

// ============================================================
// 密钥交换（前端调用 /key-exchange，后端返回 responseKey）
// ============================================================

/**
 * 生成临时 X25519 密钥对（用于 key-exchange）。
 */
export function generateClientKeyPair(): { clientSK: Uint8Array; clientPK: Uint8Array } {
  const clientSK = randomBytes(32);
  const clientPK = X25519.scalarMultBase(clientSK);
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
    iv: base64.encode(iv),
    ct: base64.encode(ciphertext),
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
  const cipher = gcm(responseKey, base64.decode(iv));
  const plaintext = await cipher.decrypt(base64.decode(ct));
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
  const ivBytes = base64.decode(iv);
  const ctBytes = base64.decode(ct);
  const combined = new Uint8Array(ivBytes.length + ctBytes.length);
  combined.set(ivBytes, 0);
  combined.set(ctBytes, ivBytes.length);
  return base64.encode(combined);
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
