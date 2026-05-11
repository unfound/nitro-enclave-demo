'use client';

import { useLang } from './LanguageProvider';
import type { AttestationResponse } from '@/lib/types';

interface Props {
  attestation: AttestationResponse | null;
  loading?: boolean;
  error?: boolean;
}

/**
 * 解析前端环境变量中的黄金基准线
 * 格式: "1:sha256:xxx;4:sha256:yyy" → { "1": "sha256:xxx", "4": "sha256:yyy" }
 */
function parseGoldenBaseline(): Record<string, string> {
  const raw = process.env.NEXT_PUBLIC_PCR_GOLDEN_BASELINE;
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf(':');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key && val) result[key] = val;
    }
  }
  return result;
}

/**
 * 前端独立校验 PCR 值与黄金基准线的匹配状态
 * 返回: { "1": "match", "4": "mismatch", ... }
 */
function validatePcrs(
  pcrs: Record<string, string>,
  baseline: Record<string, string>,
): Record<string, string> {
  const status: Record<string, string> = {};
  for (const [idx, expected] of Object.entries(baseline)) {
    const actual = pcrs[idx];
    if (actual === undefined) {
      status[idx] = 'missing';
    } else if (actual === expected) {
      status[idx] = 'match';
    } else {
      status[idx] = 'mismatch';
    }
  }
  return status;
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

  // 前端独立校验黄金基准线
  const goldenBaseline = parseGoldenBaseline();
  const hasBaseline = Object.keys(goldenBaseline).length > 0;
  const clientStatus = hasBaseline ? validatePcrs(attestation.pcrs ?? {}, goldenBaseline) : {};

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
              {Object.entries(attestation.pcrs ?? {}).map(([idx, val]) => {
                // 优先用前端独立校验结果，fallback 到后端返回的 pcrStatus
                const status = clientStatus[idx] ?? attestation.pcrStatus?.[idx];
                return (
                  <div key={idx} className="pcr-row">
                    <span className="pcr-index">PCR{idx}</span>
                    <code className="pcr-hash">{val}</code>
                    {status && (
                      <span className={`pcr-status pcr-status--${status}`}>
                        {status === 'match' ? '✅ 匹配' : status === 'mismatch' ? '❌ 不匹配' : '⚠️ 缺失'}
                      </span>
                    )}
                  </div>
                );
              })}
              {hasBaseline && (
                <div className="pcr-baseline-hint">
                  前端校验 · 基准线 {Object.keys(goldenBaseline).length} 条
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
