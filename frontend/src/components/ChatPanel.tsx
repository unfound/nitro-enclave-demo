'use client';

import { useState, useRef, useEffect } from 'react';
import { useLang } from './LanguageProvider';
import { Shield, User, Bot, AlertTriangle } from 'lucide-react';
import type {
  AttestationResponse,
  ChatMessage,
  EncryptedChunk,
  KeyExchangeResponse,
  ChatRequest,
} from '@/lib/types';
import {
  generateClientKeyPair,
  encryptWithResponseKey,
  decryptWithResponseKey,
  hexToBytes,
  combineIVAndCiphertext,
} from '@/lib/crypto';

interface Props {
  attestation: AttestationResponse | null;
  attestationError?: boolean;
}

interface EncryptedSession {
  sessionId: string;    // hex
  responseKey: Uint8Array;
}

export default function ChatPanel({ attestation, attestationError = false }: Props) {
  const { t } = useLang();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<EncryptedSession | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const attestationFailed = (attestation !== null && !attestation.trusted) || attestationError;
  const attestationLoading = attestation === null;

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Key Exchange ────────────────────────────────────────────
  async function ensureSession(): Promise<EncryptedSession> {
    if (session) return session;

    const { clientSK, clientPK } = generateClientKeyPair();
    const clientPkBase64 = btoa(String.fromCharCode(...clientPK));

    const keRes = await fetch('/api/key-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientPublicKey: clientPkBase64 }),
    });

    if (!keRes.ok) {
      throw new Error('Key exchange failed');
    }

    const ke: KeyExchangeResponse = await keRes.json();
    const newSession: EncryptedSession = {
      sessionId: ke.sessionId,
      responseKey: hexToBytes(ke.responseKey),
    };
    setSession(newSession);
    return newSession;
  }

  async function handleSend(text: string) {
    if (!text.trim() || streaming) return;
    if (attestationFailed || attestationLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setError(null);
    setStreaming(true);

    // Placeholder for assistant response
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await sendEncrypted(userMsg);
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'ENCLAVE_DECRYPT_FAILED'
          ? t.chat.errorEnclave
          : t.chat.errorGeneric;
      setError(msg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  async function sendEncrypted(userMsg: ChatMessage) {
    const allMessages = [...messages.filter((m) => m.content), userMsg];

    // Key exchange (cached after first call)
    const sess = await ensureSession();

    // Encrypt all messages as a single JSON string
    const plaintext = JSON.stringify(allMessages);
    const { iv, ct } = await encryptWithResponseKey(sess.responseKey, plaintext);

    // Combine IV + ciphertext into single ct (backend expects base64(IV || ciphertext))
    const combinedCt = combineIVAndCiphertext(iv, ct);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted: true, sessionId: sess.sessionId, ct: combinedCt }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      if (err?.error === 'SERVICE_NOT_IN_ENCLAVE') {
        throw new Error('ENCLAVE_DECRYPT_FAILED');
      }
      throw new Error('Request failed');
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk: EncryptedChunk = JSON.parse(line);
          const text = await decryptWithResponseKey(sess.responseKey, chunk.iv, chunk.ct);
          accumulated += text;
          updateLastMessage(accumulated);
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  function updateLastMessage(content: string) {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content,
        };
      }
      return updated;
    });
  }

  function handleSuggestion(text: string) {
    setInput(text);
    handleSend(text);
  }

  const showEmpty = messages.length === 0;

  return (
    <div className="chat-panel">
      {/* TPM 验证失败提示 */}
      {attestationFailed && (
        <div className="error-banner attestation-failed">
          <AlertTriangle size={14} />
          <span>{t.chat.attestationFailed}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && <div className="error-banner">{error}</div>}

      {/* Messages */}
      <div className="messages">
        {showEmpty && !attestationFailed ? (
          <div className="empty-state">
            <p>{t.chat.emptyTitle}</p>
            <p className="empty-hint">{t.chat.emptyHint}</p>
            <div className="suggestion-chips">
              {t.chat.suggestions.map((s, i) => (
                <button
                  key={i}
                  className="chip"
                  onClick={() => handleSuggestion(s)}
                  disabled={attestationFailed || attestationLoading}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`message-row ${msg.role}`}>
                <div className={`avatar ${msg.role === 'user' ? 'avatar-user' : 'avatar-assistant'}`}>
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className="message-group">
                  <div className={`message message-${msg.role}`}>
                    <div className="message-content">
                      {msg.content || (streaming && i === messages.length - 1 ? (
                        <span className="streaming-cursor">▊</span>
                      ) : null)}
                    </div>
                  </div>
                  <div className="message-meta">
                    <span className="message-encrypt-badge">
                      <Shield size={10} />
                      {t.chat.encrypted}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEnd} />
          </>
        )}
      </div>

      {/* Input */}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={attestationFailed ? t.chat.attestationFailed : t.chat.placeholder}
          disabled={streaming || attestationFailed || attestationLoading}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim() || attestationFailed || attestationLoading}
        >
          {t.chat.send}
        </button>
      </form>
    </div>
  );
}
