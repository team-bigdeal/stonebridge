// 전체 흐름 (대화 하나로 이어짐):
// 요구 조건 → 브라우저 3개가 동시에 각자 업체를 찾아 견적 수집(가격 없으면 메일/파일) → 업체별 통일 견적서 → 비교·추천 → 작성 → 통합 견적서
import { randomUUID } from 'node:crypto';
import { shell, type BrowserWindow } from 'electron';
import type { FieldKey, MailDraft, MailKind, QuoteMeta, QuoteOriginal, ReportedFields, Requirements, RunSummary, Slot, VendorId, VendorInfo } from '@shared/types';
import { VENDOR_IDS } from '@shared/types';
import { confirmedSum, missingKeys, productAmount, priceQty, rankQuotes, recommend } from '@shared/quote';
import { hasApiKey, imapConfigured } from './config';
import {
  emit, getStage, getVendorStatus, notice, onEmit, resetStatuses, say, setBusy, setStage, setVendorStatus, timeline
} from './events';
import { addOriginal, clearOriginals, saveRecord, startRecord } from './history';
import { Interview } from './interview';
import { quoteStore } from './quote/store';
import { getDriver, refreshState, resetAll, setHandoff } from './browser';
import { ENGINE_ORDER, type Engine } from './browser/page';
import { runAgent } from './agent/loop';
import { collectSystemPrompt, formSystemPrompt, huntSystemPrompt, verifyPriceSystemPrompt } from './agent/prompts';
import type { PickedVendor, ToolName } from './agent/tools';
import { formMessage, orderDraft, questionDraft, requestDraft } from './drafts';
import { recordMail, sendMail, subjectTag } from './channels/mail-send';
import { watchReply, type IncomingReply } from './channels/mail-poll';
import { extractQuote } from './channels/extract';
import { fillLeadTimeFromText } from './quote/normalize';
import { parseQuoteFile } from './channels/file-parse';
import { getVendor, listVendors, replaceVendor, setVendorEmail, setVendors, vendorName } from './vendors';
import { savePdf } from './report';

// 웹 캡처·메일·파일 원본을 히스토리에도 보관
onEmit((ev) => {
  if (ev.type === 'original' && ev.vendorId) addOriginal(ev.vendorId, ev.payload as QuoteOriginal);
});

let interview: Interview | null = null;
let requirements: Requirements | null = null;
let docsShown = false;
let compareShown = false;
let generation = 0;
const drafts = new Map<string, MailDraft>();
/** 교체된 업체는 다시 고르지 않는다 */
const banned = new Set<string>();
/** 브라우저마다 웹 견적을 시도할 업체 수. 다 안 되면 그때 메일/파일로 */
const MAX_TRIES = 3;
interface Fallback {
  vendor: VendorInfo;
  channel: 'mail' | 'file';
  email?: string;
  contact?: string;
  reason: string;
}
const tries = new Map<VendorId, number>();
const fallbacks = new Map<VendorId, Fallback[]>();
const triedNames = new Map<VendorId, string[]>();
/** 브라우저마다 쓰는 검색 엔진 (검색 페이지가 막혀 건너뛰면 다음 엔진) */
const engines = new Map<VendorId, Engine>();
/** 처음 요청에 업체 URL이 있으면 검색 대신 그 업체들로 */
let givenUrls: string[] = [];
/** 사용자에게 넘긴 브라우저가 어떤 단계였는지 (계속/건너뛰기용) */
const handoffMode = new Map<VendorId, { mode: 'hunt' | 'collect'; url?: string }>();
const captured = new Set<string>();
/** 가격 이상치 재확인을 이미 한 업체 (값이 바뀌면 다시 할 수 있게 값까지 키로) */
const verified = new Set<string>();
/** 다른 업체 금액과 이만큼(배) 이상 차이 나면 기준 수량을 다시 확인한다 */
const OUTLIER_RATIO = 3;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clause = (s: string) => s.trim().replace(/[.。!]+$/, '');
const hostKey = (url: string) => {
  try {
    const u = new URL(url);
    return u.host.replace(/^(www|m)\./, '') + (/(smartstore|11st|gmarket|auction|ssg|lotteon)/.test(u.hostname) ? u.pathname.split('/').slice(0, 3).join('/') : '');
  } catch {
    return url;
  }
};

const HUNT_TOOLS: ToolName[] = ['search_web', 'navigate', 'read_text', 'find_in_page', 'snapshot', 'click', 'select_option', 'expand_all', 'claim_vendor', 'report_quote', 'switch_channel', 'request_user'];
const COLLECT_TOOLS: ToolName[] = ['navigate', 'read_text', 'find_in_page', 'snapshot', 'click', 'select_option', 'expand_all', 'report_quote', 'switch_channel', 'request_user'];

// ─── 대화 입력 ────────────────────────────────────────────────

