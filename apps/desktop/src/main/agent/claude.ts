// Anthropic 클라이언트 (main 전용)
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

let client: Anthropic | null = null;
let clientKey = '';
export function claude(): Anthropic {
  if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY가 없습니다');
  if (!client || clientKey !== config.apiKey) {
    // 응답이 끝없이 늦어 브라우저가 멈춘 것처럼 보이지 않게 2분에서 끊고, 일시 오류는 두 번까지 다시 시도
    client = new Anthropic({ apiKey: config.apiKey, timeout: 120_000, maxRetries: 2 });
    clientKey = config.apiKey;
  }
  return client;
}

/** 자주 나는 API 오류를 사용자에게 보일 짧은 문구로. 해당 없으면 null */
export function apiErrorNotice(e: unknown): string | null {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. ⚙️ 설정에서 키를 확인해 주세요.';
  if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 설정한 모델을 쓸 수 없어요.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude 응답이 너무 늦어 멈췄어요. 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIConnectionError) return 'Claude에 연결하지 못했어요. 네트워크 연결을 확인해 주세요.';
  if (e instanceof Anthropic.APIError) {
    // 크레딧 부족은 402(billing_error) 또는 400 + "credit balance" 문구로 온다
    if (e.type === 'billing_error' || e.status === 402 || /credit balance/i.test(e.message)) return 'Anthropic 계정 크레딧이 부족해요. 결제 정보를 확인해 주세요.';
    if (e.type === 'overloaded_error' || e.status === 529) return 'Claude 서버가 붐벼요. 잠시 뒤 다시 시도해 주세요.';
    if (typeof e.status === 'number' && e.status >= 500) return 'Claude 서버에 일시적인 문제가 있어요. 잠시 뒤 다시 시도해 주세요.';
  }
  return null;
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
