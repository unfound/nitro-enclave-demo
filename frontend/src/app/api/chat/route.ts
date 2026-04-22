import { NextRequest, NextResponse } from 'next/server';
import type { PlainChatRequest, EncryptedChatRequest } from '@/lib/types';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PlainChatRequest | EncryptedChatRequest;

  if ('encrypted' in body && body.encrypted) {
    // Encrypted mode: forward encrypted request to backend
    const encReq = body as EncryptedChatRequest;
    const res = await fetch(`${BACKEND}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: encReq.sessionId,
        ct: encReq.ct,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'UNKNOWN' }));
      return NextResponse.json(err, { status: res.status });
    }

    // Stream back encrypted chunks
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

  // Plain mode
  const plainReq = body as PlainChatRequest;
  const res = await fetch(`${BACKEND}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: plainReq.messages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'UNKNOWN' }));
    return NextResponse.json(err, { status: res.status });
  }

  // Stream SSE from backend
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
            if (line.startsWith('data: ')) {
              controller.enqueue(encoder.encode(line + '\n'));
            } else if (line.trim()) {
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}