export async function onChat(text: string) {
  if (!hasApiKey()) {
    say('먼저 오른쪽 위 ⚙️ 설정에서 Anthropic API 키를 넣어 주세요.');
    emit('notice', { message: 'API 키가 필요합니다', payload: { openSettings: true } });
    return;
  }
  try {
    setBusy(true);
    if (getStage() === 'interview') {
      if (!interview) {
        interview = new Interview();
        timeline({ kind: 'requirements' });
      }
      givenUrls = [...new Set([...givenUrls, ...(text.match(/https?:\/\/[^\s)]+/g) ?? [])])].slice(0, 3);
      const { question, ready } = await interview.next(text);
      emit('requirements', { payload: interview.req });
      emit('requirements_ready', { payload: ready });
      if (question) {
        say(ready ? `${question}\n(지금 조건으로도 찾을 수 있어요. 요구 조건 카드의 "지금 바로 시작"을 누르면 바로 검색해요.)` : question);
        return;
      }
      say(ready ? '요구 조건을 정리했어요. 카드에서 내용을 확인하고 고칠 게 있으면 고친 뒤 "이대로 검색 시작"을 눌러 주세요.' : '어떤 품목의 견적이 필요한지 알려 주세요.');
      return;
    }
    // 사용자가 업체 URL을 주면 비어 있거나 막힌 자리에 넣는다
    const urls = text.match(/https?:\/\/[^\s)]+/g);
    if (urls && requirements) {
      for (const url of urls.slice(0, 3)) {
        const slot = VENDOR_IDS.find((id) => !getVendor(id) || ['failed', 'needs_user'].includes(getVendorStatus(id)));
        if (!slot) break;
        claim(slot, { name: new URL(url).hostname.replace(/^www\./, ''), url, reason: '사용자가 지정' });
        void collect(slot);
      }
      return;
    }
    // 비교·추천 이후 채팅으로 조건을 바꾸면 조건 변경 흐름으로 (바뀐 게 없으면 안내만)
    if (interview && requirements && ['compare', 'questions', 'draft'].includes(getStage())) {
      interview.apply(requirements);
      interview.reopen();
      // 메모(notes)는 일반 질문에도 채워질 수 있어 조건 변경 판단에서 뺀다
      const snapshot = () => JSON.stringify({ ...interview!.result(), notes: undefined });
      const before = snapshot();
      const { question } = await interview.next(text);
      if (snapshot() !== before) {
        await revise(true);
        say(question ? `조건을 바꿨어요. ${question}\n(답하지 않아도 카드의 "이대로 검색 시작"으로 바로 다시 검색할 수 있어요.)` : '바뀐 조건을 반영했어요. 카드에서 확인하고 "이대로 검색 시작"을 눌러 주세요.');
        return;
      }
    }
    say('진행 중인 카드의 버튼으로 이어서 할 수 있어요. 업체 사이트 URL을 붙여 넣으면 그 업체도 견적에 넣을게요. 처음부터 하려면 위의 "새 견적"을 눌러 주세요.');
  } catch (e) {
    notice(`처리 실패: ${errMsg(e)}`);
  } finally {
    setBusy(false);
  }
}

// ─── 요구 조건 확인 → 검색 시작 ──────────────────────────────

const posInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

/** 사용자가 카드에서 확인(필요하면 수정)하고 시작을 누름 */
export async function startSearch(patch: Partial<Requirements>) {
  if (!interview || getStage() !== 'interview') return;
  // renderer 입력이라 값을 검증해서 받는다
  const clean: Partial<Requirements> = {};
  if (typeof patch.item === 'string' && patch.item.trim()) clean.item = patch.item.trim().slice(0, 200);
  if (posInt(patch.quantity)) clean.quantity = patch.quantity;
  if (posInt(patch.budgetMax)) clean.budgetMax = patch.budgetMax;
  if (typeof patch.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.deadline)) clean.deadline = patch.deadline;
  if (typeof patch.needInstall === 'boolean') clean.needInstall = patch.needInstall;
  if (typeof patch.minWarrantyMonths === 'number' && Number.isInteger(patch.minWarrantyMonths) && patch.minWarrantyMonths >= 0) clean.minWarrantyMonths = patch.minWarrantyMonths;
  if (typeof patch.region === 'string') clean.region = patch.region.trim().slice(0, 100) || undefined;
  interview.apply(clean);
  if (!interview.req.item) {
    say('어떤 품목의 견적이 필요한지 먼저 알려 주세요.');
    return;
  }
  requirements = interview.result();
  emit('requirements', { payload: requirements });
  emit('requirements_ready', { payload: false });
  void (givenUrls.length ? startWithUrls(requirements, givenUrls) : startHunt(requirements));
}

// ─── 브라우저 3개가 동시에: 업체 찾기 → 견적 받기 ──────────────

async function startHunt(req: Requirements) {
  setStage('search');
  setVendors([]);
  emit('vendors', { payload: [] });
  quoteStore.reset(req, VENDOR_IDS);
  quoteStore.onGateOpen = showCompare;
  quoteStore.onDrained = onQuotesSettled;
  say(`좋아요. 브라우저 3개가 동시에 "${req.item}" 업체를 찾아 견적을 받아 올게요.\nA는 전문 업체·공식몰, B는 쇼핑몰, C는 시공·설치 업체 쪽을 맡아요.`);
  timeline({ kind: 'vendors' });
  tries.clear();
  fallbacks.clear();
  triedNames.clear();
  const gen = generation;
  await Promise.all(VENDOR_IDS.map((id) => hunt(id, gen)));
  maybeOpenGate();
}

