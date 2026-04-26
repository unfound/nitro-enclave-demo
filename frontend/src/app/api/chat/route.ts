import { NextRequest, NextResponse } from 'next/server';
import type { ChatRequest } from '@/lib/types';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequest;

  if (!body.sessionId || !body.ct) {
    console.warn('[API /chat] ← 400 INVALID_REQUEST missing sessionId or ct');
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  console.log('[API /chat] → POST %s/chat sessionId=%.16s ct_len=%d',
    BACKEND, body.sessionId, body.ct.length);

  try {
    const res = await fetch(`${BACKEND}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: body.sessionId,
        ct: body.ct,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'UNKNOWN' }));
      console.error('[API /chat] ← %d %o', res.status, err);
      return NextResponse.json(err, { status: res.status });
    }

    // 流式返回加密 chunks
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop()!;
            for (const line of lines) {
              if (line.trim()) {
                chunkCount++;
                controller.enqueue(encoder.encode(line + '\n'));
              }
            }
          }
          console.log('[API /chat] ← 流结束 chunkCount=%d', chunkCount);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error('[API /chat] ← 网络错误: %o', err);
    return NextResponse.json({ error: 'NETWORK_ERROR' }, { status: 502 });
  }
}
