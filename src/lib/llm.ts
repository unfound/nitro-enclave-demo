import { createOpenAI } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import type { ChatMessage } from './types';

// ============ Config ============

const USE_MOCK = true; // Flip to false when connecting real qwen model

const SYSTEM_PROMPT = `你是一位专业的医疗健康咨询助手。

⚠️ 重要声明：
- 你的回复仅供参考，不构成医学诊断或治疗建议
- 如有严重症状，请立即就医
- 请勿根据AI建议自行用药

请用中文回答，语言专业但易懂，给出清晰的健康建议。`;

// ============ Mock LLM (for demo without real model) ============

const MOCK_RESPONSES: Record<string, string> = {
  default: `根据您描述的症状，我为您提供以下初步评估：

**可能的情况：**
您的症状（头疼、发烧38.5°C、咳嗽伴黄痰，持续3天）符合**急性上呼吸道感染**的表现，黄痰提示可能合并细菌感染。

**建议：**
1. 建议就医做血常规 + CRP检查，确认感染类型
2. 体温超过38.5°C可服用对乙酰氨基酚退热
3. 多休息、多饮水
4. 如出现呼吸困难、高热不退（>39°C持续48h）请立即就医

**需要关注的警示信号：**
- 呼吸急促或胸痛
- 症状持续加重超过5天
- 出现皮疹或关节疼痛

⚠️ 此评估仅供参考，不构成诊断。建议尽早就医确认。`,
};

function getMockResponse(userMessage: string): string {
  // Simple keyword matching for demo variety
  if (userMessage.includes('头疼') || userMessage.includes('发烧')) {
    return MOCK_RESPONSES.default;
  }
  return `感谢您的咨询。

根据您的描述，我建议：

1. 详细描述您的症状（持续时间、严重程度、伴随症状）
2. 提供您的基础信息（年龄、既往病史、用药情况）
3. 如有紧急情况，请立即拨打120

请提供更多细节，我可以给您更有针对性的建议。

⚠️ 此评估仅供参考，不构成诊断。`;
}

// ============ Real LLM (OpenAI compatible) ============

function createLLM() {
  return createOpenAI({
    baseURL: process.env.LLM_BASE_URL || 'http://192.168.0.120:8888/v1',
    apiKey: process.env.LLM_API_KEY || 'not-needed',
  })(process.env.LLM_MODEL || 'qwen3.5-9b');
}

// ============ Public API ============

/**
 * Call the LLM and return a ReadableStream of text chunks.
 * Wraps both mock and real LLM behind a unified async iterator.
 */
export async function* streamLLM(
  messages: ChatMessage[]
): AsyncIterable<string> {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (USE_MOCK) {
    // Mock: stream token-by-token with delay
    const response = getMockResponse(lastUserMsg);
    const chars = response.split('');
    for (const char of chars) {
      yield char;
      await new Promise((r) => setTimeout(r, 15));
    }
    return;
  }

  // Real LLM via Vercel AI SDK
  const { streamText } = await import('ai');

  const coreMessages: CoreMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const result = streamText({
    model: createLLM(),
    messages: coreMessages,
  });

  // streamText returns an async iterable of text chunks
  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Get the Vercel AI SDK streamText result (for plain SSE mode).
 * Used directly with toDataStreamResponse().
 */
export function getStreamTextResult(messages: ChatMessage[]) {
  const { streamText } = require('ai');

  const coreMessages: CoreMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  return streamText({
    model: createLLM(),
    messages: coreMessages,
  });
}
