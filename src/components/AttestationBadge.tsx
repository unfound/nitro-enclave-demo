'use client';

import type { AttestationResponse } from '@/lib/types';

interface Props {
  attestation: AttestationResponse | null;
  loading: boolean;
}

export default function AttestationBadge({ attestation, loading }: Props) {
  if (loading) {
    return (
      <div className="badge badge-loading">
        <span className="badge-icon">⏳</span>
        <span>正在验证可信环境...</span>
      </div>
    );
  }

  if (!attestation) {
    return (
      <div className="badge badge-error">
        <span className="badge-icon">⚠️</span>
        <span>无法连接认证服务</span>
      </div>
    );
  }

  if (attestation.trusted) {
    const hash = attestation.publicKey
      ? attestation.publicKey.slice(0, 16) + '...'
      : 'N/A';
    return (
      <div className="badge badge-trusted">
        <span className="badge-icon">✅</span>
        <div className="badge-info">
          <span className="badge-title">可信环境已认证 (Nitro Enclave)</span>
          <span className="badge-detail">
            公钥指纹: <code>{hash}</code>
          </span>
          {attestation.attestation && (
            <details className="badge-details">
              <summary>Attestation 详情</summary>
              <pre>{JSON.stringify(attestation.attestation, null, 2)}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="badge badge-untrusted">
      <span className="badge-icon">❌</span>
      <div className="badge-info">
        <span className="badge-title">未在可信环境运行 (普通 VM)</span>
        <span className="badge-detail">
          无法提供机密计算保障，加密数据将无法解密
        </span>
      </div>
    </div>
  );
}
