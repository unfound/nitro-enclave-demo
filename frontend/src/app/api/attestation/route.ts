import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * 解析黄金基准线字符串为 map
 * 格式: "1:sha256:xxx,4:sha256:yyy" → { "1": "sha256:xxx", "4": "sha256:yyy" }
 */
function parseGoldenBaseline(raw: string): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key && val) result[key] = val;
    }
  }
  return result;
}

/**
 * 前端独立校验 PCR 值与黄金基准线的匹配状态
 * 返回: { "1": "match", "4": "mismatch", ... }
 */
function validatePcrs(
  pcrs: Record<string, string>,
  baseline: Record<string, string>,
): Record<string, string> {
  const status: Record<string, string> = {};
  for (const [idx, expected] of Object.entries(baseline)) {
    const actual = pcrs[idx];
    if (actual === undefined) {
      status[idx] = 'missing';
    } else if (actual === expected) {
      status[idx] = 'match';
    } else {
      status[idx] = 'mismatch';
    }
  }
  return status;
}

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

    // 从前端自己的环境变量读取黄金基准线（运行时，非构建时）
    const baselineRaw = process.env.PCR_GOLDEN_BASELINE || '';
    const baseline = parseGoldenBaseline(baselineRaw);
    const hasBaseline = Object.keys(baseline).length > 0;

    // 前端独立校验（不信任后端返回的 pcrStatus）
    const pcrStatus = hasBaseline ? validatePcrs(data.pcrs ?? {}, baseline) : {};
    const pcrAllMatch = hasBaseline
      ? Object.values(pcrStatus).every((s) => s === 'match')
      : true;

    // 信任判定：后端 trusted + 前端独立校验全部匹配
    const trusted = data.trusted && pcrAllMatch;

    console.log('[API /attestation] ← trusted=%v mock=%v pcrs=%v baseline=%v',
      trusted, data.mock, Object.keys(data.pcrs ?? {}).length, hasBaseline);

    return NextResponse.json({
      pcrs: data.pcrs,
      pcrStatus,
      publicKey: data.publicKey,
      trusted,
      mock: data.mock,
    });
  } catch (err) {
    console.error('[API /attestation] ← 网络错误: %o', err);
    return NextResponse.json({
      trusted: false,
      publicKey: null,
      pcrs: null,
      pcrStatus: {},
      mock: false,
    });
  }
}