/** 사용자가 준 업체 URL로 바로 견적 받기 (검색 생략) */
async function startWithUrls(req: Requirements, urls: string[]) {
  setStage('search');
  setVendors([]);
  quoteStore.reset(req, VENDOR_IDS.slice(0, urls.length));
  quoteStore.onGateOpen = showCompare;
  quoteStore.onDrained = onQuotesSettled;
  tries.clear();
  fallbacks.clear();
  triedNames.clear();
  say(`알려 주신 업체 ${urls.length}곳에서 바로 견적을 받아 올게요.`);
  urls.forEach((url, i) => claim(VENDOR_IDS[i], { name: new URL(url).host.replace(/^www\./, ''), url, reason: '사용자가 지정' }));
  timeline({ kind: 'vendors' });
  const gen = generation;
  await Promise.all(urls.map((_, i) => collect(VENDOR_IDS[i], gen)));
  maybeOpenGate();
}

/** 업체 확정 (다른 브라우저와 중복이면 거부 사유) */
function claim(slot: VendorId, v: PickedVendor): string | null {
  const key = hostKey(v.url);
  if (banned.has(key)) return '이미 시도했지만 웹에서 견적을 낼 수 없었던 업체입니다. 다른 업체를 고르세요.';
  const dup = listVendors().find((x) => x.id !== slot && hostKey(x.url) === key);
  if (dup) return `브라우저 ${dup.id}가 이미 고른 업체(${dup.name})입니다. 다른 업체를 고르세요.`;
  const info: VendorInfo = { id: slot, ...v };
  replaceVendor(info);
  quoteStore.renameVendor(slot, v.name);
  emit('vendors', { payload: listVendors() });
  if (VENDOR_IDS.every((id) => getVendor(id))) setStage('collect');
  return null;
}

async function hunt(slot: VendorId, gen = generation, countTry = true) {
  if (!requirements) return;
  const d = getDriver(slot);
  d.locked = false;
  if (countTry) tries.set(slot, (tries.get(slot) ?? 0) + 1);
  setVendorStatus(slot, 'browsing');
  await runCollector(
    slot,
    gen,
    {
      system: huntSystemPrompt(slot, requirements, triedNames.get(slot) ?? []),
      goal: '담당 경로로 웹에서 바로 견적을 낼 수 있는 업체 1곳을 찾아 claim_vendor로 확정한 뒤, 그 업체의 견적 정보를 report_quote로 보고해 줘.',
      tools: HUNT_TOOLS
    },
    'hunt'
  );
}

/** 이 브라우저의 업체 자리를 비운다 (다른 사이트를 다시 찾기 전) */
function dropVendor(slot: VendorId) {
  setVendors(listVendors().filter((v) => v.id !== slot));
  emit('vendors', { payload: listVendors() });
  quoteStore.resetOne(slot);
  clearOriginals(slot);
}

/** 남은 대안 중 가장 나은 것: 메일 주소를 아는 곳 → 메일 → 파일 */
function bestFallback(slot: VendorId): Fallback | undefined {
  const list = fallbacks.get(slot) ?? [];
  return list.find((f) => f.channel === 'mail' && f.email) ?? list.find((f) => f.channel === 'mail') ?? list[0];
}

/** 웹 견적이 끝내 안 될 때만: 메일 초안이나 견적서 업로드로 */
async function useFallback(slot: VendorId, fb: Fallback, exhausted: boolean) {
  if (!requirements) return;
  replaceVendor(fb.vendor);
  emit('vendors', { payload: listVendors() });
  quoteStore.renameVendor(slot, fb.vendor.name);
  const why = exhausted ? `웹에서 바로 견적을 낼 수 있는 곳을 ${MAX_TRIES}곳까지 찾아봤지만 없어서, ` : '';
  if (fb.channel === 'mail') {
    if (fb.email) setVendorEmail(slot, fb.email);
    quoteStore.setChannel(slot, 'mail');
    setVendorStatus(slot, 'needs_mail');
    say(`${why}${fb.vendor.name}에 메일로 견적을 요청할게요 (${clause(fb.reason)}). 초안을 확인하고 보내 주세요.${fb.email ? '' : ' 메일 주소를 찾지 못해 받는 사람을 직접 넣어 주세요.'}`);
    openDraft(requestDraft(slot, requirements));
  } else {
    quoteStore.setChannel(slot, 'file');
    setVendorStatus(slot, 'needs_file');
    say(`${why}${fb.vendor.name}의 견적서를 직접 받아야 해요 (${clause(fb.reason)}${fb.contact ? `, 연락: ${fb.contact}` : ''}). 받은 PDF·이미지를 올려 주시면 같은 양식으로 정리할게요.`);
    timeline({ kind: 'upload', vendorId: slot });
  }
}

/** 이미 정한 업체에서 견적만 다시 받기 */
async function collect(slot: VendorId, gen = generation) {
  const v = getVendor(slot);
  if (!requirements || !v) return;
  getDriver(slot).locked = false;
  setVendorStatus(slot, 'browsing');
  await runCollector(
    slot,
    gen,
    {
      system: collectSystemPrompt(v, requirements),
      goal: `${v.url} 에서 견적 정보를 찾아 보고해 줘.`,
      tools: COLLECT_TOOLS
    },
    'collect'
  );
}

