'use client';

import { useLang } from './LanguageProvider';
import type { AttestationResponse } from '@/lib/types';

interface Props {
  attestation: AttestationResponse | null;
  loading?: boolean;
  error?: boolean;
}

export default function AttestationBadge({ attestation, loading = false, error = false }: Props) {
  const { t } = useLang();

  if (loading || attestation === null) {
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

  const isTrusted = attestation.trusted;
  const publicKeyShort = attestation.publicKey
    ? `${attestation.publicKey.slice(0, 12)}...${attestation.publicKey.slice(-8)}`
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
          <details className="pcr-details">
            <summary className="pcr-summary">
              <span className="pcr-summary-icon">🔐</span>
              <span className="pcr-summary-text">查看技术详情</span>
              <span className="pcr-chevron">›</span>
            </summary>
            <div className="pcr-body">
              <div className="pcr-row pcr-row--key">
                <span className="pcr-index">Key</span>
                <code className="pcr-hash">{attestation.publicKey}</code>
              </div>
              {Object.entries(attestation.attestation?.pcrs ?? {}).map(([idx, val]) => (
                <div key={idx} className="pcr-row">
                  <span className="pcr-index">PCR{idx}</span>
                  <code className="pcr-hash">{val}</code>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
