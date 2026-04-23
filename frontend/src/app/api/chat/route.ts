import { NextRequest, NextResponse } from 'next/server';
import type { ChatRequest } from '@/lib/types';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequest;

  if (!body.sessionId || !body.ct) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

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
    return NextResponse.json(err, { status: res.status });
  }

  // 流式返回加密 chunks
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
        }
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
}