async function runCollector(slot: VendorId, gen: number, task: { system: string; goal: string; tools: ToolName[] }, mode: 'hunt' | 'collect') {
  if (!requirements) return;
  const driver = getDriver(slot);
  await setHandoff(slot, undefined);
  try {
    const outcome = await runAgent(
      {
        slot,
        driver,
        onClaim: (v) => claim(slot, v),
        onReport: async (fields, meta, url) => {
          if (!getVendor(slot)) claim(slot, { name: new URL(url).hostname.replace(/^www\./, ''), url, reason: '견적 정보가 있는 페이지' });
          void captureWeb(slot, url);
          // 에이전트가 납기를 빠뜨렸으면 페이지 원문에서 추정
          if (!fields.leadTimeDays && !quoteStore.hasField(slot, 'leadTimeDays')) {
            const text = await driver.evaluate<string>('document.body ? document.body.innerText : ""').catch(() => '');
            fields = fillLeadTimeFromText(fields, text);
          }
          return applyFields(slot, fields, meta, 'web', url);
        },
        onAfter: () => void refreshState(slot),
        engine: () => engines.get(slot) ?? 'naver',
        missingOnDone: () => {
          if (!getVendor(slot) || !quoteStore.hasListedPrice(slot)) return [];
          const want: [FieldKey, string][] = [['shippingFee', '배송비'], ['leadTimeDays', '납기']];
          if (requirements?.needInstall) want.push(['installFee', '설치비']);
          return want.filter(([k]) => !quoteStore.hasField(slot, k)).map(([, label]) => label);
        }
      },
      { ...task, signal: { get aborted() { return gen !== generation; } } }
    );
    if (gen !== generation) return;
    const v = getVendor(slot);
    const hasPrice = v ? quoteStore.hasListedPrice(slot) : false;
    if (v && hasPrice) {
      setVendorStatus(slot, 'done');
    } else {
      // 웹 견적 실패: 대안으로 기록해 두고, 시도 횟수가 남았으면 다른 사이트부터
      const fb: Fallback | null =
        v && outcome.kind === 'switch'
          ? { vendor: v, channel: outcome.channel, email: outcome.contact?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0], contact: outcome.contact, reason: outcome.reason || '웹에 가격이 없음' }
          : null;
      if (fb) fallbacks.set(slot, [...(fallbacks.get(slot) ?? []), fb]);
      const reason = outcome.kind === 'switch' || outcome.kind === 'user' ? clause(outcome.reason) : '가격 정보를 찾지 못함';
      if (outcome.kind === 'user') {
        // 418·CAPTCHA·로그인 등 사람이 해야 하는 화면: 멈추고 넘긴다 (해결하면 계속, 건너뛰면 다음 업체)
        handoffMode.set(slot, { mode, url: outcome.url });
        setVendorStatus(slot, 'needs_user');
        await setHandoff(slot, reason);
        const where = v ? v.name : `브라우저 ${slot} (${outcome.url ? new URL(outcome.url).host : '검색 중'})`;
        say(`${where}: ${reason}. 화면에서 직접 해결한 뒤 "해결했어요, 계속"을 누르거나, "건너뛰기"를 눌러 다음 업체로 넘어가세요.`);
        void refreshState(slot);
        return;
      }
      const left = mode === 'hunt' && (tries.get(slot) ?? 0) < MAX_TRIES;
      if (left) {
        if (v) {
          banned.add(hostKey(v.url));
          triedNames.set(slot, [...(triedNames.get(slot) ?? []), `${v.name}(${reason})`]);
          if (fb) void captureWeb(slot, await driver.url(), true);
          say(`브라우저 ${slot}: ${v.name}는 웹에서 바로 견적을 낼 수 없어요 (${reason}). 다른 사이트를 찾아볼게요 (${(tries.get(slot) ?? 0) + 1}/${MAX_TRIES}).`);
          dropVendor(slot);
        }
        await setHandoff(slot, undefined);
        void hunt(slot, gen);
        return;
      }
      const best = mode === 'hunt' ? bestFallback(slot) : fb ?? undefined;
      if (best) {
        await useFallback(slot, best, mode === 'hunt');
      } else {
        setVendorStatus(slot, 'failed');
        notice(`브라우저 ${slot}: 웹·메일·파일 어느 쪽으로도 견적을 받을 업체를 찾지 못했습니다`, slot);
      }
    }
  } catch (e) {
    if (gen !== generation) return;
    setVendorStatus(slot, 'failed');
    notice(`브라우저 ${slot} 오류: ${errMsg(e)}`, slot);
  }
  void refreshState(slot);
  maybeOpenGate();
}

/** 견적 정보가 있던 화면을 원본으로 보관 */
async function captureWeb(slot: VendorId, url: string, force = false) {
  if (!url || (!force && captured.has(`${slot}|${url}`))) return;
  captured.add(`${slot}|${url}`);
  const driver = getDriver(slot);
  const buf = await driver.screenshot().catch(() => null);
  const original: QuoteOriginal = {
    id: randomUUID(),
    vendorId: slot,
    channel: 'web',
    title: (await driver.title().catch(() => '')) || url,
    url,
    image: buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : undefined,
    capturedAt: new Date().toISOString()
  };
  emit('original', { vendorId: slot, payload: original });
}

