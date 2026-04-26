import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET() {
  console.log('[API /attestation] → GET %s/attestation', BACKEND);

  try {
    const res = await fetch(`${BACKEND}/attestation`);
    const data = await res.json();

    if (!res.ok) {
      console.error('[API /attestation] ← %d %o', res.status, data);
      return NextResponse.json(
        { trusted: false, publicKey: null, attestation: null },
        { status: res.status }
      );
    }

    console.log('[API /attestation] ← trusted=%v mock=%v publicKey=%.20s',
      data.trusted, data.mock, data.publicKey);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[API /attestation] ← 网络错误: %o', err);
    return NextResponse.json({
      trusted: false,
      publicKey: null,
      attestation: null,
    });
  }
}
