import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

// Mock 模式下的 golden baseline（与后端 mock PCR 值对应）
const MOCK_GOLDEN_PCR: Record<string, string> = {
  '1': 'sha256:mock_pcr1_value_for_demo',
  '4': 'sha256:mock_pcr4_value_for_demo',
};

// 从环境变量读取真实环境的 golden baseline
// 格式：1:sha256:abc...,4:sha256:def...
function parseGoldenBaseline(): Record<string, string> {
  const env = process.env.NEXT_PUBLIC_PCR_GOLDEN_BASELINE || '';
  if (!env) return {};
  const result: Record<string, string> = {};
  for (const pair of env.split(',')) {
    const [idx, val] = pair.trim().split(':');
    if (idx && val) result[idx] = val;
  }
  return result;
}

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/attestation`);
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { trusted: false, publicKey: null, attestation: null },
        { status: res.status }
      );
    }

    if (!data.publicKey) {
      return NextResponse.json({ trusted: false, publicKey: null, attestation: null });
    }

    // 根据 mock 字段选择对应的 golden baseline
    const golden = data.mock ? MOCK_GOLDEN_PCR : parseGoldenBaseline();

    // 若无 golden baseline（未配置），仅检查公钥存在
    if (Object.keys(golden).length === 0) {
      // mock 模式始终返回 attestation（含 PCR），真实模式无 baseline 则不返回
      return NextResponse.json({
        trusted: true,
        publicKey: data.publicKey,
        attestation: data.mock || !parseGoldenBaseline()
          ? {
              module_id: data.mock ? 'tpm-app-mock' : 'tpm-app',
              timestamp: new Date().toISOString(),
              pcrs: data.pcrs ?? {},
              certificate: '',
              cabundle: [],
            }
          : null,
      });
    }

    // PCR 校验
    let pcrMatch = true;
    if (data.pcrs) {
      for (const [idx, expected] of Object.entries(golden)) {
        const got = data.pcrs[idx];
        if (!got || got !== expected) {
          pcrMatch = false;
          break;
        }
      }
    } else {
      pcrMatch = false;
    }

    return NextResponse.json({
      trusted: pcrMatch,
      publicKey: pcrMatch ? data.publicKey : null,
      attestation: pcrMatch ? {
        module_id: data.mock ? 'tpm-app-mock' : 'tpm-app',
        timestamp: new Date().toISOString(),
        pcrs: data.pcrs,
        certificate: '',
        cabundle: [],
      } : null,
    });
  } catch {
    return NextResponse.json({
      trusted: false,
      publicKey: null,
      attestation: null,
    });
  }
}