/** 사용자가 차단 화면을 해결함 → 같은 단계부터 이어서 */
export function resume(slot: Slot) {
  if (slot === 'search') return;
  const h = handoffMode.get(slot);
  handoffMode.delete(slot);
  say(`브라우저 ${slot}: 이어서 진행할게요.`);
  void setHandoff(slot, undefined).then(() => (getVendor(slot) ? collect(slot) : hunt(slot, generation, false)));
  void h;
}

/** 사용자가 건너뜀 → 이 업체(또는 막힌 검색 엔진)를 빼고 다음 업체로 */
export async function skip(slot: VendorId) {
  if (!requirements) return;
  const h = handoffMode.get(slot);
  handoffMode.delete(slot);
  await setHandoff(slot, undefined);
  const v = getVendor(slot);
  if (v) {
    banned.add(hostKey(v.url));
    triedNames.set(slot, [...(triedNames.get(slot) ?? []), `${v.name}(차단되어 건너뜀)`]);
  } else if (h?.url) {
    // 검색 단계에서 막혔으면 그 사이트를 빼고, 검색 엔진이 막혔다면 다음 엔진으로
    const host = new URL(h.url).host;
    banned.add(hostKey(h.url));
    if (/naver\.com|daum\.net|bing\.com/.test(host)) {
      const cur = engines.get(slot) ?? 'naver';
      engines.set(slot, ENGINE_ORDER[(ENGINE_ORDER.indexOf(cur) + 1) % ENGINE_ORDER.length]);
    }
    triedNames.set(slot, [...(triedNames.get(slot) ?? []), `${host}(차단되어 건너뜀)`]);
  }
  const canHunt = (h?.mode ?? 'collect') === 'hunt' && (tries.get(slot) ?? 0) < MAX_TRIES;
  if (canHunt) {
    say(`브라우저 ${slot}: 건너뛰고 다음 업체를 찾을게요 (${(tries.get(slot) ?? 0) + 1}/${MAX_TRIES}).`);
    if (v) dropVendor(slot);
    void hunt(slot);
    return;
  }
  const best = bestFallback(slot);
  if (best) {
    await useFallback(slot, best, true);
  } else {
    setVendorStatus(slot, 'failed');
    say(`브라우저 ${slot}: ${v ? v.name : '이 업체'}는 건너뛰었어요. 더 시도할 업체가 없으면 업체 URL을 붙여 넣어 주세요.`);
  }
  maybeOpenGate();
}

export function retry(slot: VendorId) {
  void (getVendor(slot) ? collect(slot) : hunt(slot));
}

/** 막힌 업체를 빼고 같은 브라우저로 새 업체를 찾는다 */
export function replace(slot: VendorId) {
  const old = getVendor(slot);
  if (!requirements) return;
  if (old) {
    banned.add(hostKey(old.url));
    say(`${old.name}는 빼고 브라우저 ${slot}로 다른 업체를 찾아볼게요.`);
  }
  dropVendor(slot);
  tries.set(slot, 0);
  void hunt(slot);
}

function applyFields(slot: VendorId, fields: ReportedFields, meta: QuoteMeta, channel: 'web' | 'mail' | 'file', ref: string, answered = false) {
  quoteStore.mergeMeta(slot, meta);
  return quoteStore.apply(slot, fields, { channel, ref }, answered);
}

/** 브라우저 3개가 모두 탐색·분석을 마쳤는지 */
const allSettled = () => VENDOR_IDS.every((id) => !['browsing', 'parsing'].includes(getVendorStatus(id)));

function maybeOpenGate() {
  if (!allSettled()) return;
  quoteStore.openGate();
  // 반영 대기 중인 값이 없으면 지금 바로 가격 이상치 확인·추천 (있으면 큐가 비었을 때 onQuotesSettled에서)
  if (!quoteStore.hasPending()) onQuotesSettled();
}

function showCompare() {
  setStage('compare');
  if (compareShown) return;
  compareShown = true;
  say('모은 견적을 하나의 양식으로 정리했어요. 숨은 비용이 더해지며 순위가 바뀌는 걸 보세요. 업체별 견적서는 카드의 "견적서 보기"로 열 수 있어요.');
  timeline({ kind: 'compare' });
}

// ─── 파일 채널 ────────────────────────────────────────────────

export async function onFileUpload(slot: VendorId, file: { name: string; mime: string; data: Uint8Array }) {
  if (!requirements) return;
  setVendorStatus(slot, 'parsing');
  emit('original', {
    vendorId: slot,
    payload: {
      id: randomUUID(),
      vendorId: slot,
      channel: 'file',
      title: file.name,
      fileName: file.name,
      mime: file.mime,
      fileData: `data:${file.mime || 'application/octet-stream'};base64,${Buffer.from(file.data).toString('base64')}`,
      text: file.mime.startsWith('text/') ? Buffer.from(file.data).toString('utf8').slice(0, 20000) : undefined,
      capturedAt: new Date().toISOString()
    } satisfies QuoteOriginal
  });
  try {
    const { fields, meta } = await parseQuoteFile({ vendorId: slot, requirements, ...file });
    const added = applyFields(slot, fields, meta, 'file', file.name);
    setVendorStatus(slot, 'done');
    say(`${vendorName(slot)} 견적서를 통일 양식으로 정리했어요: ${added.join(', ') || '금액 항목 없음'}`);
  } catch (e) {
    setVendorStatus(slot, 'needs_file');
    notice(`${vendorName(slot)} 견적서 분석 실패: ${errMsg(e)}`, slot);
  }
  maybeOpenGate();
}

