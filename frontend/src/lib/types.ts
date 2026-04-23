// === Attestation API Types ===

export interface AttestationDoc {
  module_id: string;
  timestamp: string;
  pcrs: Record<string, string>;
  certificate: string;
  cabundle: string[];
}

export interface AttestationResponse {
  trusted: boolean;
  publicKey: string | null;
  attestation: AttestationDoc | null;
}

// === Key Exchange ===

export interface KeyExchangeRequest {
  clientPublicKey: string; // base64 ephemeral X25519 public key
}

export interface KeyExchangeResponse {
  sessionId: string;      // hex
  enc: string;            // base64 ephemeral public key (same as sent)
  responseKey: string;    // hex 32-byte key for chat encryption/decryption
  serverPublicKey: string; // base64 server static public key
}

// === Chat API Types ===

export interface ChatRequest {
  sessionId: string; // hex from /key-exchange
  ct: string;        // base64 IV(12) || ciphertext
}

export interface ChatErrorResponse {
  error: string;
  message: string;
}

// === LLM SSE Stream Chunk（解密前的原始格式） ===

export interface LLMStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content: string | null };
    finish_reason: string | null;
  }>;
}

// === Encrypted Stream Chunk ===

export interface EncryptedChunk {
  iv: string; // base64
  ct: string; // base64
}

// === Message Types ===

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
