import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log('[API /key-exchange] → POST %s/key-exchange clientPublicKey=%.20s',
    BACKEND, body.clientPublicKey || '');

  try {
    const res = await fetch(`${BACKEND}/key-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[API /key-exchange] ← %d %o', res.status, data);
      return NextResponse.json(data, { status: res.status });
    }

    console.log('[API /key-exchange] ← sessionId=%.16s responseKey=%.10s... serverPublicKey=%.20s',
      data.sessionId || '', data.responseKey || '', data.serverPublicKey || '');
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[API /key-exchange] ← 网络错误: %o', err);
    return NextResponse.json({ error: 'NETWORK_ERROR' }, { status: 502 });
  }
}