// ─── 메일 채널 ────────────────────────────────────────────────

function afterSent(draft: MailDraft) {
  if (draft.kind === 'order') return;
  setVendorStatus(draft.vendorId, 'waiting_reply');
  if (draft.kind === 'question' && draft.fields) quoteStore.markAsked(draft.vendorId, draft.fields);
  // 조건 변경 뒤 늦게 온 이전 검색의 회신은 새 견적에 섞지 않는다
  const gen = generation;
  if (imapConfigured()) watchReply(draft.vendorId, draft.kind, subjectTag(draft), (r) => void (gen === generation && handleReply(draft.vendorId, draft.kind, r)));
  maybeOpenGate();
}

export async function onMailSend(draft: MailDraft) {
  if (!draft.to.trim()) return { ok: false, error: '받는 사람 메일 주소를 넣어 주세요.' };
  try {
    await sendMail({ ...drafts.get(draft.id), ...draft });
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
  drafts.delete(draft.id);
  afterSent(draft);
  return { ok: true, imap: imapConfigured() };
}

export async function onMailExternal(draft: MailDraft) {
  const tag = subjectTag(draft);
  const subject = draft.subject.includes(tag) ? draft.subject : `${draft.subject} ${tag}`;
  await shell.openExternal(`mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft.body)}`);
  recordMail({ id: `<${draft.id}@doldari.local>`, direction: 'out', vendorId: draft.vendorId, kind: draft.kind, to: draft.to, subject, body: draft.body, at: new Date().toISOString() });
  drafts.delete(draft.id);
  afterSent(draft);
  return { ok: true, imap: imapConfigured() };
}

export async function onPasteReply(slot: VendorId, kind: MailKind, text: string) {
  await handleReply(slot, kind, { vendorId: slot, tag: '', messageId: `pasted-${Date.now()}`, from: getVendor(slot)?.email ?? '', subject: '붙여넣은 회신', text, attachments: [] });
}

async function handleReply(slot: VendorId, kind: MailKind, r: IncomingReply) {
  if (!requirements) return;
  recordMail({ id: r.messageId, direction: 'in', vendorId: slot, kind, from: r.from, subject: r.subject, body: r.text, at: new Date().toISOString() });
  emit('original', {
    vendorId: slot,
    payload: { id: randomUUID(), vendorId: slot, channel: 'mail', title: r.subject, text: r.text, capturedAt: new Date().toISOString() } satisfies QuoteOriginal
  });
  setVendorStatus(slot, 'parsing');
  say(`${vendorName(slot)}에서 회신이 왔어요. 견적서 양식으로 정리할게요.`);
  try {
    const pdfs = r.attachments.filter((a) => a.contentType === 'application/pdf');
    const { fields, meta } = await extractQuote({
      vendorId: slot,
      requirements,
      hint: '메일 회신',
      ref: r.messageId,
      channel: 'mail',
      content: [
        ...pdfs.map((a) => ({ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.content.toString('base64') } })),
        { type: 'text', text: `제목: ${r.subject}\n\n${r.text}` }
      ]
    });
    const added = applyFields(slot, quoteStore.hasField(slot, 'leadTimeDays') ? fields : fillLeadTimeFromText(fields, r.text), meta, 'mail', r.messageId, kind !== 'request');
    setVendorStatus(slot, 'done');
    say(added.length ? `${vendorName(slot)} 회신에서 ${added.join(', ')}를 확인했어요.` : `${vendorName(slot)} 회신에서 새 견적 값을 찾지 못했어요.`);
  } catch (e) {
    setVendorStatus(slot, 'waiting_reply');
    notice(`${vendorName(slot)} 회신 분석 실패: ${errMsg(e)}`, slot);
  }
  maybeOpenGate();
}

// ─── 비교 → 추천 → 견적서 ─────────────────────────────────────

let announced = '';
let reportShown = false;
function onQuotesSettled() {
  if (!requirements) return;
  checkPriceOutliers();
  // 먼저 끝난 업체만으로 추천·통합 견적서를 띄우지 않고 세 곳(가격 재확인 포함)이 다 끝날 때까지 기다린다
  if (!allSettled()) return;
  const priced = listVendors().filter((v) => quoteStore.get(v.id)?.listedPrice.value !== null);
  if (priced.length === 0) return;
  if (!docsShown) {
    docsShown = true;
    timeline({ kind: 'docs' });
  }
  setStage('questions');
  // 비교가 바뀔 때마다 히스토리에 저장 (같은 견적 건은 같은 파일을 덮어씀)
  saveRecord(requirements, listVendors(), quoteStore.quotes);
  const rec = recommend(quoteStore.quotes, requirements);
  const key = `${rec.vendorId}:${rec.tentative}:${rec.reasons.join('|')}`;
  if (key === announced) return;
  announced = key;
  const missing = priced.filter((v) => missingKeys(quoteStore.get(v.id)!, requirements!).length > 0).length;
  say(`${rec.vendorId ? `추천: ${vendorName(rec.vendorId)}${rec.tentative ? ' (확인 필요)' : ''}` : '조건을 모두 만족하는 업체가 없어요.'}\n${rec.reasons.map((r) => `· ${r}`).join('\n')}${missing ? `\n견적서에 빠진 항목이 있는 업체가 ${missing}곳 있어요. 확인 질문 메일로 채울 수 있어요.` : ''}`);
  // 통합 견적서 카드는 내용이 실시간으로 바뀌므로 한 번만 띄운다
  if (reportShown) return;
  reportShown = true;
  timeline({ kind: 'report' });
}

