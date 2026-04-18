'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from 'ai/react';
import { sealAsync, decryptChunk, publicKeyFromBase64 } from '@/lib/crypto';
import type { AttestationResponse, ChatMessage, EncryptedChunk } from '@/lib/types';

interface Props {
  attestation: AttestationResponse | null;
}

type Mode = 'plain' | 'encrypted';

export default function ChatPanel({ attestation }: Props) {
  const [mode, setMode] = useState<Mode>('encrypted');
  const [encryptedMessages, setEncryptedMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Plain mode: useChat hook (SSE)
  const {
    messages: plainMessages,
    input: plainInput,
    handleInputChange: handlePlainInputChange,
    handleSubmit: handlePlainSubmit,
    isLoading: plainLoading,
    error: plainError,
  } = useChat({ api: '/api/chat' });

  const isEncrypted = mode === 'encrypted';
  const messages = isEncrypted ? encryptedMessages : plainMessages;
  const isLoading = isEncrypted ? isStreaming : plainLoading;
  const currentError = isEncrypted ? error : plainError?.message || null;

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---- Encrypted submit ----
  const handleEncryptedSubmit = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    if (!attestation?.trusted || !attestation.publicKey) {
      setError('Environment not trusted — encryption unavailable');
      return;
    }

    setError(null);
    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...encryptedMessages, userMessage];
    setEncryptedMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    try {
      // 1. HPKE seal
      const serverPk = publicKeyFromBase64(attestation.publicKey);
      const { enc, ct, responseKey: rk } = await sealAsync(newMessages, serverPk);

      // 2. POST encrypted request
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypted: true, enc, ct }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${response.status}`);
      }

      // 3. Read ndjson stream, decrypt each chunk
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';

      setEncryptedMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '' },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk: EncryptedChunk = JSON.parse(line);
            const decrypted = decryptChunk(chunk, rk);
            assistantContent += decrypted;

            setEncryptedMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: assistantContent,
                };
              }
              return updated;
            });
          } catch (e) {
            console.error('Chunk decrypt error:', e);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Encryption failed');
      setEncryptedMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, attestation, encryptedMessages]);

  // ---- Unified submit ----
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEncrypted) {
      handleEncryptedSubmit();
    } else {
      handlePlainInputChange({
        target: { value: input },
      } as React.ChangeEvent<HTMLInputElement>);
      setTimeout(() => handlePlainSubmit(e), 0);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!isEncrypted) {
      handlePlainInputChange(e);
    }
  };

  const currentInput = isEncrypted ? input : plainInput;

  return (
    <div className="chat-panel">
      {/* Mode toggle */}
      <div className="mode-toggle">
        <button
          className={`mode-btn ${mode === 'encrypted' ? 'active' : ''}`}
          onClick={() => setMode('encrypted')}
        >
          Encrypted (HPKE)
        </button>
        <button
          className={`mode-btn ${mode === 'plain' ? 'active' : ''}`}
          onClick={() => setMode('plain')}
        >
          Plain Text (HTTP)
        </button>
      </div>

      {/* Error */}
      {currentError && <div className="error-banner">{currentError}</div>}

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Start a consultation</p>
            <p className="empty-hint">
              {isEncrypted
                ? 'Your consultation is end-to-end encrypted via HPKE before leaving your browser.'
                : 'Plain text mode — data transmitted unencrypted.'}
            </p>
            <div className="suggestion-chips">
              <button
                onClick={() =>
                  setInput('I have a headache, fever at 38.5°C, and yellow phlegm for 3 days')
                }
                className="chip"
              >
                Fever consultation
              </button>
              <button
                onClick={() =>
                  setInput('I have severe insomnia, only sleeping 3-4 hours per night')
                }
                className="chip"
              >
                Insomnia consultation
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-header">
              <span className="message-role">
                {msg.role === 'user' ? 'You' : 'Assistant'}
              </span>
              {isEncrypted && (
                <span className="message-encrypt-badge">HPKE</span>
              )}
            </div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-header">
              <span className="message-role">Assistant</span>
              {isEncrypted && (
                <span className="message-encrypt-badge">HPKE</span>
              )}
            </div>
            <div className="message-content streaming-cursor">▊</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="chat-input">
        <input
          value={currentInput}
          onChange={onInputChange}
          placeholder={
            isEncrypted
              ? 'Describe your symptoms (encrypted)…'
              : 'Describe your symptoms (plain text)…'
          }
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !currentInput.trim()}
        >
          {isLoading ? 'Sending…' : isEncrypted ? 'Encrypt & Send' : 'Send'}
        </button>
      </form>
    </div>
  );
}
