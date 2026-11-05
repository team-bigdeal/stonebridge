// 품의서 문장 다듬기: 1.목적·3.선정 사유 문장만 AI가 다듬고, 숫자·근거 번호를 검증해 통과한 문장만 쓴다.
// API 키는 main에서만 쓴다. renderer에는 검증을 통과한 문장만 넘긴다.
import { acceptPolished, type ApprovalSentence, type PolishInput, type PolishResult } from '@shared/approval';
import { config } from '../config';
import { structured } from './claude';

const SYSTEM = `당신은 회사 구매 품의서의 문장을 공문체로 다듬는 도우미입니다.
입력은 facts(근거 번호가 붙은 사실 목록)와, 다듬을 문장 purpose(1.목적)·reasons(3.선정 사유)입니다.
규칙:
- 문장마다 index를 그대로 돌려주고, 그 문장의 뜻만 매끄러운 공문체("~하고자 합니다", "~로 판단됩니다")로 다듬으세요.
- 숫자(금액·수량·날짜·일수)는 facts나 원래 문장에 있는 값을 한 글자도 바꾸지 말고 아라비아 숫자로 쓰세요. 새 숫자를 만들거나 계산하지 마세요.
- facts에 없는 사실, 추측, 평가(예: "품질이 우수")를 넣지 마세요. 원래 문장에 없는 업체·조건도 넣지 마세요.
- evidenceIds에는 그 문장이 기대는 facts의 id만 쓰세요(최소 1개). 원래 문장의 근거 번호는 가능하면 유지하세요.
- "확인 필요", "잠정" 같은 불확실 표현은 지우지 마세요.`;

const ITEMS = {
  type: 'array',
  items: {
    type: 'object',
    properties: { index: { type: 'integer' }, text: { type: 'string' }, evidenceIds: { type: 'array', items: { type: 'integer' } } },
    required: ['index', 'text', 'evidenceIds'],
    additionalProperties: false
  }
};
const SCHEMA = { type: 'object', properties: { purpose: ITEMS, reasons: ITEMS }, required: ['purpose', 'reasons'], additionalProperties: false };

type Raw = { index: number; text: string; evidenceIds: number[] }[];

export type PolishResponse = { ok: true; result: PolishResult } | { ok: false; error: string };

export async function polishApproval(input: PolishInput): Promise<PolishResponse> {
  if (!config.apiKey) return { ok: false, error: 'API 키가 없어 템플릿 문장을 그대로 씁니다.' };
  try {
    const res = await structured<{ purpose: Raw; reasons: Raw }>({
      system: SYSTEM,
      content: JSON.stringify({
        facts: input.facts,
        purpose: input.purpose.map((s, index) => ({ index, text: s.text, evidenceIds: s.evidenceIds })),
        reasons: input.reasons.map((s, index) => ({ index, text: s.text, evidenceIds: s.evidenceIds }))
      }),
      schema: SCHEMA,
      maxTokens: 3000
    });
    // 문장마다 검증: 통과하지 못하면 null (그 자리는 템플릿 문장 그대로)
    const pick = (base: ApprovalSentence[], raw: Raw) =>
      base.map((_, i) => {
        const r = raw.find((x) => x.index === i);
        if (!r) return null;
        const cand: ApprovalSentence = { text: r.text.trim(), evidenceIds: [...new Set(r.evidenceIds)] };
        return acceptPolished(cand, input) ? cand : null;
      });
    return { ok: true, result: { purpose: pick(input.purpose, res.purpose ?? []), reasons: pick(input.reasons, res.reasons ?? []) } };
  } catch (e) {
    return { ok: false, error: `AI 호출에 실패해 템플릿 문장을 그대로 씁니다. (${e instanceof Error ? e.message : String(e)})` };
  }
}
