import { createOpenAI } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import type { ChatMessage } from './types';

// ============ Config ============

/**
 * 是否使用 Mock 模式。
 * - true:  使用内置假回复，无需真实模型，适合 UI 开发调试
 * - false: 连接真实大模型（需要 LLM 服务可用）
 *
 * 也可通过环境变量 USE_MOCK_LLM 控制：
 *   USE_MOCK_LLM=true npm run dev   → 强制 mock
 *   USE_MOCK_LLM=false npm run dev  → 强制真实模型
 *   不设置时默认 true（安全回退）
 */
const USE_MOCK = process.env.USE_MOCK_LLM !== 'false';

/**
 * System Prompt — 定义 AI 角色和行为规范。
 * 如需调整回复风格，直接修改此常量。
 * 也可通过环境变量 SYSTEM_PROMPT 覆盖。
 */
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `你是一位专业的运动健康咨询助手。

⚠️ 重要声明：
- 你的回复仅供参考，不构成医学诊断或治疗建议
- 如有严重症状，请立即就医
- 请勿根据AI建议自行用药

请用中文回答，语言专业但易懂，给出清晰的运动健康建议。`;

// ============ Mock LLM (无需真实模型) ============

const MOCK_RESPONSES: Record<string, string> = {
  knee: `根据您描述的情况（跑步后膝盖疼痛），以下是初步分析：

**可能的原因：**
1. **髌骨软化症** — 跑步时膝盖前方疼痛，下楼梯加重
2. **髂胫束综合征** — 膝盖外侧疼痛，长跑后明显
3. **半月板损伤** — 膝关节弹响、卡顿感

**建议：**
1. 立即减少跑量，改为低冲击运动（游泳、骑车）
2. 冰敷膝盖 15-20 分钟，每天 2-3 次
3. 强化股四头肌：靠墙静蹲 30秒×3组/天
4. 如疼痛持续超过 2 周或有肿胀，建议运动医学科就诊

**恢复跑步前建议：**
- 疼痛完全消失 1 周后
- 先从短距离慢跑开始（2-3km）
- 注意跑鞋缓震性能，每 500-800km 更换

⚠️ 此评估仅供参考，建议运动医学科面诊确认。`,

  fatLoss: `以下是为您制定的减脂运动计划：

**周计划安排（每周 4-5 次）：**
| 日 | 内容 | 时长 |
|---|------|------|
| 周一 | 力量训练（上肢） | 40min |
| 周二 | HIIT 间歇跑 | 25min |
| 周三 | 休息或轻度拉伸 | - |
| 周四 | 力量训练（下肢） | 40min |
| 周五 | 稳态有氧（慢跑/游泳） | 35min |
| 周六 | 全身循环训练 | 30min |
| 周日 | 休息 | - |

**关键原则：**
1. 力量训练优先复合动作（深蹲、硬拉、推举），消耗更大
2. HIIT 效率高于匀速跑：30秒冲刺 + 60秒慢走，重复 8-10 组
3. 运动前后各 5 分钟动态热身/静态拉伸
4. 配合饮食控制（蛋白质 1.6g/kg体重，碳水适量）

**注意事项：**
- 体重基数大先从快走开始，保护关节
- 每周减重 0.5-1kg 为健康速度
- 保证每晚 7-8 小时睡眠

⚠️ 建议结合体检数据制定个性化方案。`,

  soreness: `运动后肌肉酸痛（DOMS）的缓解方法：

**即时处理（运动后 0-2 小时）：**
1. **冷热交替** — 冲澡时冷热交替 30秒×4组，促进血液循环
2. **补充营养** — 蛋白质 + 碳水（如牛奶 + 香蕉），30 分钟内摄入
3. **轻度活动** — 散步 10-15 分钟，避免直接坐下不动

**短期恢复（24-72 小时）：**
1. **泡沫轴放松** — 每个酸痛部位滚动 1-2 分钟
2. **轻量拉伸** — 静态拉伸每个动作保持 30 秒
3. **充足睡眠** — 7-9 小时，肌肉修复主要在睡眠中完成
4. **适量蛋白质** — 每餐 20-30g 优质蛋白

**预防下次酸痛：**
- 新动作/新重量循序渐进（每周增加不超过 10%）
- 运动前充分热身（5-10 分钟）
- 运动后即刻拉伸，不要跳过

**什么时候该就医：**
- 酸痛超过 5 天不缓解
- 尿液呈深褐色（横纹肌溶解风险）
- 关节肿胀或活动受限

⚠️ 轻度 DOMS 是正常训练反应，通常 2-3 天自行消退。`,
};

