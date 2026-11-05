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
  vendors: string[] | null;
  onlyVendors: boolean | null;
  askingSize: boolean;
  nextQuestion: string | null;
  ready: boolean;
}

const nullable = (t: string) => ({ anyOf: [{ type: t }, { type: 'null' }] });

export class Interview {
  req: Partial<Requirements> = {};
  private history: { role: 'user' | 'assistant'; text: string }[] = [];
  private asked = 0;
  /** 코드가 직접 물어본 항목 (같은 걸 두 번 묻지 않게) */
  private askedKeys = new Set<keyof Requirements>();

  /** 사용자 입력 → 다음 질문 (null이면 인터뷰 종료) + 지금 조건으로 검색을 시작할 수 있는지 + 기본값으로 채운 항목 */
  async next(text: string): Promise<{ question: string | null; ready: boolean; askingSize?: boolean; defaulted?: string[] }> {
    this.history.push({ role: 'user', text });
    const out = await structured<StepOut>({
      system: `너는 견적 탐색 앱 '돌다리'의 인터뷰어다. 오늘은 ${new Date().toISOString().slice(0, 10)}이다.
사용자가 사려는 품목의 견적을 업체별로 비교하려면 품목, 수량, 예산 상한(원), 납기(오늘부터 며칠 안), 설치/시공 필요 여부, 최소 A/S 기간(개월), 지역(설치·배송이 필요할 때)을 알아야 한다.
지금까지의 대화를 보고 확정된 값을 채우고(모르면 null), 아직 모르는 중요한 값이 있으면 한 번에 하나만 묻는 짧고 친근한 한국어 질문을 nextQuestion에 넣는다.
설치가 의미 없는 품목이면 needInstall=false로 두고 묻지 않는다.
A/S가 의미 없는 품목(명함·스티커·리플릿 같은 인쇄물, 판촉물·단체복, 소모품, 식품, 꽃 등)이면 minWarrantyMonths=0으로 두고 A/S는 묻지 않는다.
배송이 필요 없으면(방문 수령, 매장 픽업, 현장 서비스) needDelivery=false, 택배·배송·설치 장소가 있으면 true. 모르면 null. 사용자가 "상관없어", "알아서"라고 하면 합리적인 값을 채운다.
사용자가 특정 업체·사이트 이름을 말하면(예: "와우프레스에서", "비즈하우스랑 와우프레스 비교") vendors에 그 이름을 넣는다. 그 업체에서만 받고 싶어 하면(예: "와우프레스에서 견적 받아줘", "여기 두 곳만 비교") onlyVendors=true, 다른 업체와 함께 비교하길 원하면(예: "와우프레스도 포함해서") false. 업체를 말하지 않았으면 둘 다 null. 업체 이름은 묻지 않는다.
질문은 꼭 필요한 것만, 짧게 (보통 1~3개, 최대 5개). 키워드 하나만 줘도 바로 찾을 수 있게 나머지는 합리적인 기본값으로 둔다. 충분하면 nextQuestion=null.
사이즈·규격이 가격을 크게 바꾸는 품목(명함·스티커·라벨·전단·포스터·현수막·배너·봉투·쇼핑백·박스·액자·책자 등)인데 사용자가 사이즈를 말하지 않았으면, 다른 것보다 사이즈를 먼저 묻고 askingSize=true로 한다. 이때 질문 끝에 "업체 사이트에서 많이 쓰는 사이즈를 모아 실제 크기로 보여 드릴게요. 보고 고르셔도 돼요."를 덧붙인다. 사이즈를 묻는 질문이 아니면 askingSize=false.
사용자가 사이즈를 골랐으면(예: "90×50mm로 할게요") item에 사이즈를 넣는다 (예: "명함 90×50mm").
남은 질문이 있더라도 품목과 수량 등 업체를 찾아 견적을 받기에 충분한 정보가 모였으면 ready=true.
ready와 nextQuestion은 따로 판단한다. ready=true라고 해서 nextQuestion을 비우지 않는다. 예산·납기를 아직 모르면 nextQuestion으로 묻는다.`,
      content: JSON.stringify({ current: this.req, conversation: this.history, questionsAsked: this.asked }),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'quantity', 'budgetMax', 'deadlineDays', 'needInstall', 'minWarrantyMonths', 'needDelivery', 'region', 'notes', 'vendors', 'onlyVendors', 'askingSize', 'nextQuestion', 'ready'],
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
          vendors: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
          onlyVendors: nullable('boolean'),
          askingSize: { type: 'boolean' },
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
    if (out.vendors?.length) this.req.vendors = [...new Set(out.vendors.map((v) => v.trim()).filter(Boolean))].slice(0, 3);
    if (out.onlyVendors !== null) this.req.onlyVendors = out.onlyVendors;
    // AI가 질문 없이 끝내도 비교에 꼭 필요한 값(예산·납기, 배송·설치가 있으면 지역)이 비었으면 한 번씩만 직접 묻는다
    const fallback = out.nextQuestion ? null : this.req.item && this.asked < 5 ? this.missingQuestion() : null;
    const question = out.nextQuestion ?? fallback?.q ?? null;
    if (!question || this.asked >= 5) return { question: null, ready: Boolean(this.req.item), defaulted: this.fillDefaults() };
    if (fallback) this.askedKeys.add(fallback.key);
    this.asked++;
    this.history.push({ role: 'assistant', text: question });
    return { question, ready: Boolean(this.req.item) && (out.ready || Boolean(fallback)), askingSize: !fallback && out.askingSize };
  }

  /** 아직 비어 있고, 묻지 않은 필수 항목의 질문 */
  private missingQuestion() {
    const r = this.req;
    const asks: { key: keyof Requirements; q: string; need: boolean }[] = [
      { key: 'budgetMax', q: '예산은 최대 얼마까지 생각하세요? 정해진 게 없으면 "상관없어"라고 해 주세요.', need: r.budgetMax === undefined },
      { key: 'deadline', q: '언제까지 받아야 하나요? 오늘부터 며칠 안인지 알려 주세요.', need: r.deadline === undefined },
      { key: 'region', q: '어느 지역으로 받으실 건가요? 배송비·설치비를 맞게 계산하려고요.', need: !r.region && (r.needInstall === true || r.needDelivery !== false) }
    ];
    return asks.find((a) => a.need && !this.askedKeys.has(a.key)) ?? null;
  }

  /** 인터뷰를 마칠 때 예산·납기가 끝내 비었으면 기본값을 카드에도 보이게 채우고, 채운 항목 이름을 돌려준다 */
  private fillDefaults() {
    const filled: string[] = [];
    if (this.req.budgetMax === undefined) {
      this.req.budgetMax = DEFAULTS.budgetMax;
      filled.push('예산');
    }
    if (this.req.deadline === undefined) {
      this.req.deadline = DEFAULTS.deadline;
      filled.push('납기');
    }
    return filled;
  }

  /** 사용자가 카드에서 직접 고친 값 반영 */
  apply(patch: Partial<Requirements>) {
    this.req = { ...this.req, ...patch };
  }

  /** 조건 변경: 다시 대화로 고칠 수 있게 질문 횟수를 되돌린다 */
  reopen() {
    this.asked = 0;
    this.askedKeys.clear();
  }

  result(): Requirements {
    return { ...DEFAULTS, ...this.req, item: this.req.item ?? '견적 품목' } as Requirements;
  }
}