// ─── 가격 이상치: 기준 수량을 잘못 읽었는지 다시 확인 ──────────

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function checkPriceOutliers() {
  if (!requirements) return;
  // 아직 탐색 중인 브라우저가 있으면 비교 대상이 덜 모였으니 기다린다 (모두 끝나면 다시 불린다)
  if (VENDOR_IDS.some((id) => ['browsing', 'parsing'].includes(getVendorStatus(id)))) return;
  const rows = listVendors()
    .map((v) => ({ v, q: quoteStore.get(v.id) }))
    .map((r) => ({ ...r, amount: r.q ? productAmount(r.q, requirements) : null }))
    .filter((r): r is typeof r & { amount: number } => r.amount !== null && r.amount > 0);
  if (rows.length < 2) return;
  // 3곳 이상이면 전체 중앙값에서 튀는 곳만, 2곳뿐이면 어느 쪽이 틀렸는지 모르니 둘 다 확인
  const all = rows.map((r) => r.amount);
  const m = median(all);
  const spread = Math.max(...all) / Math.min(...all);
  for (const r of rows) {
    const others = rows.filter((o) => o.v.id !== r.v.id);
    const ratio = rows.length >= 3 ? Math.max(r.amount / m, m / r.amount) : spread;
    if (ratio < OUTLIER_RATIO) continue;
    const key = `${r.v.id}:${r.q.listedPrice.value}:${priceQty(r.q)}`;
    if (verified.has(key) || ['browsing', 'parsing'].includes(getVendorStatus(r.v.id))) continue;
    verified.add(key);
    const othersText = others.map((o) => `${o.v.name} ${o.amount.toLocaleString('ko-KR')}원`);
    if (r.q.channel !== 'web') {
      say(`${r.v.name} 금액(${r.amount.toLocaleString('ko-KR')}원)이 다른 업체와 약 ${ratio.toFixed(1)}배 차이 나요. 견적서의 수량 기준(1개·묶음·시트)을 한 번 확인해 주세요.`);
      continue;
    }
    void verifyPrice(r.v.id, { listed: r.q.listedPrice.value!, priceQty: priceQty(r.q), amount: r.amount, snippet: r.q.listedPrice.source?.snippet, others: othersText, ratio });
  }
}

async function verifyPrice(slot: VendorId, info: Parameters<typeof verifyPriceSystemPrompt>[2], gen = generation) {
  const v = getVendor(slot);
  if (!requirements || !v) return;
  const url = quoteStore.get(slot)?.listedPrice.source?.ref || v.url;
  say(`${v.name} 금액이 다른 업체와 약 ${info.ratio.toFixed(1)}배 차이 나요. 수량 기준을 잘못 읽었을 수 있어 다시 확인할게요.`);
  const driver = getDriver(slot);
  driver.locked = false;
  setVendorStatus(slot, 'browsing');
  const before = { listed: info.listed, pq: info.priceQty };
  let note = '';
  try {
    await runAgent(
      {
        slot,
        driver,
        onReport: (fields, meta, u) => {
          note = meta.notes?.find((n) => n.includes('재확인')) ?? note;
          return applyFields(slot, fields, meta, 'web', u);
        },
        onAfter: () => void refreshState(slot)
      },
      {
        system: verifyPriceSystemPrompt(v, requirements, info),
        goal: `${url} 에서 이 가격이 몇 개(매) 기준인지 다시 확인해 줘.`,
        tools: ['navigate', 'read_text', 'find_in_page', 'snapshot', 'click', 'select_option', 'expand_all', 'report_quote'],
        maxSteps: 12,
        signal: { get aborted() { return gen !== generation; } }
      }
    );
  } catch (e) {
    notice(`${v.name} 가격 재확인 실패: ${errMsg(e)}`, slot);
  }
  if (gen !== generation) return;
  setVendorStatus(slot, 'done');
  // 큐가 반영된 뒤 값 비교
  setTimeout(() => {
    const q = quoteStore.get(slot);
    if (!q || !requirements) return;
    const changed = q.listedPrice.value !== before.listed || priceQty(q) !== before.pq;
    const amt = productAmount(q, requirements);
    say(
      changed
        ? `${v.name} 가격을 바로잡았어요: ${amt?.toLocaleString('ko-KR')}원 (${priceQty(q)}개 기준 ${q.listedPrice.value?.toLocaleString('ko-KR')}원).${note ? ` ${note}` : ''}`
        : `${v.name} 가격을 다시 확인했어요. 수량 기준은 맞고 실제로 차이가 나요.${note ? ` ${note}` : ''}`
    );
  }, 2500);
  maybeOpenGate();
}

export async function onSavePdf(win: BrowserWindow, html: string, fileName: string) {
  return savePdf(win, html, fileName);
}

