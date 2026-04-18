'use client';

import { useState, useEffect } from 'react';
import AttestationBadge from '@/components/AttestationBadge';
import ChatPanel from '@/components/ChatPanel';
import type { AttestationResponse } from '@/lib/types';

export default function Home() {
  const [attestation, setAttestation] = useState<AttestationResponse | null>(
    null
  );

  useEffect(() => {
    fetch('/api/attestation')
      .then((res) => res.json())
      .then((data: AttestationResponse) => setAttestation(data))
      .catch(() => {});
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>Confidential Medical Assistant</h1>
        <p className="subtitle">
          AWS Nitro Enclave · HPKE End-to-End Encryption
        </p>
      </header>

      <section className="attestation-section">
        <AttestationBadge />
      </section>

      <section className="chat-section">
        <ChatPanel attestation={attestation} />
      </section>

      <footer className="app-footer">
        <p>
          Technical demo — not medical advice.
          In production, sensitive data is only decrypted inside Nitro Enclave.
        </p>
      </footer>
    </main>
  );
}
