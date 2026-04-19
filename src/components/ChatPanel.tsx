'use client';

import { useState, useRef, useEffect } from 'react';
import { useLang } from './LanguageProvider';
import { Shield, User, Bot } from 'lucide-react';
import type { AttestationResponse, ChatMessage, EncryptedChunk } from '@/lib/types';
import { sealAsync, decryptChunk, publicKeyFromBase64 } from '@/lib/crypto';

interface Props {
  attestation: AttestationResponse | null;
}

type Mode = 'encrypted' | 'plain';

export default function ChatPanel({ attestation }: Props) {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>('encrypted');
  const [encryptedMessages, setEncryptedMessages] = useState<ChatMessage[]>([]);
  const [plainMessages, setPlainMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const canEncrypt = attestation?.trusted && attestation?.publicKey;
  const messages = mode === 'encrypted' ? encryptedMessages : plainMessages;
  const setMessages = mode === 'encrypted' ? setEncryptedMessages : setPlainMessages;

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(text: string) {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setError(null);
    setStreaming(true);

    // Placeholder for assistant response
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      if (mode === 'encrypted' && attestation?.publicKey) {
        await sendEncrypted(userMsg);
      } else {
        await sendPlain(userMsg);
      }
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'ENCLAVE_DECRYPT_FAILED'
          ? t.chat.errorEnclave
          : t.chat.errorGeneric;
      setError(msg);
      // Remove empty assistant message
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  async function sendPlain(userMsg: ChatMessage) {
    const allMessages = [...messages.filter((m) => m.content), userMsg];
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: allMessages }),
    });

    if (!res.ok) throw new Error('Request failed');

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
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) {
            accumulated += text;
            updateLastMessage(accumulated);
          }
        } catch {
          // skip non-JSON lines
        }
      }
    }
  }

  async function sendEncrypted(userMsg: ChatMessage) {
    const allMessages = [...messages.filter((m) => m.content), userMsg];
    const serverPk = publicKeyFromBase64(attestation!.publicKey!);
    const { enc, ct, responseKey } = await sealAsync(allMessages, serverPk);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted: true, enc, ct }),
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
          const text = decryptChunk(chunk, responseKey);
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
      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={`mode-btn ${mode === 'encrypted' ? 'active' : ''}`}
          onClick={() => setMode('encrypted')}
        >
          <Shield size={14} />
          {t.chat.encryptedMode}
        </button>
        <button
          className={`mode-btn ${mode === 'plain' ? 'active' : ''}`}
          onClick={() => setMode('plain')}
        >
          📄 {t.chat.plainMode}
        </button>
      </div>

      {/* Error Banner */}
      {error && <div className="error-banner">{error}</div>}

      {/* Messages */}
      <div className="messages">
        {showEmpty ? (
          <div className="empty-state">
            <p>{t.chat.emptyTitle}</p>
            <p className="empty-hint">{t.chat.emptyHint}</p>
            <div className="suggestion-chips">
              {t.chat.suggestions.map((s, i) => (
                <button
                  key={i}
                  className="chip"
                  onClick={() => handleSuggestion(s)}
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
                  {/* Encrypt badge below bubble */}
                  {mode === 'encrypted' && (
                    <div className="message-meta">
                      <span className="message-encrypt-badge">
                        <Shield size={10} />
                        {t.chat.encrypted}
                      </span>
                    </div>
                  )}
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
          placeholder={t.chat.placeholder}
          disabled={streaming}
        />
        <button type="submit" disabled={streaming || !input.trim()}>
          {t.chat.send}
        </button>
      </form>
    </div>
  );
}
