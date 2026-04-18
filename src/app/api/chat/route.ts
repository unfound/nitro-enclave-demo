import { NextRequest, NextResponse } from 'next/server';
import { getEnclaveKeyPair, isEnclaveMode } from '@/lib/enclave';
import { openAsync, encryptChunk } from '@/lib/crypto';
import { streamLLM } from '@/lib/llm';
import type { ChatRequest, ChatErrorResponse } from '@/lib/types';

export async function POST(req: NextRequest) {
  const body: ChatRequest = await req.json();

  if ('encrypted' in body && body.encrypted) {
    return handleEncrypted(body as ChatRequest & { enc: string; ct: string });
  }
  return handlePlain(body);
}

// ===================== Plain mode (SSE via Vercel AI SDK) =====================

async function handlePlain(body: ChatRequest) {
  if (!('messages' in body)) {
    return NextResponse.json(
      { error: 'INVALID_REQUEST', message: 'Missing messages array' },
      { status: 400 }
    );
  }

  const messages = body.messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // In enclave mode, force encrypted path
  if (isEnclaveMode()) {
    return NextResponse.json(
      {
        error: 'ENCRYPTION_REQUIRED',
        message: 'Enclave mode active — encrypted channel required',
      },
      { status: 403 }
    );
  }

  // Non-enclave: plain text streaming via Vercel AI SDK (SSE)
  const { getStreamTextResult } = await import('@/lib/llm');
  const result = getStreamTextResult(messages);
  return result.toDataStreamResponse();
}

// ===================== Encrypted mode (Streamable HTTP) =====================

async function handleEncrypted(
  body: ChatRequest & { enc: string; ct: string }
) {
  if (!isEnclaveMode()) {
    return NextResponse.json(
      {
        error: 'SERVICE_NOT_IN_ENCLAVE',
        message:
          'Service not in trusted execution environment — encrypted data cannot be processed.',
      } satisfies ChatErrorResponse,
      { status: 403 }
    );
  }

  try {
    const keyPair = getEnclaveKeyPair();
    const { messages, responseKey } = await openAsync(
      body.enc,
      body.ct,
      keyPair.privateKey
    );

    // Stream LLM response, encrypting each chunk
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of streamLLM(messages)) {
            const encrypted = encryptChunk(chunk, responseKey);
            controller.enqueue(
              encoder.encode(JSON.stringify(encrypted) + '\n')
            );
          }
        } catch (err) {
          console.error('[chat] LLM stream error:', err);
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
    console.error('[chat] decrypt error:', err);
    return NextResponse.json(
      {
        error: 'DECRYPT_FAILED',
        message: 'Decryption failed — data may be corrupted or keys mismatched',
      } satisfies ChatErrorResponse,
      { status: 400 }
    );
  }
}
