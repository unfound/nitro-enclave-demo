import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

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

    // backend 返回 { pcrs, publicKey, mock }
    // 有 publicKey 就能加密通信
    // mock=true 只表示无法获取真实 PCR（本地/测试环境），此时 attestation 详情不展示
    const hasKey = !!data.publicKey;
    return NextResponse.json({
      trusted: hasKey,
      publicKey: hasKey ? data.publicKey : null,
      attestation: !data.mock ? {
            module_id: 'nitro-enclave',
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
