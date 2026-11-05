// 인터뷰: 견적 비교에 필요한 요구 조건을 짧은 질문으로 채운다 (Claude 구조화 출력)
import type { Requirements } from '@shared/types';
import { addDaysIso } from '@shared/parse';
import { structured } from './agent/claude';

const DEFAULTS: Omit<Requirements, 'item'> = {
  quantity: 1,
  budgetMax: 1_000_000,
  deadline: addDaysIso(14),
  needInstall: false,
  minWarrantyMonths: 12
};

interface StepOut {
  item: string | null;
  quantity: number | null;
  budgetMax: number | null;
  deadlineDays: number | null;
  needInstall: boolean | null;
  minWarrantyMonths: number | null;
  region: string | null;
  notes: string | null;
  nextQuestion: string | null;
}

const nullable = (t: string) => ({ anyOf: [{ type: t }, { type: 'null' }] });

export class Interview {
  req: Partial<Requirements> = {};
  private history: { role: 'user' | 'assistant'; text: string }[] = [];
  private asked = 0;

  /** 사용자 입력 → 다음 질문 (null이면 인터뷰 종료) */
  async next(text: string): Promise<string | null> {
    this.history.push({ role: 'user', text });
    const out = await structured<StepOut>({
      system: `너는 견적 탐색 앱 '돌다리'의 인터뷰어다. 오늘은 ${new Date().toISOString().slice(0, 10)}이다.
사용자가 사려는 품목의 견적을 업체별로 비교하려면 품목, 수량, 예산 상한(원), 납기(오늘부터 며칠 안), 설치/시공 필요 여부, 최소 A/S 기간(개월), 지역(설치·배송이 필요할 때)을 알아야 한다.
지금까지의 대화를 보고 확정된 값을 채우고(모르면 null), 아직 모르는 중요한 값이 있으면 한 번에 하나만 묻는 짧고 친근한 한국어 질문을 nextQuestion에 넣는다.
설치가 의미 없는 품목이면 needInstall=false로 두고 묻지 않는다. 사용자가 "상관없어", "알아서"라고 하면 합리적인 값을 채운다.
질문은 최대 5개. 충분하면 nextQuestion=null.`,
      content: JSON.stringify({ current: this.req, conversation: this.history, questionsAsked: this.asked }),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'quantity', 'budgetMax', 'deadlineDays', 'needInstall', 'minWarrantyMonths', 'region', 'notes', 'nextQuestion'],
        properties: {
          item: nullable('string'),
          quantity: nullable('integer'),
          budgetMax: nullable('integer'),
          deadlineDays: nullable('integer'),
          needInstall: nullable('boolean'),
          minWarrantyMonths: nullable('integer'),
          region: nullable('string'),
          notes: nullable('string'),
          nextQuestion: nullable('string')
        }
      }
    });
    if (out.item) this.req.item = out.item;
    if (out.quantity !== null) this.req.quantity = out.quantity;
    if (out.budgetMax !== null) this.req.budgetMax = out.budgetMax;
    if (out.deadlineDays !== null) this.req.deadline = addDaysIso(out.deadlineDays);
    if (out.needInstall !== null) this.req.needInstall = out.needInstall;
    if (out.minWarrantyMonths !== null) this.req.minWarrantyMonths = out.minWarrantyMonths;
    if (out.region) this.req.region = out.region;
    if (out.notes) this.req.notes = out.notes;
    if (!out.nextQuestion || this.asked >= 5) return null;
    this.asked++;
    this.history.push({ role: 'assistant', text: out.nextQuestion });
    return out.nextQuestion;
  }

  result(): Requirements {
    return { ...DEFAULTS, ...this.req, item: this.req.item ?? '견적 품목' } as Requirements;
  }
}
