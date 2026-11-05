// 인터뷰: 견적 비교에 필요한 요구 조건을 짧은 질문으로 채운다 (Claude 구조화 출력)
import type { Requirements } from '@shared/types';
import { addDaysIso } from '@shared/parse';
import { structured } from './agent/claude';

/** A/S가 의미 없는 품목: 인쇄물·판촉물·소모품·식품·꽃 등. 사용자가 A/S를 따로 말하지 않으면 요구하지 않는다 */
const NO_WARRANTY_ITEM = /명함|스티커|라벨|리플릿|전단|브로슈어|카탈로그|팸플릿|포스터|현수막|배너|인쇄|출력|제본|책자|봉투|쇼핑백|판촉|굿즈|티셔츠|단체복|유니폼|머그|텀블러|에코백|키링|뱃지|배지|달력|캘린더|노트|다이어리|떡|도시락|케이터링|간식|식품|음료|꽃|화환|화분|용지|복사지|토너|잉크|소모품|포장/;
const MENTIONS_WARRANTY = /A\/?S|에이에스|보증|수리|하자/i;

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
  needDelivery: boolean | null;
  region: string | null;
  notes: string | null;
  nextQuestion: string | null;
  ready: boolean;
}

const nullable = (t: string) => ({ anyOf: [{ type: t }, { type: 'null' }] });

export class Interview {
  req: Partial<Requirements> = {};
  private history: { role: 'user' | 'assistant'; text: string }[] = [];
  private asked = 0;

  /** 사용자 입력 → 다음 질문 (null이면 인터뷰 종료) + 지금 조건으로 검색을 시작할 수 있는지 */
  async next(text: string): Promise<{ question: string | null; ready: boolean }> {
    this.history.push({ role: 'user', text });
    const out = await structured<StepOut>({
      system: `너는 견적 탐색 앱 '돌다리'의 인터뷰어다. 오늘은 ${new Date().toISOString().slice(0, 10)}이다.
사용자가 사려는 품목의 견적을 업체별로 비교하려면 품목, 수량, 예산 상한(원), 납기(오늘부터 며칠 안), 설치/시공 필요 여부, 최소 A/S 기간(개월), 지역(설치·배송이 필요할 때)을 알아야 한다.
지금까지의 대화를 보고 확정된 값을 채우고(모르면 null), 아직 모르는 중요한 값이 있으면 한 번에 하나만 묻는 짧고 친근한 한국어 질문을 nextQuestion에 넣는다.
설치가 의미 없는 품목이면 needInstall=false로 두고 묻지 않는다.
A/S가 의미 없는 품목(명함·스티커·리플릿 같은 인쇄물, 판촉물·단체복, 소모품, 식품, 꽃 등)이면 minWarrantyMonths=0으로 두고 A/S는 묻지 않는다.
배송이 필요 없으면(방문 수령, 매장 픽업, 현장 서비스) needDelivery=false, 택배·배송·설치 장소가 있으면 true. 모르면 null. 사용자가 "상관없어", "알아서"라고 하면 합리적인 값을 채운다.
질문은 최대 5개. 충분하면 nextQuestion=null.
남은 질문이 있더라도 품목과 수량 등 업체를 찾아 견적을 받기에 충분한 정보가 모였으면 ready=true.`,
      content: JSON.stringify({ current: this.req, conversation: this.history, questionsAsked: this.asked }),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'quantity', 'budgetMax', 'deadlineDays', 'needInstall', 'minWarrantyMonths', 'needDelivery', 'region', 'notes', 'nextQuestion', 'ready'],
        properties: {
          item: nullable('string'),
          quantity: nullable('integer'),
          budgetMax: nullable('integer'),
          deadlineDays: nullable('integer'),
          needInstall: nullable('boolean'),
          minWarrantyMonths: nullable('integer'),
          needDelivery: nullable('boolean'),
          region: nullable('string'),
          notes: nullable('string'),
          nextQuestion: nullable('string'),
          ready: { type: 'boolean' }
        }
      }
    });
    if (out.item) this.req.item = out.item;
    if (out.quantity !== null) this.req.quantity = out.quantity;
    if (out.budgetMax !== null) this.req.budgetMax = out.budgetMax;
    if (out.deadlineDays !== null) this.req.deadline = addDaysIso(out.deadlineDays);
    if (out.needInstall !== null) this.req.needInstall = out.needInstall;
    if (out.minWarrantyMonths !== null) this.req.minWarrantyMonths = out.minWarrantyMonths;
    if (out.needDelivery !== null) this.req.needDelivery = out.needDelivery;
    // 안전망: A/S가 의미 없는 품목인데 사용자가 A/S를 말한 적이 없으면 요구하지 않는다
    const said = this.history.filter((h) => h.role === 'user').map((h) => h.text).join(' ');
    if (this.req.item && NO_WARRANTY_ITEM.test(this.req.item) && !MENTIONS_WARRANTY.test(said)) this.req.minWarrantyMonths = 0;
    if (out.region) this.req.region = out.region;
    if (out.notes) this.req.notes = out.notes;
    if (!out.nextQuestion || this.asked >= 5) return { question: null, ready: Boolean(this.req.item) };
    this.asked++;
    this.history.push({ role: 'assistant', text: out.nextQuestion });
    return { question: out.nextQuestion, ready: Boolean(this.req.item) && out.ready };
  }

  /** 사용자가 카드에서 직접 고친 값 반영 */
  apply(patch: Partial<Requirements>) {
    this.req = { ...this.req, ...patch };
  }

  /** 조건 변경: 다시 대화로 고칠 수 있게 질문 횟수를 되돌린다 */
  reopen() {
    this.asked = 0;
  }

  result(): Requirements {
    return { ...DEFAULTS, ...this.req, item: this.req.item ?? '견적 품목' } as Requirements;
  }
}
