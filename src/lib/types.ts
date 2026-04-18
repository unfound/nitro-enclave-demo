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

// === Chat API Types ===

export interface PlainChatRequest {
  encrypted?: false;
  messages: Array<{ role: string; content: string }>;
}

export interface EncryptedChatRequest {
  encrypted: true;
  enc: string; // base64 encapsulated key (ephemeral public key)
  ct: string;  // base64 [IV][ciphertext+tag]
}

export type ChatRequest = PlainChatRequest | EncryptedChatRequest;

export interface ChatErrorResponse {
  error: string;
  message: string;
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
