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
    // 有 publicKey 就能加密，mock 只影响 attestation 可信度
    const hasKey = !!data.publicKey;
    return NextResponse.json({
      trusted: hasKey && !data.mock,
      publicKey: hasKey ? data.publicKey : null,
      attestation: data.mock
        ? null
        : {
            module_id: 'nitro-enclave',
            timestamp: new Date().toISOString(),
            pcrs: data.pcrs,
            certificate: '',
            cabundle: [],
          },
    });
  } catch {
    return NextResponse.json({
      trusted: false,
      publicKey: null,
      attestation: null,
    });
  }
}