/**
 * 根据用户消息匹配最相关的 mock 回复。
 * 关键词匹配逻辑，覆盖常见运动健康场景。
 */
function getMockResponse(userMessage: string): string {
  if (userMessage.includes('膝盖') || userMessage.includes('跑步')) {
    return MOCK_RESPONSES.knee;
  }
  if (
    userMessage.includes('减脂') ||
    userMessage.includes('减肥') ||
    userMessage.includes('运动计划')
  ) {
    return MOCK_RESPONSES.fatLoss;
  }
  if (
    userMessage.includes('酸痛') ||
    userMessage.includes('肌肉') ||
    userMessage.includes('恢复')
  ) {
    return MOCK_RESPONSES.soreness;
  }

  return `感谢您的咨询。

根据您的描述，我建议：

1. 详细描述您的症状（持续时间、严重程度、伴随症状）
2. 提供您的运动习惯（频率、强度、项目）
3. 如有紧急情况，请立即拨打 120

请提供更多细节，我可以给您更有针对性的建议。

⚠️ 此评估仅供参考，不构成诊断。`;
}

// ============ 真实 LLM（OpenAI 兼容接口） ============

/**
 * 创建 LLM 客户端实例。
 *
 * 环境变量配置：
 *   LLM_BASE_URL  — 模型 API 地址，默认 http://192.168.0.120:8888/v1
 *   LLM_MODEL     — 模型名称，默认 qwen3.5-9b
 *   LLM_API_KEY   — API Key（本地模型通常不需要）
 *
 * 使用 Vercel AI SDK 的 @ai-sdk/openai 适配器，
 * 兼容任何 OpenAI 格式的 API（Ollama、vLLM、LM Studio 等）。
 */
function createLLM() {
  return createOpenAI({
    baseURL: process.env.LLM_BASE_URL || 'http://192.168.0.120:8888/v1',
    apiKey: process.env.LLM_API_KEY || 'not-needed',
  })(process.env.LLM_MODEL || 'qwen3.5-9b');
}

// ============ 对外接口 ============

/**
 * 调用 LLM 并返回文本块的异步迭代器。
 * 用于加密模式（逐块加密后传输）。
 *
 * 同时支持 mock 和真实模型，由 USE_MOCK 控制。
 */
export async function* streamLLM(
  messages: ChatMessage[]
): AsyncIterable<string> {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (USE_MOCK) {
    // Mock 模式：逐字符输出，模拟真实流式效果
    const response = getMockResponse(lastUserMsg);
    for (const char of response) {
      yield char;
      await new Promise((r) => setTimeout(r, 15));
    }
    return;
  }

  // 真实模型：通过 Vercel AI SDK 的 streamText 获取流式响应
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

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * 获取 Vercel AI SDK 的 streamText 结果（用于明文 SSE 模式）。
 * 返回的对象自带 toDataStreamResponse() 方法，可直接用于 Next.js Response。
 *
 * Mock 模式下会构造一个模拟的 SSE Response，
 * 输出格式与真实模型一致（OpenAI 兼容格式）。
 */
export function getStreamTextResult(messages: ChatMessage[]) {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (USE_MOCK) {
    const response = getMockResponse(lastUserMsg);
    return {
      toDataStreamResponse() {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            for (const char of response) {
              const sseLine = `data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`;
              controller.enqueue(encoder.encode(sseLine));
              await new Promise((r) => setTimeout(r, 15));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      },
    };
  }

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
