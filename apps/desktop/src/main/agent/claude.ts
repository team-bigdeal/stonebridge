// Anthropic 클라이언트 (main 전용)
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

let client: Anthropic | null = null;
let clientKey = '';
export function claude(): Anthropic {
  if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY가 없습니다');
  if (!client || clientKey !== config.apiKey) {
    client = new Anthropic({ apiKey: config.apiKey });
    clientKey = config.apiKey;
  }
  return client;
}

/** 저장 전에 키가 동작하는지 확인 (모델 정보 조회만, 토큰 사용 없음) */
export async function verifyApiKey(apiKey: string, model: string): Promise<string | null> {
  try {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }).models.retrieve(model);
    return null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않습니다.';
    if (e instanceof Anthropic.PermissionDeniedError) return '이 키로는 해당 모델을 쓸 수 없습니다.';
    if (e instanceof Anthropic.NotFoundError) return `모델 "${model}"을 찾을 수 없습니다.`;
    if (e instanceof Anthropic.APIConnectionError) return '네트워크 연결을 확인해 주세요.';
    return e instanceof Error ? e.message : String(e);
  }
}

/** 구조화 출력(JSON 스키마)으로 한 번 호출하고 파싱한다 */
export async function structured<T>(params: {
  system: string;
  content: Anthropic.ContentBlockParam[] | string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const res = await claude().messages.create({
    model: config.model,
    max_tokens: params.maxTokens ?? 4000,
    system: params.system,
    messages: [{ role: 'user', content: params.content }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: params.schema } }
  });
  if (res.stop_reason === 'refusal') throw new Error('모델이 요청을 거절했습니다');
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('구조화 응답이 비어 있습니다');
  return JSON.parse(text.text) as T;
}
