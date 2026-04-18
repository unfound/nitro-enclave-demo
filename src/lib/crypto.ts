/**
 * Minimal HPKE implementation using @noble/curves + @noble/ciphers.
 *
 * RFC 9180 simplified for demo:
 *   KEM: X25519 (ephemeral DH)
 *   KDF: HKDF-SHA256 (via Web Crypto API)
 *   AEAD: AES-256-GCM (via @noble/ciphers)
 *
 * Both client and server share this module.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import type { ChatMessage, EncryptedChunk } from './types';

// ===================== Key Management =====================

/**
 * Export public key as base64 string for transmission.
 */
export function publicKeyToBase64(pk: Uint8Array): string {
  return btoa(String.fromCharCode(...pk));
}

/**
 * Import public key from base64 string.
 */
export function publicKeyFromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ===================== HKDF Helpers =====================

async function hkdfDerive(
  ikm: Uint8Array,
  info: string,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ikm as BufferSource,
    'HKDF',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/**
 * Derive request + response AES-256 keys from HPKE shared secret.
 *
 * Context includes enc + sender_pk + recipient_pk to ensure
 * unique keys per session (RFC 9180 key schedule).
 */
async function deriveSessionKeys(
  sharedSecret: Uint8Array,
  context: string
): Promise<{ requestKey: Uint8Array; responseKey: Uint8Array }> {
  const keyMaterial = await hkdfDerive(
    sharedSecret,
    `hpke-context:${context}`,
    64
  );
  return {
    requestKey: keyMaterial.slice(0, 32),
    responseKey: keyMaterial.slice(32, 64),
  };
}

// ===================== Client-side: Seal =====================

// sealAsync: client encrypts messages for the enclave server
export async function sealAsync(
  messages: ChatMessage[],
  serverPublicKey: Uint8Array
): Promise<{ enc: string; ct: string; responseKey: Uint8Array }> {
  // 1. Ephemeral keypair
  const ephemeralSk = randomBytes(32);
  const ephemeralPk = x25519.getPublicKey(ephemeralSk);

  // 2. DH
  const sharedSecret = x25519.getSharedSecret(ephemeralSk, serverPublicKey);

  // 3. Derive keys — context binds enc + both public keys
  const context = [
    btoa(String.fromCharCode(...ephemeralPk)),
    btoa(String.fromCharCode(...serverPublicKey)),
  ].join(':');

  const { requestKey, responseKey } = await deriveSessionKeys(sharedSecret, context);

  // 4. Encrypt
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(messages));
  const ciphertext = gcm(requestKey, iv).encrypt(plaintext);

  // Pack: [IV (12 bytes)][ciphertext+tag]
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);

  return {
    enc: btoa(String.fromCharCode(...ephemeralPk)),
    ct: btoa(String.fromCharCode(...packed)),
    responseKey,
  };
}

// ===================== Server-side: Open =====================

/**
 * HPKE Open — server decrypts the client's sealed request.
 *
 * @param enc base64 ephemeral public key
 * @param ct base64 [IV][ciphertext+tag]
 * @param serverPrivateKey server's X25519 private key (raw 32 bytes)
 * @returns decrypted messages + response encryption key
 */
export async function openAsync(
  enc: string,
  ct: string,
  serverPrivateKey: Uint8Array
): Promise<{ messages: ChatMessage[]; responseKey: Uint8Array }> {
  // 1. Decode
  const ephemeralPk = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
  const packed = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));

  // 2. DH
  const sharedSecret = x25519.getSharedSecret(serverPrivateKey, ephemeralPk);

  // 3. Derive keys
  const serverPk = x25519.getPublicKey(serverPrivateKey);
  const context = [
    btoa(String.fromCharCode(...ephemeralPk)),
    btoa(String.fromCharCode(...serverPk)),
  ].join(':');

  const { requestKey, responseKey } = await deriveSessionKeys(
    sharedSecret,
    context
  );

  // 4. Decrypt
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);

  try {
    const plaintext = gcm(requestKey, iv).decrypt(ciphertext);

    const messages: ChatMessage[] = JSON.parse(
      new TextDecoder().decode(plaintext)
    );

    return { messages, responseKey };
  } catch (e) {
    console.error('[openAsync] decrypt FAILED:', e);
    throw e;
  }
}

// ===================== Encrypt/Decrypt Chunks =====================

/**
 * Encrypt a single text chunk (server → client).
 */
export function encryptChunk(
  text: string,
  responseKey: Uint8Array
): EncryptedChunk {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(text);
  const ciphertext = gcm(responseKey, iv).encrypt(plaintext);

  return {
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...ciphertext)),
  };
}

/**
 * Decrypt a single encrypted chunk (client reads from stream).
 */
export function decryptChunk(
  chunk: EncryptedChunk,
  responseKey: Uint8Array
): string {
  const iv = Uint8Array.from(atob(chunk.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(chunk.ct), (c) => c.charCodeAt(0));
  const plaintext = gcm(responseKey, iv).decrypt(ciphertext);
  return new TextDecoder().decode(plaintext);
}
