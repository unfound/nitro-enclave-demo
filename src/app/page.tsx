'use client';

import { useState, useEffect } from 'react';
import AttestationBadge from '@/components/AttestationBadge';
import ChatPanel from '@/components/ChatPanel';
import type { AttestationResponse } from '@/lib/types';

export default function Home() {
  const [attestation, setAttestation] = useState<AttestationResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/attestation')
      .then((res) => res.json())
      .then((data: AttestationResponse) => {
        setAttestation(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>🏥 机密医疗助手</h1>
        <p className="subtitle">
          基于 AWS Nitro Enclave 机密计算 · HPKE 端到端加密
        </p>
      </header>

      <section className="attestation-section">
        <AttestationBadge attestation={attestation} loading={loading} />
      </section>

      <section className="chat-section">
        <ChatPanel attestation={attestation} />
      </section>

      <footer className="app-footer">
        <p>
          ⚠️ 本应用为技术 Demo，不构成医疗建议。
          真实场景中，敏感数据仅在可信执行环境(Nitro Enclave)中解密处理。
        </p>
      </footer>
    </main>
  );
}
