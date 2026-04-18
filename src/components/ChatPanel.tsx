'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from 'ai/react';
import { sealAsync, decryptChunkFn, publicKeyFromBase64 } from '@/lib/crypto';
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
  const [responseKey, setResponseKey] = useState<Uint8Array | null>(null);
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
      setError('服务未在可信环境运行，无法加密发送');
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
      setResponseKey(rk);

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
            const decrypted = decryptChunkFn(chunk, rk);
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
      setError(e instanceof Error ? e.message : '加密通信失败');
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
      // Small delay to let useChat pick up the input
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
          🔒 机密模式 (HPKE)
        </button>
        <button
          className={`mode-btn ${mode === 'plain' ? 'active' : ''}`}
          onClick={() => setMode('plain')}
        >
          📄 明文模式 (HTTP)
        </button>
      </div>

      {/* Error */}
      {currentError && <div className="error-banner">⚠️ {currentError}</div>}

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>🏥 机密医疗助手</p>
            <p className="empty-hint">
              {isEncrypted
                ? '您的健康咨询将通过 HPKE 端到端加密传输'
                : '明文模式 — 数据未加密，请勿输入真实敏感信息'}
            </p>
            <div className="suggestion-chips">
              <button
                onClick={() =>
                  setInput('我最近头疼、发烧38.5°、咳嗽有黄痰，持续3天了')
                }
                className="chip"
              >
                💊 头疼发烧咨询
              </button>
              <button
                onClick={() =>
                  setInput('我最近失眠很严重，每天只能睡3-4个小时')
                }
                className="chip"
              >
                😴 失眠咨询
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-header">
              <span className="message-role">
                {msg.role === 'user' ? '👤 您' : '🤖 医疗助手'}
              </span>
              {isEncrypted && (
                <span className="message-encrypt-badge">🔒 HPKE加密</span>
              )}
            </div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-header">
              <span className="message-role">🤖 医疗助手</span>
              {isEncrypted && (
                <span className="message-encrypt-badge">🔒 HPKE加密</span>
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
              ? '🔒 输入健康问题 (将被加密传输)...'
              : '📄 输入健康问题 (明文传输)...'
          }
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !currentInput.trim()}
        >
          {isLoading
            ? '发送中...'
            : isEncrypted
              ? '🔒 加密发送'
              : '发送'}
        </button>
      </form>
    </div>
  );
}
