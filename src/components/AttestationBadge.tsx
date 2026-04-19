'use client';

import { useState, useEffect } from 'react';
import { useLang } from './LanguageProvider';
import type { AttestationResponse } from '@/lib/types';

export default function AttestationBadge() {
  const { t } = useLang();
  const [data, setData] = useState<AttestationResponse | null>(null);
  const [error, setError] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetch('/api/attestation')
      .then((res) => res.json())
      .then((d: AttestationResponse) => setData(d))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="badge badge-error">
        <span className="badge-icon">⚠️</span>
        <div className="badge-info">
          <span className="badge-title">{t.badge.error}</span>
          <span className="badge-detail">{t.badge.errorDesc}</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="badge badge-loading">
        <span className="badge-icon">⏳</span>
        <div className="badge-info">
          <span className="badge-title">{t.badge.loading}</span>
          <span className="badge-detail">{t.badge.loadingDesc}</span>
        </div>
      </div>
    );
  }

  const isTrusted = data.trusted;
  const publicKeyShort = data.publicKey
    ? `${data.publicKey.slice(0, 12)}...${data.publicKey.slice(-8)}`
    : null;

  return (
    <div className={`badge ${isTrusted ? 'badge-trusted' : 'badge-untrusted'}`}>
      <span className="badge-icon">{isTrusted ? '✅' : '❌'}</span>
      <div className="badge-info">
        <span className="badge-title">
          {isTrusted ? t.badge.trusted : t.badge.untrusted}
        </span>
        <span className="badge-detail">
          {isTrusted ? t.badge.trustedDesc : t.badge.untrustedDesc}
        </span>
        {isTrusted && publicKeyShort && (
          <div className="badge-details">
            <summary onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? t.badge.hideDetails : t.badge.showDetails}
            </summary>
            {showDetails && data.attestation && (
              <pre>
                {t.badge.publicKey}: <code>{publicKeyShort}</code>
                {'\n'}PCR0: {data.attestation.pcrs['0']?.slice(0, 24)}...
                {'\n'}Module: {data.attestation.module_id}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
