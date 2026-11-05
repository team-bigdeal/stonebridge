// 양식의 자리를 품의서 항목에 연결한다. AI는 "어느 자리에 어느 항목"만 정하고, 값은 코드가 채운다.
import { guessField, type FieldDef, type TemplateSlot } from '@shared/template';
import { config } from '../config';
import { structured } from '../agent/claude';

const SYSTEM = `당신은 회사 구매 품의서 양식의 빈칸을 품의서 항목에 연결하는 도우미입니다.
- slots는 양식 안의 채울 자리(라벨, 위치, 지금 들어 있는 문구)이고, fields는 채울 수 있는 품의서 항목입니다.
- 각 자리에 가장 알맞은 항목 key를 하나 고르세요. 알맞은 항목이 없거나 결재 서명칸·도장칸처럼 비워 둬야 하면 빈 문자열("")을 쓰세요.
- 값은 당신이 정하지 않습니다. 항목 key만 고르세요. 새 key를 만들지 마세요.
- 표의 "N행 품명/규격/수량/단가/금액/비고"는 같은 번호의 itemN_* 항목에 연결하세요. 그 행에 해당하는 itemN_* 가 없으면 빈 문자열로 두세요.
- 모든 자리에 대해 slotId를 빠짐없이 돌려주세요.`;

const SCHEMA = {
  type: 'object',
  properties: {
    mappings: {
      type: 'array',
      items: { type: 'object', properties: { slotId: { type: 'string' }, field: { type: 'string' } }, required: ['slotId', 'field'], additionalProperties: false }
    }
  },
  required: ['mappings'],
  additionalProperties: false
};

/** 항목 key로 결과를 검증한다: 없는 key는 버린다 */
function clean(raw: { slotId: string; field: string }[], slots: TemplateSlot[], keys: Set<string>) {
  const out: Record<string, string | null> = {};
  const ids = new Set(slots.map((s) => s.id));
  for (const m of raw) if (ids.has(m.slotId)) out[m.slotId] = keys.has(m.field) ? m.field : null;
  return out;
}

export async function mapSlots(slots: TemplateSlot[], fields: FieldDef[]): Promise<{ mapping: Record<string, string | null>; by: 'ai' | 'keyword' }> {
  const keys = new Set(fields.map((f) => f.key));
  const guess = (s: TemplateSlot) => guessField(s.label, keys);
  let ai: Record<string, string | null> = {};
  let by: 'ai' | 'keyword' = 'keyword';
  if (config.apiKey) {
    try {
      const res = await structured<{ mappings: { slotId: string; field: string }[] }>({
        system: SYSTEM,
        content: JSON.stringify({ slots: slots.map((s) => ({ slotId: s.id, label: s.label, context: s.context, current: s.current })), fields }),
        schema: SCHEMA,
        maxTokens: 6000
      });
      ai = clean(res.mappings, slots, keys);
      by = 'ai';
    } catch {
      // 키가 없거나 호출이 실패하면 라벨 글자로 짐작한다
    }
  }
  const mapping: Record<string, string | null> = {};
  for (const s of slots) mapping[s.id] = s.id in ai ? ai[s.id] : guess(s);
  return { mapping, by };
}
