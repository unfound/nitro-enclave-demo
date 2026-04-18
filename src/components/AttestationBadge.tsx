'use client';

import { useEffect, useState } from 'react';
import type { AttestationResponse } from '@/lib/types';

export default function AttestationBadge() {
  const [data, setData] = useState<AttestationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/attestation')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="badge badge-error">
        <span className="badge-icon">✕</span>
        <div className="badge-info">
          <span className="badge-title">Connection failed</span>
          <span className="badge-detail">{error}</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="badge badge-loading">
        <span className="badge-icon">◌</span>
        <div className="badge-info">
          <span className="badge-title">Verifying environment…</span>
          <span className="badge-detail">Checking Nitro Enclave attestation</span>
        </div>
      </div>
    );
  }

  const isTrusted = data.trusted;

  return (
    <div className={`badge ${isTrusted ? 'badge-trusted' : 'badge-untrusted'}`}>
      <span className="badge-icon">
        {isTrusted ? '✓' : '✕'}
      </span>
      <div className="badge-info">
        <span className="badge-title">
          {isTrusted
            ? 'Trusted Environment — Nitro Enclave'
            : 'Untrusted — Standard VM'}
        </span>
        <span className="badge-detail">
          {isTrusted
            ? 'HPKE decryption enabled. Your data is processed in an isolated enclave.'
            : 'Decryption blocked. Sensitive data cannot be processed.'}
        </span>

        {isTrusted && data.publicKey && (
          <span className="badge-detail">
            Public key: <code>{data.publicKey.slice(0, 16)}…</code>
          </span>
        )}

        {data.attestation && (
          <details className="badge-details">
            <summary>Attestation details</summary>
            <pre>{JSON.stringify(data.attestation, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
