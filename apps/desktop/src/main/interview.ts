// 인터뷰: 견적 비교에 필요한 요구 조건을 짧은 질문으로 채운다 (Claude 구조화 출력)
import type { Requirements } from '@shared/types';
import { addDaysIso } from '@shared/parse';
import { structured } from './agent/claude';

/** A/S가 의미 없는 품목: 인쇄물·판촉물·소모품·식품·꽃 등. 사용자가 A/S를 따로 말하지 않으면 요구하지 않는다 */
const NO_WARRANTY_ITEM = /명함|스티커|라벨|리플릿|전단|브로슈어|카탈로그|팸플릿|포스터|현수막|배너|인쇄|출력|제본|책자|봉투|쇼핑백|판촉|굿즈|티셔츠|단체복|유니폼|머그|텀블러|에코백|키링|뱃지|배지|달력|캘린더|노트|다이어리|떡|도시락|케이터링|간식|식품|음료|꽃|화환|화분|용지|복사지|토너|잉크|소모품|포장/;
const MENTIONS_WARRANTY = /A\/?S|에이에스|보증|수리|하자/i;
/** 사이즈를 모르거나 추천·비교를 원하는 답 */
const SIZE_HELP = /모르|몰라|추천|보여|비교|골라|어떤.{0,6}(사이즈|크기)|뭐가 (있|좋)|아무거나|글쎄/;

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
  specs: { label: string; value: string | null; unit: string | null; options: string[] | null }[];
  showInstall: boolean;
  showWarranty: boolean;
  showRegion: boolean;
  wantsSizeHelp: boolean;
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
  /** 패널에서 마지막으로 바꾼 품목 */
  private wantedItem = '';

  /** 사용자 입력 → 다음 질문 (null이면 인터뷰 종료) + 지금 조건으로 검색을 시작할 수 있는지 + 기본값으로 채운 항목 */
  async next(text: string): Promise<{ question: string | null; ready: boolean; wantsSizeHelp?: boolean; defaulted?: string[] }> {
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
사이즈·규격이 가격을 크게 바꾸는 품목(명함·스티커·라벨·전단·포스터·현수막·배너·봉투·쇼핑백·박스·액자·책자 등)이라도 사이즈를 첫 질문으로 묻지 않는다. 수량을 모르면 수량(필요하면 용도)부터 묻고, 그다음에 사이즈를 묻는다.
사이즈를 물을 때는 정해 둔 사이즈가 있는지 먼저 확인한다. 예: "정해 둔 사이즈가 있으세요? 잘 모르시면 업체 사이트에서 많이 쓰는 사이즈를 모아 실제 크기로 보여 드릴게요."
wantsSizeHelp는 사용자의 가장 최근 메시지가 사이즈를 모르겠다거나 추천·비교·보여 달라고 할 때만 true다 (예: "모르겠어", "추천해줘", "어떤 사이즈가 있어?", "보여줘", "사이즈 비교해줘"). 사이즈를 물었다는 이유만으로 true로 하지 않는다. 이때 nextQuestion은 "업체 사이트에서 사이즈를 모아 볼게요. 카드에서 실제 크기로 비교하고 골라 주세요." 같은 짧은 안내로 한다.
사용자가 사이즈를 말하거나 골랐으면(예: "90×50mm로 할게요") item에 사이즈를 넣고(예: "명함 90×50mm") 다음으로 넘어간다.
남은 질문이 있더라도 품목과 수량 등 업체를 찾아 견적을 받기에 충분한 정보가 모였으면 ready=true.
ready와 nextQuestion은 따로 판단한다. ready=true라고 해서 nextQuestion을 비우지 않는다. 예산·납기를 아직 모르면 nextQuestion으로 묻는다.
specs에는 이 품목의 견적 가격을 크게 바꾸는 세부 조건을 2~4개 넣는다 (품목·수량·예산·납기·설치·A/S·지역은 넣지 않는다). 예: 롤스크린 블라인드 → 가로(cm)·세로(cm)·원단(암막/일반/우드), 원형 스티커 → 지름(mm)·재질(유포지/아트지/투명)·코팅(유광/무광), 노트북 → 화면 크기(인치)·메모리(GB)·용도, 사무실 의자 → 등받이(메쉬/가죽)·팔걸이(있음/없음). 대화에 나온 값은 value에, 모르면 null. 고를 값이 정해져 있으면 options(2~4개), 단위가 있으면 unit. current.specs에 값이 있으면 사용자가 고친 값이니 그대로 둔다. specs 항목은 질문으로 따로 묻지 않는다(카드에서 고칠 수 있음).
showInstall·showWarranty·showRegion은 이 품목에서 설치 여부·A/S 기간·지역을 물을 의미가 있으면 true (스티커·명함 같은 인쇄물은 설치·A/S가 false, 방문 수령이면 지역 false).`,
      content: JSON.stringify({ current: this.req, conversation: this.history, questionsAsked: this.asked }),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'quantity', 'budgetMax', 'deadlineDays', 'needInstall', 'minWarrantyMonths', 'needDelivery', 'region', 'notes', 'vendors', 'onlyVendors', 'specs', 'showInstall', 'showWarranty', 'showRegion', 'wantsSizeHelp', 'nextQuestion', 'ready'],
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
          specs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'value', 'unit', 'options'],
              properties: { label: { type: 'string' }, value: nullable('string'), unit: nullable('string'), options: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] } }
            }
          },
          showInstall: { type: 'boolean' },
          showWarranty: { type: 'boolean' },
          showRegion: { type: 'boolean' },
          wantsSizeHelp: { type: 'boolean' },
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
    this.mergeSpecs(out.specs);
    this.req.shown = { install: out.showInstall, warranty: out.showWarranty, region: out.showRegion };
    // AI가 질문 없이 끝내도 비교에 꼭 필요한 값(예산·납기, 배송·설치가 있으면 지역)이 비었으면 한 번씩만 직접 묻는다
    // 사이즈 도움 요청: AI 판단 + 직전 질문이 사이즈였고 "모르겠어/추천/보여줘" 같은 답이면 안전망으로 인정
    const lastAsk = [...this.history].reverse().find((h) => h.role === 'assistant')?.text ?? '';
    const wantsSizeHelp = out.wantsSizeHelp || (/사이즈|크기|규격/.test(lastAsk) && SIZE_HELP.test(text));
    // 사이즈를 모아 보여 주는 동안 인터뷰가 끝나지 않게 안내를 질문 자리에 둔다
    if (wantsSizeHelp && !out.nextQuestion) out.nextQuestion = '업체 사이트에서 많이 쓰는 사이즈를 모아 볼게요. 카드에서 실제 크기로 비교하고 골라 주세요.';
    const fallback = out.nextQuestion ? null : this.req.item && this.asked < 5 ? this.missingQuestion() : null;
    const question = out.nextQuestion ?? fallback?.q ?? null;
    if (!question || this.asked >= 5) return { question: null, ready: Boolean(this.req.item), wantsSizeHelp, defaulted: this.fillDefaults() };
    if (fallback) this.askedKeys.add(fallback.key);
    this.asked++;
    this.history.push({ role: 'assistant', text: question });
    return { question, ready: Boolean(this.req.item) && (out.ready || Boolean(fallback)), wantsSizeHelp };
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

  /** 품목에 맞는 세부 조건: 사용자가 고친 값은 지키고, 새로 알게 된 값만 채운다 (최대 4개) */
  private mergeSpecs(next: StepOut['specs']) {
    const prev = new Map((this.req.specs ?? []).map((s) => [s.label, s]));
    const merged = next.slice(0, 4).map((s) => {
      const old = prev.get(s.label);
      return { label: s.label, value: old?.value ?? s.value, ...(s.unit ? { unit: s.unit } : {}), ...(s.options?.length ? { options: s.options.slice(0, 4) } : {}) };
    });
    if (merged.length) this.req.specs = merged;
  }

  /** 사용자가 패널에서 품목을 바꿨을 때: 새 품목에 맞는 세부 조건·보일 항목을 다시 정한다 (이전 품목의 세부 조건 값은 버림) */
  async changeItem(item: string) {
    // 빠르게 두 번 바꾸면 늦게 온 앞 품목 결과가 새 품목을 덮지 않게, 마지막에 바꾼 품목만 반영
    this.wantedItem = item;
    const out = await structured<Pick<StepOut, 'specs' | 'showInstall' | 'showWarranty' | 'showRegion'>>({
      system: `너는 견적 탐색 앱 '돌다리'의 인터뷰어다. 사용자가 견적을 받을 품목을 바꿨다.
이 품목의 견적 가격을 크게 바꾸는 세부 조건을 2~4개 specs에 넣는다 (품목·수량·예산·납기·설치·A/S·지역은 넣지 않는다). 예: 롤스크린 블라인드 → 가로(cm)·세로(cm)·원단(암막/일반/우드), 원형 스티커 → 지름(mm)·재질(유포지/아트지/투명)·코팅(유광/무광), 노트북 → 화면 크기(인치)·메모리(GB)·용도, 사무실 의자 → 등받이(메쉬/가죽)·팔걸이(있음/없음).
품목 이름에 값이 들어 있으면(예: "명함 90×50mm") value에 넣고, 모르면 null. 고를 값이 정해져 있으면 options(2~4개), 단위가 있으면 unit.
showInstall·showWarranty·showRegion은 이 품목에서 설치 여부·A/S 기간·지역을 물을 의미가 있으면 true (스티커·명함 같은 인쇄물은 설치·A/S가 false).`,
      content: JSON.stringify({ item }),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['specs', 'showInstall', 'showWarranty', 'showRegion'],
        properties: {
          specs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'value', 'unit', 'options'],
              properties: { label: { type: 'string' }, value: nullable('string'), unit: nullable('string'), options: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] } }
            }
          },
          showInstall: { type: 'boolean' },
          showWarranty: { type: 'boolean' },
          showRegion: { type: 'boolean' }
        }
      }
    });
    if (this.wantedItem !== item) return;
    this.req.item = item;
    this.req.specs = [];
    this.mergeSpecs(out.specs);
    this.req.shown = { install: out.showInstall, warranty: out.showWarranty, region: out.showRegion };
    // 설치·A/S가 의미 없는 품목이면 값도 맞춰 둔다
    if (!out.showInstall) this.req.needInstall = false;
    const said = this.history.filter((h) => h.role === 'user').map((h) => h.text).join(' ');
    if (!out.showWarranty || (NO_WARRANTY_ITEM.test(item) && !MENTIONS_WARRANTY.test(said))) this.req.minWarrantyMonths = 0;
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