// ─── 작성: 주문 문의(폼 handoff 또는 메일) / 확인 질문 ─

export async function onDraftOrder(slot: VendorId) {
  const v = getVendor(slot);
  if (!requirements || !v) return;
  setStage('draft');
  if (quoteStore.get(slot)?.channel !== 'web') {
    openDraft(orderDraft(slot, quoteStore.quotes, requirements));
    return;
  }
  say(`${v.name} 사이트에서 문의 폼을 찾아 채워 볼게요. 제출 직전에서 멈춥니다.`);
  timeline({ kind: 'browser', slot, title: `${v.name} · 문의 폼 작성` });
  const driver = getDriver(slot);
  driver.locked = false;
  await setHandoff(slot, undefined);
  setVendorStatus(slot, 'browsing');
  try {
    const outcome = await runAgent(
      { slot, driver, onAfter: () => void refreshState(slot) },
      {
        system: formSystemPrompt(v, requirements, formMessage(slot, requirements)),
        goal: `${v.url} 에서 견적·주문 문의 폼을 찾아 채우고 제출 직전에 handoff 해 줘.`,
        tools: ['navigate', 'read_text', 'snapshot', 'click', 'fill', 'handoff', 'request_user'],
        maxSteps: 16
      }
    );
    setVendorStatus(slot, 'done');
    if (outcome.kind === 'handoff') {
      await setHandoff(slot, 'AI가 여기까지 작성했습니다. 이름·연락처를 확인하고 직접 제출하세요.');
      say('폼을 채워 두었어요. 화면에서 내용을 확인하고 최종 제출은 직접 해 주세요.');
      return;
    }
    say(`${v.name} 사이트에서 문의 폼을 쓸 수 없어요${outcome.kind === 'user' ? ` (${clause(outcome.reason)})` : ''}. 대신 주문 문의 메일을 써 두었어요.`);
  } catch (e) {
    setVendorStatus(slot, 'done');
    notice(`폼 작성 실패: ${errMsg(e)}`, slot);
  }
  openDraft(orderDraft(slot, quoteStore.quotes, requirements));
}

export function onDraftQuestion(slot: VendorId) {
  if (!requirements) return;
  const draft = questionDraft(slot, quoteStore.quotes, requirements);
  if (!draft) {
    say(`${vendorName(slot)}에 확인할 항목이 없어요.`);
    return;
  }
  openDraft(draft);
}

function openDraft(draft: MailDraft) {
  drafts.set(draft.id, draft);
  timeline({ kind: 'mail', draft });
}

// ─── 새 견적 ──────────────────────────────────────────────────

/** 진행 중인 검색을 멈추고 업체·견적 상태를 비운다 (대화·요구 조건은 호출한 쪽이 정함) */
async function clearRun() {
  generation++;
  docsShown = false;
  compareShown = false;
  announced = '';
  reportShown = false;
  drafts.clear();
  banned.clear();
  captured.clear();
  verified.clear();
  tries.clear();
  fallbacks.clear();
  triedNames.clear();
  engines.clear();
  handoffMode.clear();
  setVendors([]);
  resetStatuses();
  quoteStore.reset(null);
  setStage('interview', true);
  await resetAll();
}

export async function reset() {
  // 새 견적 = 새 히스토리 기록. 조건 바꾸기는 같은 대화라 같은 기록에 이어서 쌓는다
  startRecord();
  interview = null;
  requirements = null;
  givenUrls = [];
  await clearRun();
}

// ─── 조건 변경: 요구 조건 단계로 돌아가 다시 검색 ───────────────

/** fromChat: 채팅으로 이미 새 조건을 받아 둔 경우 (이전 조건으로 덮어쓰지 않고 안내는 호출한 쪽이 함) */
export async function revise(fromChat = false) {
  if (!interview || !requirements || !['compare', 'questions', 'draft'].includes(getStage())) return;
  const req = requirements;
  const rank = rankQuotes(quoteStore.quotes, req).filter((id) => quoteStore.get(id)?.listedPrice.value !== null);
  const rec = recommend(quoteStore.quotes, req);
  const summary: RunSummary = {
    requirements: req,
    rows: listVendors().map((v) => {
      const q = quoteStore.get(v.id);
      return {
        id: v.id,
        name: v.name,
        url: v.url,
        channel: q?.channel ?? 'web',
        total: q && q.listedPrice.value !== null ? confirmedSum(q, req) : null,
        rank: rank.includes(v.id) ? rank.indexOf(v.id) + 1 : null
      };
    }),
    recommended: rec.vendorId,
    reasons: rec.reasons,
    at: new Date().toISOString()
  };
  await clearRun();
  requirements = null;
  if (!fromChat) {
    // 기본값으로 채운 항목까지 카드에 보이도록 확정했던 조건을 그대로 넣어 둔다
    interview.apply(req);
    interview.reopen();
  }
  emit('revised', { payload: summary });
  timeline({ kind: 'requirements' });
  emit('requirements', { payload: interview.req });
  emit('requirements_ready', { payload: true });
  if (!fromChat) say('이전 검색 결과는 위에 그대로 남겨 두었어요. 카드에서 조건을 고치거나 바꿀 내용을 말해 주세요. 준비되면 "이대로 검색 시작"을 눌러 주세요.');
}
