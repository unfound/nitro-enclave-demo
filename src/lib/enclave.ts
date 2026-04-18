/**
 * Enclave key management.
 * Stores keypair on disk so it persists across Next.js module instances.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface EnclaveKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

// Store keypair in a temp file that persists across module re-evaluations
const KEYPAIR_PATH = join(process.cwd(), '.enclave-keypair.json');

function loadOrGenerateKeyPair(): EnclaveKeyPair {
  // Try loading from disk first
  if (existsSync(KEYPAIR_PATH)) {
    try {
      const data = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8'));
      const publicKey = Uint8Array.from(atob(data.publicKey), (c) => c.charCodeAt(0));
      const privateKey = Uint8Array.from(atob(data.privateKey), (c) => c.charCodeAt(0));
      console.log(`[enclave] Loaded keypair from ${KEYPAIR_PATH}`);
      return { publicKey, privateKey };
    } catch (e) {
      console.warn('[enclave] Failed to load keypair, regenerating:', e);
    }
  }

  // Generate new keypair
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);

  // Persist to disk
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
    `[enclave] Generated and saved keypair, pk: ${btoa(String.fromCharCode(...publicKey)).slice(0, 20)}...`
  );
  return { publicKey, privateKey };
}

// Module-level cache (per-route instance, but disk is the source of truth)
let cachedKeyPair: EnclaveKeyPair | null = null;

export function getEnclaveKeyPair(): EnclaveKeyPair {
  if (cachedKeyPair) return cachedKeyPair;
  cachedKeyPair = loadOrGenerateKeyPair();
  return cachedKeyPair;
}

/**
 * Generate a mock Nitro Enclave attestation document.
 */
export function generateMockAttestation() {
  return {
    module_id: 'i-0abc123def456789-enc9876543210fedc',
    timestamp: new Date().toISOString(),
    pcrs: {
      '0': 'sha384:ab3f7c2e1d4a5b6c8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f',
      '1': 'sha384:cd7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
      '2': 'sha384:ef1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    },
    certificate: 'MIICljCCAXwCCQCKu8c8vN...',
    cabundle: ['MIIDMjCCAhqgAwIBAgIJAL...'],
  };
}

export function isEnclaveMode(): boolean {
  return process.env.ENCLAVE_MODE !== 'false';
}
