// 전체 흐름 (대화 하나로 이어짐):
// 요구 조건 → 브라우저 3개가 동시에 각자 업체를 찾아 견적 수집(가격 없으면 메일/파일) → 업체별 통일 견적서 → 비교·추천 → 작성 → 통합 견적서
import { randomUUID } from 'node:crypto';
import { shell, type BrowserWindow } from 'electron';
import type { FieldKey, MailDraft, MailKind, MailRecord, MessageDraft, Quote, QuoteMeta, QuoteOriginal, ReportedFields, Requirements, RunSummary, Slot, VendorId, VendorInfo } from '@shared/types';
import { VENDOR_IDS } from '@shared/types';
import { josa } from '@shared/josa';
import { ITEM_MAX, requirementIssue, valueIssue } from '@shared/limits';
import { isDemoAddress } from '@shared/mail';
import { confirmedSum, INFO_PAGE, missingKeys, needsWarrantyExtension, orderUrl, productAmount, priceQty, rankQuotes, recommend, won } from '@shared/quote';
import { demoMailTo, hasApiKey, imapConfigured, mailUser, sleep } from './config';
import {
  emit, getStage, getVendorStatus, notice, onEmit, resetStatuses, say, setBusy, setStage, setVendorStatus, timeline
} from './events';
import { addOriginal, clearOriginals, resumeRecord, saveRecord, startRecord } from './history';
import { Interview } from './interview';
import { quoteStore } from './quote/store';
import { getDriver, refreshState, resetAll, setHandoff } from './browser';
import { ENGINE_ORDER, detectBlock, type Engine } from './browser/page';
import { photoFromPage, productPhoto } from './browser/photo';
import type { PdfFile } from './browser/pdf';
import { runAgent } from './agent/loop';
import { apiErrorNotice } from './agent/claude';
import { sizeScanStarted, startSizeScan, stopSizeScan } from './sizes';
import { boardFor, noteVerdict, noteVisit, resetShared, siteKey } from './agent/shared';
import { collectSystemPrompt, formSystemPrompt, huntSystemPrompt, verifyPriceSystemPrompt } from './agent/prompts';
import type { PickedVendor, ToolName } from './agent/tools';
import { formMessage, messageDraft, orderDraft, parseContact, questionDraft, requestDraft } from './drafts';
import { recordMail, sendMail, subjectTag } from './channels/mail-send';
import { appendToInbox, cancelAllWatches, cancelWatch, watchReply, type IncomingReply } from './channels/mail-poll';
import { demoReply, demoReplyMessage } from './channels/demo-mail';
import { extractQuote } from './channels/extract';
import { fillLeadTimeFromText } from './quote/normalize';
import { MAX_QUOTE_FILE_BYTES, parseQuoteFile, quoteFileBlock } from './channels/file-parse';
import { getVendor, listVendors, replaceVendor, setVendorEmail, setVendors, vendorName } from './vendors';
import { savePdf } from './report';

// 웹 캡처·메일·파일 원본을 히스토리에도 보관
onEmit((ev) => {
  if (ev.type === 'original' && ev.vendorId) addOriginal(ev.vendorId, ev.payload as QuoteOriginal);
});

let interview: Interview | null = null;
let requirements: Requirements | null = null;
let compareShown = false;
let generation = 0;
const drafts = new Map<string, MailDraft>();
/** 브라우저(업체)마다 문자·카톡 문의 초안 (전화번호는 여기서만 꺼내 쓴다) */
const messages = new Map<VendorId, MessageDraft>();
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
/** 이번 검색에 쓰는 브라우저 (지정 업체·URL 수만큼만 띄운다) */
let activeSlots: VendorId[] = [...VENDOR_IDS];
/** 사용자가 이름으로 지정한 업체를 맡은 브라우저 → 업체 이름 */
const targets = new Map<VendorId, string>();
/** 사용자에게 넘긴 브라우저가 어떤 단계였는지 (계속/건너뛰기용) */
const handoffMode = new Map<VendorId, { mode: 'hunt' | 'collect'; url?: string }>();
const captured = new Set<string>();
/** 가격 이상치 재확인을 이미 한 업체 (값이 바뀌면 다시 할 수 있게 값까지 키로) */
const verified = new Set<string>();
/** 다른 업체 금액과 이만큼(배) 이상 차이 나면 기준 수량을 다시 확인한다 */
const OUTLIER_RATIO = 3;

// Claude API 오류(키·한도·크레딧·과부하 등)는 짧은 한국어 안내로
const errMsg = (e: unknown) => apiErrorNotice(e) ?? (e instanceof Error ? e.message : String(e));
const clause = (s: string) => s.trim().replace(/[.。!]+$/, '');
/** 같은 업체 판단 키: 오픈마켓은 판매자(경로)까지, 그 밖에는 기본 도메인 (dev.·shop.·m. 하위 도메인도 같은 업체) */
const hostKey = siteKey;

const HUNT_TOOLS: ToolName[] = ['search_web', 'navigate', 'read_text', 'find_in_page', 'snapshot', 'click', 'select_option', 'expand_all', 'download_quote_pdf', 'save_page_pdf', 'claim_vendor', 'report_quote', 'switch_channel', 'request_user'];
const COLLECT_TOOLS: ToolName[] = ['navigate', 'read_text', 'find_in_page', 'snapshot', 'click', 'select_option', 'expand_all', 'download_quote_pdf', 'save_page_pdf', 'report_quote', 'switch_channel', 'request_user'];

// ─── 대화 입력 ────────────────────────────────────────────────

/** 처리 중인 대화 수: 먼저 끝난 처리가 다른 처리 중에 busy를 끄지 않게 */
let chatting = 0;

export async function onChat(text: string) {
  if (!hasApiKey()) {
    say('먼저 오른쪽 위 ⚙️ 설정에서 Anthropic API 키를 넣어 주세요.');
    emit('notice', { message: 'API 키가 필요합니다', payload: { openSettings: true } });
    return;
  }
  chatting++;
  try {
    setBusy(true);
    // "멈춰" 같은 말은 어느 단계에서든 진행 중인 탐색을 멈춘다 (조건 변경으로 해석하지 않게 먼저 본다)
    if (STOP_WORDS.test(text.trim())) {
      await stop();
      return;
    }
    // 멈춘 뒤 "다시 시작"·"계속해" 같은 말은 멈춘 브라우저를 이어서 진행
    if (getStage() !== 'interview' && START_WORDS.test(text.trim()) && resumeStopped()) return;
    if (getStage() === 'interview') {
      if (!interview) {
        interview = new Interview();
        timeline({ kind: 'requirements' });
      }
      givenUrls = [...new Set([...givenUrls, ...(text.match(/https?:\/\/[^\s)]+/g) ?? [])])].slice(0, 3);
      // "웹에서 찾아줘"처럼 업체를 새로 찾아 달라고 하면, 앞서 붙여 넣은 업체 주소만 보지 않게 비운다
      if (!/https?:\/\//.test(text) && SEARCH_AGAIN.test(text)) givenUrls = [];
      // "시작" 같은 말은 카드의 시작 버튼과 같게 처리한다 (인터뷰로 넘기면 같은 안내만 반복됨)
      if (START_WORDS.test(text.trim()) && interview.req.item) {
        await startSearch({});
        return;
      }
      const { question, ready, wantsSizeHelp, defaulted } = await interview.next(text);
      emit('requirements', { payload: interview.req });
      emit('requirements_ready', { payload: { ready, asking: Boolean(question) } });
      if (question) {
        // "지금 바로 시작할 수 있다"는 안내는 오른쪽 요구 조건 패널에만 둔다 (질문마다 붙이면 대화가 길어짐)
        say(question);
        // 사용자가 사이즈를 모르거나 추천을 원할 때만 브라우저 1개가 업체 사이트를 돌며 파는 사이즈를 모아 실제 크기로 보여 준다
        const item = interview.req.item;
        if (wantsSizeHelp && item && !sizeScanStarted() && hasApiKey()) {
          void startSizeScan(item, (options) => {
            if (getStage() !== 'interview') return;
            say(options.length ? `업체 사이트에서 파는 "${item}" 사이즈 ${options.length}종을 모았어요. 카드에서 실제 크기로 비교하고 눌러서 골라 주세요.` : '사이즈 선택지를 찾지 못했어요. 원하는 크기를 직접 말씀해 주세요.');
          });
        }
        return;
      }
      // 기본값으로 채운 항목은 숨기지 않고 알린다 (카드에도 그 값이 보인다)
      const filled = defaulted?.length ? ` ${defaulted.join('·')}은(는) 말씀이 없어서 기본값으로 넣어 뒀어요.` : '';
      say(ready ? `요구 조건을 정리했어요.${filled} 오른쪽에서 내용을 확인하고 고칠 게 있으면 고친 뒤 "이 조건으로 찾기 시작"을 눌러 주세요.` : '어떤 품목의 견적이 필요한지 알려 주세요.');
      return;
    }
    // 사용자가 업체 URL을 주면 비어 있거나 막힌 자리에 넣는다
    const urls = text.match(/https?:\/\/[^\s)]+/g);
    // 검색이 끝난 뒤 "웹에서 견적 나오는 곳으로 찾아줘"·"다른 곳 찾아줘" 같은 말은 조건 변경이 아니라 업체를 새로 찾아 달라는 요청:
    // 조건은 그대로 두고, 앞서 준 업체 주소 대신 웹에서 다시 찾는다 (그 말은 업체 찾기 메모로 넘긴다)
    if (!urls && requirements && interview && SEARCH_AGAIN.test(text)) {
      const req = requirements;
      await revise(true);
      givenUrls = [];
      // 앞서 준 업체(주소·이름)로만 받던 제한도 푼다: 브라우저 3개가 웹에서 새로 찾는다
      interview.apply({ ...req, vendors: [], onlyVendors: false, notes: [req.notes, `업체 찾기 요청: ${text.trim().slice(0, 100)}`].filter(Boolean).join(' / ') });
      say('조건은 그대로 두고, 웹에서 견적이 나오는 업체를 새로 찾아볼게요. 이전 결과는 위에 남겨 두었어요.');
      // 이전 검색의 늦게 온 이벤트가 단계를 비교로 되돌려 놓을 수 있어 요구 조건 단계로 맞춘 뒤 시작한다
      setStage('interview', true);
      await startSearch({});
      return;
    }
    if (urls && requirements) {
      for (const url of uniqueSites(urls).slice(0, 3)) {
        const slot = VENDOR_IDS.find((id) => !getVendor(id) || ['failed', 'needs_user'].includes(getVendorStatus(id)));
        if (!slot) break;
        // 같은 사이트를 이미 다른 브라우저가 보고 있거나 이미 빼 둔 사이트면 자리를 열지 않는다 (열면 그 브라우저가 멈춘 채 남음)
        const conflict = claimConflict(slot, url);
        if (conflict) {
          say(`${url}: ${conflict.replace(' 다른 업체를 고르세요.', '')}`);
          continue;
        }
        // 쓰지 않던 브라우저면 자리를 열고 카드도 하나 띄운다
        const name = await siteName(url);
        if (!activeSlots.includes(slot)) {
          activeSlots = [...activeSlots, slot];
          quoteStore.ensure(slot);
          timeline({ kind: 'browser', slot, title: name || hostLabel(url) });
        }
        if (claim(slot, { name, url, reason: '사용자가 지정' })) continue;
        void collect(slot);
      }
      return;
    }
    // 검색 중이든 비교 이후든 채팅으로 조건을 바꾸면 조건 변경 흐름으로 (바뀐 게 없으면 안내만)
    if (interview && requirements) {
      interview.apply(requirements);
      interview.reopen();
      // 메모(notes)는 일반 질문에도 채워질 수 있어 조건 변경 판단에서 뺀다
      const snapshot = () => JSON.stringify({ ...interview!.result(), notes: undefined });
      const before = snapshot();
      const { question } = await interview.next(text);
      if (snapshot() !== before) {
        const wasSearching = ['search', 'collect'].includes(getStage());
        await revise(true);
        if (question) emit('requirements_ready', { payload: { ready: true, asking: true } });
        if (wasSearching) say('진행 중이던 검색은 멈췄어요. 지금까지 모은 결과는 위에 그대로 남겨 두었어요.');
        say(question ? `조건을 바꿨어요. ${question}` : '바뀐 조건을 반영했어요. 오른쪽에서 확인하고 "이 조건으로 찾기 시작"을 눌러 주세요.');
        return;
      }
    }
    say('진행 중인 카드의 버튼으로 이어서 할 수 있어요. 업체 사이트 URL을 붙여 넣으면 그 업체도 견적에 넣을게요. 처음부터 하려면 위의 "새 견적"을 눌러 주세요.');
  } catch (e) {
    notice(`처리 실패: ${errMsg(e)}`);
  } finally {
    chatting = Math.max(0, chatting - 1);
    if (chatting === 0) setBusy(false);
  }
}

// ─── 요구 조건 확인 → 검색 시작 ──────────────────────────────

/** 채팅으로 검색을 시작(멈춘 뒤면 이어서)하라는 짧은 말 ("시작", "검색해줘", "이대로 해줘", "다시 시작", "계속해" 등).
 *  "네·응·좋아"는 인터뷰 질문에 대한 대답일 수 있어 넣지 않고, 조건이 섞인 말("아이폰 케이스 찾아줘")은 맞지 않게 전체 일치로 본다 */
const START_WORDS = new RegExp(
  String.raw`^(?:(?:지금\s*)?(?:바로\s*)?(?:다시\s*)?(?:계속\s*|이어서\s*)?(?:이\s*조건으로\s*|이대로\s*|그대로\s*)?(?:검색|찾기)?\s*(?:시작|검색|찾아|진행|계속|이어서|재개)(?:\s*(?:해\s*주세요|해\s*줘|해|하자|할게|합시다|줘|봐\s*줘|봐))?|(?:이대로|그대로)\s*(?:해\s*주세요|해\s*줘|해|가자|가|ㄱ+)?|ㄱㄱ+|고고|go|start)\s*[.!~ㅎ]*$`,
  'i'
);

/** 업체를 (다시) 찾아 달라는 말: "웹에서 찾아줘", "다른 곳 찾아봐", "견적 나오는 곳으로 검색해줘" 등.
 *  수량·예산 같은 조건이 섞인 말은 조건 변경으로 보도록, 숫자가 들어 있으면 맞지 않는다 */
const SEARCH_AGAIN = /^(?!.*\d)(?=.*(찾아|검색|알아봐|뒤져|서치))(?=.*(웹|사이트|인터넷|온라인|다른\s*(곳|업체|데)|새로|더|견적\s*(이\s*)?(나오|내주|계산|되)|업체)).{2,80}$/;

/** 채팅으로 진행 중인 탐색을 멈추라는 짧은 말 ("멈춰", "그만", "검색 중지", "잠깐" 등). 다른 뜻이 섞인 말은 전체 일치가 아니라 맞지 않는다 */
const STOP_WORDS = new RegExp(
  String.raw`^(?:(?:잠깐\s*|일단\s*|다\s*|전부\s*|검색\s*|탐색\s*|작업\s*)*(?:멈춰|멈춰\s*줘|멈춰\s*주세요|멈춰라|멈추자|멈춰봐|멈춤|그만|그만해|그만해\s*줘|그만해\s*주세요|그만하자|중지|중지해|중지해\s*줘|중단|중단해|중단해\s*줘|정지|정지해|스톱|스탑|stop)|잠깐(?:만)?)\s*[.!~ㅠㅜ]*$`,
  'i'
);

const posInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

/** 사용자가 카드에서 확인(필요하면 수정)하고 시작을 누름 */
/** 요구 조건 패널에서 품목을 바꿨을 때: 새 품목에 맞게 세부 조건을 다시 정해 패널에 보낸다 */
export async function onItemChange(item: unknown) {
  if (!interview || getStage() !== 'interview' || typeof item !== 'string') return;
  const next = item.trim().slice(0, ITEM_MAX);
  if (!next || next === interview.req.item) return;
  if (item.trim().length > ITEM_MAX) say(ITEM_CUT);
  try {
    await interview.changeItem(next);
  } catch (e) {
    // 세부 조건을 못 정해도 품목은 바꿔 둔다
    interview.apply({ item: next, specs: [] });
    notice(`품목에 맞는 조건을 정하지 못했어요: ${errMsg(e)}`);
  }
  emit('requirements', { payload: interview.req });
}

const ITEM_CUT = `품목이 ${ITEM_MAX}자를 넘어서 앞 ${ITEM_MAX}자만 품목으로 썼어요. 자세한 조건은 채팅으로 알려 주세요.`;

/** 시작 버튼을 연달아 눌러도 검색이 한 번만 시작되게 (정리를 기다리는 동안에도 단계는 아직 interview) */
let starting = false;

/** renderer가 보낸 요구 조건 값을 검증해서 받는다 (범위를 벗어난 수량·예산은 버림) */
function cleanPatch(patch: Partial<Requirements>, int: Interview): Partial<Requirements> {
  const clean: Partial<Requirements> = {};
  if (!patch || typeof patch !== 'object') return clean;
  if (typeof patch.item === 'string' && patch.item.trim()) clean.item = patch.item.trim().slice(0, ITEM_MAX);
  if (posInt(patch.quantity) && !valueIssue('quantity', patch.quantity!)) clean.quantity = patch.quantity;
  if (posInt(patch.budgetMax) && !valueIssue('budgetMax', patch.budgetMax!)) clean.budgetMax = patch.budgetMax;
  // 지난 날짜도 받아 두고 시작할 때 막는다 (패널에 보이는 값과 main 값이 어긋나지 않게)
  if (typeof patch.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.deadline)) clean.deadline = patch.deadline;
  if (typeof patch.needInstall === 'boolean') clean.needInstall = patch.needInstall;
  if (typeof patch.minWarrantyMonths === 'number' && Number.isInteger(patch.minWarrantyMonths) && patch.minWarrantyMonths >= 0) clean.minWarrantyMonths = patch.minWarrantyMonths;
  if (typeof patch.region === 'string') clean.region = patch.region.trim().slice(0, 100) || undefined;
  // 품목별 세부 조건: 이름은 인터뷰가 정한 것만, 값만 사용자가 고친다
  if (Array.isArray(patch.specs) && int.req.specs) {
    const edited = new Map(patch.specs.filter((x) => x && typeof x.label === 'string').map((x) => [x.label, typeof x.value === 'string' ? x.value.trim().slice(0, 100) || null : null]));
    clean.specs = int.req.specs.map((sp) => (edited.has(sp.label) ? { ...sp, value: edited.get(sp.label) ?? null } : sp));
  }
  return clean;
}

/** 요구 조건 패널에서 값을 고칠 때마다: 채팅으로 "시작"해도, 다음 질문을 받아도 고친 값이 쓰이게 main에 바로 반영한다.
 *  품목은 다 쓴 뒤 onItemChange가 세부 조건까지 다시 정하므로 여기서는 받지 않는다 */
export function editRequirements(patch: Partial<Requirements>) {
  if (!interview || getStage() !== 'interview' || starting) return;
  const { item: _item, ...rest } = cleanPatch(patch, interview);
  interview.apply(rest);
}

export async function startSearch(patch: Partial<Requirements>) {
  if (!interview || getStage() !== 'interview' || starting) return;
  const clean = cleanPatch(patch, interview);
  // 패널에서 고친 긴 품목을 바로 시작하면 여기서 잘린다 (품목 칸을 벗어날 때 이미 알렸으면 다시 말하지 않음)
  if (clean.item && clean.item !== interview.req.item && typeof patch?.item === 'string' && patch.item.trim().length > ITEM_MAX) say(ITEM_CUT);
  interview.apply(clean);
  if (!interview.req.item) {
    say('어떤 품목의 견적이 필요한지 먼저 알려 주세요.');
    return;
  }
  // 수량·예산이 말이 안 되거나 납기가 이미 지났으면 시작하지 않고 고칠 곳을 알린다
  const issue = requirementIssue(interview.result());
  if (issue) {
    say(`${issue} 오른쪽 요구 조건에서 고친 뒤 다시 시작해 주세요.`);
    return;
  }
  requirements = interview.result();
  // 사이즈 조사 중이면 멈추고 그 브라우저도 검색에 쓴다
  stopSizeScan();
  emit('requirements', { payload: requirements });
  emit('requirements_ready', { payload: { ready: false, asking: false } });
  // 조건 변경 직후라면 이전 검색의 브라우저 정리를 기다리되, 정리가 실패하거나 오래 걸려도 시작은 막지 않는다
  starting = true;
  try {
    await Promise.race([resetting, sleep(3000)]);
  } finally {
    starting = false;
  }
  // 기다리는 사이 새 견적을 눌렀으면 시작하지 않는다
  if (!requirements || getStage() !== 'interview') return;
  // 시작하자마자 히스토리에 넣어 둔다 (견적이 오기 전에 새 견적으로 취소해도 남게). 비교가 끝나면 같은 기록을 덮어쓴다
  saveRecord(requirements, [], {}, { incomplete: true });
  if (givenUrls.length) {
    void startWithUrls(requirements, givenUrls);
    return;
  }
  // 이름으로 지정한 업체는 앞 브라우저부터 맡긴다. "거기서만"이면 그 수만큼만 띄운다
  const named = (requirements.vendors ?? []).slice(0, VENDOR_IDS.length);
  const slots = requirements.onlyVendors && named.length ? VENDOR_IDS.slice(0, named.length) : [...VENDOR_IDS];
  void startHunt(requirements, slots, named);
}

// ─── 브라우저 3개가 동시에: 업체 찾기 → 견적 받기 ──────────────

async function startHunt(req: Requirements, slots: VendorId[] = [...VENDOR_IDS], named: string[] = []) {
  setStage('search');
  setVendors([]);
  emit('vendors', { payload: [] });
  activeSlots = slots;
  targets.clear();
  resetShared();
  named.forEach((name, i) => targets.set(slots[i], name));
  quoteStore.reset(req, slots);
  quoteStore.onGateOpen = showCompare;
  quoteStore.onDrained = onQuotesSettled;
  const free = slots.filter((id) => !targets.has(id));
  if (!free.length) say(`좋아요. ${named.join(', ')}에서 "${req.item}" 견적을 받아 올게요. ${slots.length === 1 ? '브라우저 1개로' : `브라우저 ${slots.length}개가 한 곳씩`} 진행해요.`);
  else if (named.length) say(`좋아요. ${named.join(', ')}은(는) 바로 찾아가고, 나머지 브라우저 ${free.length}개는 비교할 다른 업체를 찾아 "${req.item}" 견적을 받아 올게요.`);
  else say(`좋아요. 브라우저 3개가 동시에 "${req.item}" 업체를 찾아 견적을 받아 올게요.\nA는 전문 업체·공식몰, B는 견적을 계산해 견적서를 내주는 사이트, C는 시공·설치 업체 쪽을 맡아요.`);
  timeline({ kind: 'vendors', slots });
  tries.clear();
  fallbacks.clear();
  triedNames.clear();
  const gen = generation;
  await Promise.all(slots.map((id) => hunt(id, gen)));
  // 조건 변경·새 견적으로 멈춘 검색이면 비교를 다시 열지 않는다
  if (gen === generation) maybeOpenGate();
}

/** 사용자가 준 업체 URL로 바로 견적 받기 (검색 생략) */
async function startWithUrls(req: Requirements, given: string[]) {
  // 같은 사이트 주소가 여러 개면 하나만 쓴다 (둘째 브라우저가 업체를 못 잡고 "업체 찾는 중"으로 멈춰 있지 않게)
  const urls = uniqueSites(given);
  setStage('search');
  setVendors([]);
  activeSlots = VENDOR_IDS.slice(0, urls.length);
  targets.clear();
  resetShared();
  quoteStore.reset(req, activeSlots);
  quoteStore.onGateOpen = showCompare;
  quoteStore.onDrained = onQuotesSettled;
  tries.clear();
  fallbacks.clear();
  triedNames.clear();
  const dup = given.length - urls.length;
  say(`알려 주신 업체 ${urls.length}곳에서 바로 견적을 받아 올게요.${dup ? ` 같은 사이트 주소 ${dup}개는 한 번만 볼게요.` : ''}`);
  const names = await Promise.all(urls.map(siteName));
  // 업체로 잡지 못한 자리(이미 빼 둔 사이트 등)는 비워 두지 않고 웹에서 다른 업체를 찾는다
  const failed = urls.map((url, i) => claim(VENDOR_IDS[i], { name: names[i], url, reason: '사용자가 지정' }));
  timeline({ kind: 'vendors', slots: activeSlots });
  const gen = generation;
  await Promise.all(urls.map((_, i) => (failed[i] ? hunt(VENDOR_IDS[i], gen) : collect(VENDOR_IDS[i], gen))));
  if (gen === generation) maybeOpenGate();
}

/** 주소의 호스트 ("www." 뺌). 주소가 아니면 그대로 */
function hostLabel(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 같은 사이트(siteKey)의 주소는 처음 것만 남긴다 */
function uniqueSites(urls: string[]) {
  const seen = new Set<string>();
  return urls.filter((u) => {
    const key = hostKey(u);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 사용자가 준 URL의 업체 이름. 이 컴퓨터의 시연용 업체(localhost)는 페이지 제목의 업체 이름("라벨공방 - …" → 라벨공방), 그 밖에는 도메인.
 *  차단·오류 화면이면 빈 이름: claim이 주소로 채우고, 사용자가 화면을 해결한 뒤 진짜 이름으로 바꾼다 */
async function siteName(url: string): Promise<string> {
  const host = hostLabel(url);
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    // 차단·오류 화면의 제목("보안 확인" 등)을 업체 이름으로 쓰지 않는다
    if (!res.ok) return local ? '' : host;
    const html = (await res.text()).slice(0, 300_000);
    // 사이트 이름: og:site_name → 페이지 제목의 업체 이름 부분 ("고급명함제작 | 비즈팩토리" → 비즈팩토리, "라벨공방 - …" → 라벨공방)
    const og = /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']{2,30})["']/i.exec(html)?.[1]?.trim();
    const parts = (/<title>([^<]+)<\/title>/i.exec(html)?.[1] ?? '').split(/\s*[-|·:–]\s*/).map((t) => t.replace(/\s*(홈페이지|공식\s*몰|쇼핑몰|온라인\s*몰)$/, '').trim()).filter((t) => t.length >= 2);
    const titleName = local ? parts[0] : parts.length > 1 ? parts.find((t) => t.length <= 12 && !/[0-9]|제작|주문|인쇄|상품|명함|스티커/.test(t)) ?? parts[parts.length - 1] : parts[0];
    const name = [og, titleName].find((t) => t && t.length <= 20 && !BLOCK_TITLE.test(t));
    return name ?? host;
  } catch {
    return host;
  }
}

/** 차단·로그인·오류 화면의 제목: 업체 이름으로 쓰지 않는다 */
const BLOCK_TITLE =
  /보안\s*(확인|문자|검사)|접근\s*(차단|제한|거부|불가)|차단\s*(됨|된|되었)|비정상|자동\s*입력\s*방지|본인\s*(확인|인증)|로그인|captcha|\brobot\b|access\s*denied|\bforbidden\b|just a moment|attention required|\bsign\s*in\b|\blog\s*in\b|잠시만\s*기다|페이지를\s*찾을\s*수|^\s*\d{3}(\s|$)|\berror\b/i;

/** 진짜 이름을 아직 못 읽은 업체 (차단 화면에서 정해 주소로 채워 둠) */
const provisional = new Set<VendorId>();

/** 사용자가 차단을 해결한 뒤처럼 진짜 페이지가 보일 때: 임시 이름을 페이지 제목의 업체 이름으로 바꾼다 */
async function refreshVendorName(slot: VendorId) {
  const v = getVendor(slot);
  if (!v || !provisional.has(slot)) return;
  const d = getDriver(slot);
  if (await detectBlock(d).catch(() => null)) return;
  const title = (await d.title().catch(() => '')).split(/\s[-|·:]\s/)[0]?.trim().slice(0, 60);
  if (!title || BLOCK_TITLE.test(title) || getVendor(slot) !== v) return;
  provisional.delete(slot);
  replaceVendor({ ...v, name: title });
  quoteStore.renameVendor(slot, title);
  emit('vendors', { payload: listVendors() });
}

/** 이 브라우저가 이 사이트를 업체로 잡을 수 없는 사유 (이미 빼 둔 사이트·다른 브라우저가 고른 사이트) */
function claimConflict(slot: VendorId, url: string): string | null {
  const key = hostKey(url);
  if (banned.has(key)) return '이미 시도했지만 웹에서 견적을 낼 수 없었던 업체입니다. 다른 업체를 고르세요.';
  const dup = listVendors().find((x) => x.id !== slot && hostKey(x.url) === key);
  if (dup) return `브라우저 ${dup.id}가 이미 고른 업체(${dup.name})입니다. 다른 업체를 고르세요.`;
  return null;
}

/** 업체 확정 (다른 브라우저와 중복이면 거부 사유) */
function claim(slot: VendorId, picked: PickedVendor): string | null {
  const conflict = claimConflict(slot, picked.url);
  if (conflict) return conflict;
  // 차단 화면 제목("보안 확인" 등)이나 빈 이름은 주소로 두고, 진짜 페이지가 보이면 바꾼다
  const placeholder = !picked.name?.trim() || BLOCK_TITLE.test(picked.name);
  const v = placeholder ? { ...picked, name: hostLabel(picked.url) } : picked;
  if (placeholder) provisional.add(slot);
  else provisional.delete(slot);
  const info: VendorInfo = { id: slot, ...v };
  noteVerdict(slot, v.url, `${v.name} 업체로 확정해 견적 받는 중`);
  replaceVendor(info);
  quoteStore.renameVendor(slot, v.name);
  emit('vendors', { payload: listVendors() });
  if (activeSlots.every((id) => getVendor(id))) setStage('collect');
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
      system: huntSystemPrompt(slot, requirements, triedNames.get(slot) ?? [], targets.get(slot), activeSlots.length),
      goal: targets.has(slot)
        ? `"${targets.get(slot)}" 사이트에서 이 품목 페이지를 찾아 claim_vendor로 확정한 뒤, 견적 정보를 report_quote로 보고해 줘.`
        : '담당 경로로 웹에서 바로 견적을 낼 수 있는 업체 1곳을 찾아 claim_vendor로 확정한 뒤, 그 업체의 견적 정보를 report_quote로 보고해 줘.',
      tools: HUNT_TOOLS
    },
    'hunt'
  );
}

/** 이 브라우저의 업체 자리를 비운다 (다른 사이트를 다시 찾기 전) */
function dropVendor(slot: VendorId) {
  provisional.delete(slot);
  setVendors(listVendors().filter((v) => v.id !== slot));
  emit('vendors', { payload: listVendors() });
  quoteStore.resetOne(slot);
  clearOriginals(slot);
}

/** 사용자가 바로 연락할 수 있는 대안인지 (메일은 메일 주소, 문자·카톡은 전화번호나 메신저 링크) */
const reachable = (fb: Fallback) => (fb.channel === 'mail' ? Boolean(fb.email) : Boolean(parseContact(fb.contact).phone || parseContact(fb.contact).chatUrl));

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
    const message = messageDraft(slot, requirements, fb.contact);
    messages.set(slot, message);
    const how = message.chatUrl && message.phone ? '카카오톡이나 문자' : message.chatUrl ? '카카오톡' : message.phone ? '문자' : '카카오톡·문자';
    say(`${why}${josa(fb.vendor.name, '은/는')} ${how}로 견적을 받아야 해요 (${clause(fb.reason)}). 아래 문의 초안을 확인해 보내 주세요. 받은 견적서 PDF를 올리거나 답장을 붙여 넣으면 웹 견적과 같은 기준으로 비교할게요.`);
    timeline({ kind: 'upload', vendorId: slot, message });
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
  const run = runOf(slot);
  const driver = getDriver(slot);
  await setHandoff(slot, undefined);
  try {
    const outcome = await runAgent(
      {
        slot,
        driver,
        onClaim: (v) => claim(slot, v),
        onReport: (fields, meta, url) =>
          tracked(
            (async () => {
              if (!getVendor(slot)) claim(slot, { name: new URL(url).hostname.replace(/^www\./, ''), url, reason: '견적 정보가 있는 페이지' });
              void captureWeb(slot, url);
              void refreshVendorName(slot);
              // 에이전트가 납기를 빠뜨렸으면 페이지 원문에서 추정
              if (!fields.leadTimeDays && !quoteStore.hasField(slot, 'leadTimeDays')) {
                const text = await driver.evaluate<string>('document.body ? document.body.innerText : ""').catch(() => '');
                fields = fillLeadTimeFromText(fields, text);
              }
              // 가격을 본 상품·주문 화면을 주문 페이지로 기억한다 (FAQ·배송 안내 같은 안내 페이지는 제외)
          if (fields.listedPrice && !INFO_PAGE.test(url)) meta = { ...meta, productUrl: url };
          return applyFields(slot, fields, meta, 'web', url);
            })()
          ),
        onAfter: () => void refreshState(slot),
        // 자기 업체 사이트 안에서 움직일 때는 기록만 하고 알림은 붙이지 않는다
        // 자유 탐색이면 견적서를 내주는 업체를 우선한다 (사용자가 주소·이름으로 정한 업체는 그대로)
        preferQuoteDoc: mode === 'hunt' && !targets.has(slot),
        onNoQuoteDoc: (pv) => noteVerdict(slot, pv.url, `${pv.name}: 견적서 출력 기능 없음`),
        onVisit: (url, title) => {
          const note = noteVisit(slot, url, title);
          const own = getVendor(slot);
          return own && hostKey(own.url) === hostKey(url) ? null : note;
        },
        board: () => boardFor(slot),
        // 견적서를 받은 화면(옵션을 맞춘 상품·주문 화면)을 주문 페이지로 기억한다
        onPdf: async (file) => {
          const page = await driver.url().catch(() => '');
          if (/^https?:/.test(page) && !INFO_PAGE.test(page)) quoteStore.mergeMeta(slot, { productUrl: page });
          return onQuotePdf(slot, file);
        },
        engine: () => engines.get(slot) ?? 'naver',
        // 정한 업체 사이트에 연결이 안 되면 바로 끝낸다 (후보를 고르는 중이면 다른 후보로 넘어가게 둔다)
        stopOnNavFail: (u) => {
          const own = getVendor(slot);
          return mode === 'collect' && Boolean(own) && hostKey(u) === hostKey(own!.url);
        },
        missingOnDone: () => {
          if (!getVendor(slot) || !quoteStore.hasListedPrice(slot)) return [];
          const want: [FieldKey, string][] = [['shippingFee', '배송비'], ['leadTimeDays', '납기']];
          if (requirements?.needInstall) want.push(['installFee', '설치비']);
          return want.filter(([k]) => !quoteStore.hasField(slot, k)).map(([, label]) => label);
        }
      },
      { ...task, signal: { get aborted() { return halted(slot, gen, run); } } }
    );
    if (halted(slot, gen, run)) return;
    const v = getVendor(slot);
    const hasPrice = v ? quoteStore.hasListedPrice(slot) : false;
    if (v && hasPrice) {
      setVendorStatus(slot, 'done');
    } else if (v && outcome.kind === 'unreachable') {
      // 접속이 안 되는 주소: 빈 화면을 "내용 없음"으로 보지 않고, 다른 사이트를 찾으러 가지도 않고 알린다 (다시 시도·다른 업체로 버튼)
      setVendorStatus(slot, 'failed');
      say(`${v.name}: 사이트에 연결하지 못했어요 (주소를 확인해 주세요). 주소를 고쳐 다시 알려 주시거나 카드의 "다시 시도"·"다른 업체로"를 눌러 주세요.`);
    } else {
      // 웹 견적 실패: 대안으로 기록해 두고, 시도 횟수가 남았으면 다른 사이트부터
      const fb: Fallback | null =
        v && outcome.kind === 'switch'
          ? { vendor: v, channel: outcome.channel, email: outcome.contact?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0], contact: outcome.contact, reason: outcome.reason || '웹에 가격이 없음' }
          : null;
      if (fb) fallbacks.set(slot, [...(fallbacks.get(slot) ?? []), fb]);
      const reason = outcome.kind === 'switch' || outcome.kind === 'user' ? clause(outcome.reason) : '가격 정보를 찾지 못함';
      // 확인할 수 없는 사이트(차단·로그인·조작 불가 등)는 기다리지 않고 건너뛰어 다른 사이트에서 다시 찾는다.
      // 더 시도할 수 없을 때만 사용자에게 넘긴다
      const canRetry = (tries.get(slot) ?? 0) < MAX_TRIES;
      if (outcome.kind === 'user' && !canRetry) {
        // 418·CAPTCHA·로그인 등 사람이 해야 하는 화면: 멈추고 넘긴다 (해결하면 계속, 건너뛰면 다음 업체)
        handoffMode.set(slot, { mode, url: outcome.url });
        setVendorStatus(slot, 'needs_user');
        await setHandoff(slot, reason);
        const where = v ? v.name : `브라우저 ${slot} (${outcome.url ? new URL(outcome.url).host : '검색 중'})`;
        say(`${where}: ${reason}. 화면에서 직접 해결한 뒤 "해결했어요, 계속"을 누르거나, "건너뛰기"를 눌러 다음 업체로 넘어가세요.`);
        void refreshState(slot);
        return;
      }
      // 웹에만 의지하지 않는다: 메일 주소·전화번호·메신저 링크처럼 바로 연락할 수 있으면 다른 사이트를 더 찾지 않고 그 업체로 문의
      if (outcome.kind !== 'user' && fb && reachable(fb)) {
        // 연락처가 적힌 화면을 원본으로 남겨 둔다
        void captureWeb(slot, await driver.url(), true);
        await useFallback(slot, fb, false);
        void refreshState(slot);
        maybeOpenGate();
        return;
      }
      // 사용자가 준 주소·이름으로 지정한 업체여도 견적을 확인할 수 없으면 다른 사이트를 찾는다
      if (canRetry) {
        targets.delete(slot);
        if (v) {
          banned.add(hostKey(v.url));
          noteVerdict(slot, v.url, `${v.name}: 웹 견적 안 됨 (${reason})`);
          triedNames.set(slot, [...(triedNames.get(slot) ?? []), `${v.name}(${reason})`]);
          if (fb) void captureWeb(slot, await driver.url(), true);
          say(`브라우저 ${slot}: ${v.name}에서는 견적을 확인할 수 없어요 (${reason}). 건너뛰고 다른 사이트를 찾아볼게요 (${(tries.get(slot) ?? 0) + 1}/${MAX_TRIES}).`);
          dropVendor(slot);
        } else if (outcome.kind === 'user') {
          // 업체를 고르기 전 검색 단계에서 막힌 경우: 다음 검색 엔진으로
          const host = outcome.url ? hostKey(outcome.url) : '';
          if (host) banned.add(host);
          say(`브라우저 ${slot}: ${reason}. 건너뛰고 다른 곳에서 다시 찾아볼게요 (${(tries.get(slot) ?? 0) + 1}/${MAX_TRIES}).`);
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
    if (halted(slot, gen, run)) return;
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
  // 비교 카드에 보여 줄 제품 사진은 따로 찾아서 같은 원본에 붙여 다시 보낸다 (못 찾아도 견적 진행에는 영향 없음).
  // 이 화면에 없으면 업체 상품 페이지에서 찾는다
  const home = getVendor(slot)?.url;
  const photo =
    (await productPhoto(driver, buf, url).catch(() => null)) ??
    (home && home !== url ? await photoFromPage(home).catch(() => null) : null);
  if (photo) emit('original', { vendorId: slot, payload: { ...original, productImage: photo } });
}

/** 계속·건너뛰기를 처리하는 중인 브라우저. 버튼을 연달아 눌러도 한 브라우저에 에이전트가 하나만 돌게 */
const pendingSlots = new Set<VendorId>();

/** 사용자가 차단 화면을 해결함 → 같은 단계부터 이어서 */
export function resume(slot: Slot) {
  if (slot === 'search' || getVendorStatus(slot) !== 'needs_user' || pendingSlots.has(slot)) return;
  pendingSlots.add(slot);
  const h = handoffMode.get(slot);
  handoffMode.delete(slot);
  say(`브라우저 ${slot}: 이어서 진행할게요.`);
  // collect·hunt는 시작하자마자 상태를 browsing으로 바꾸므로 그때 표시를 푼다
  void setHandoff(slot, undefined)
    .catch(() => undefined)
    .then(async () => {
      // 차단 화면에서 정한 임시 이름이면 해결된 진짜 페이지의 이름으로 바꾼다
      await refreshVendorName(slot).catch(() => undefined);
      pendingSlots.delete(slot);
      return getVendor(slot) ? collect(slot) : hunt(slot, generation, false);
    });
  void h;
}

/** 사용자가 건너뜀 → 이 업체(또는 막힌 검색 엔진)를 빼고 다음 업체로 */
export async function skip(slot: VendorId) {
  if (!requirements || getVendorStatus(slot) !== 'needs_user' || pendingSlots.has(slot)) return;
  pendingSlots.add(slot);
  try {
    await skipNow(slot);
  } finally {
    pendingSlots.delete(slot);
  }
}

async function skipNow(slot: VendorId) {
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
    say(`브라우저 ${slot}: ${v ? josa(v.name, '은/는') : '이 업체는'} 건너뛰었어요. 더 시도할 업체가 없으면 업체 URL을 붙여 넣어 주세요.`);
  }
  maybeOpenGate();
}

/** 브라우저마다 실행 번호. 멈추면 올라가서, 그 전에 시작한 에이전트는 바로 이어서 하기를 눌러도 다시 살아나지 않는다 */
const runs = new Map<VendorId, number>();
const runOf = (slot: VendorId) => runs.get(slot) ?? 0;

/** 이 브라우저의 작업을 그만둬야 하는지: 새 견적·조건 변경(generation)이거나 사용자가 멈춤(실행 번호가 바뀜) */
const halted = (slot: VendorId, gen: number, run: number) => gen !== generation || runOf(slot) !== run;

/** 반영 중인 견적 보고 (멈춤 안내가 막 들어오던 견적을 빠뜨리지 않게 기다린다) */
const reporting = new Set<Promise<unknown>>();
function tracked<T>(p: Promise<T>): Promise<T> {
  reporting.add(p);
  const done = () => reporting.delete(p);
  p.then(done, done);
  return p;
}

/** 사용자가 멈춤: 탐색 중인 브라우저만 멈추고, 모은 업체·견적은 그대로 두고 그걸로 비교한다.
 *  메일 회신 대기·파일 분석은 사용자가 이미 맡긴 일이라 그대로 둔다 */
export async function stop() {
  const running = VENDOR_IDS.filter((id) => getVendorStatus(id) === 'browsing');
  if (!requirements || running.length === 0) {
    say('지금 멈출 작업이 없어요.');
    return;
  }
  // 에이전트는 다음 단계에서 실행 번호가 바뀐 것을 보고 스스로 멈춘다 (halted)
  for (const id of running) {
    runs.set(id, runOf(id) + 1);
    setVendorStatus(id, 'stopped');
    void refreshState(id);
  }
  // 멈추기 직전에 보고한 견적이 반영될 때까지 잠깐 기다린 뒤 센다 (너무 오래 걸리면 그냥 진행)
  const gen = generation;
  if (reporting.size) await Promise.race([Promise.allSettled([...reporting]), sleep(3000)]);
  if (gen !== generation) return;
  // 이미 가격까지 받은 업체는 "멈춤"이 아니라 견적 완료로 둔다 (runCollector가 끝났을 때와 같은 기준)
  for (const id of running) if (getVendorStatus(id) === 'stopped' && getVendor(id) && quoteStore.hasListedPrice(id)) setVendorStatus(id, 'done');
  const priced = listVendors().filter((v) => quoteStore.hasListedPrice(v.id)).length;
  if (priced === 0) {
    say('멈췄어요. 아직 모은 견적이 없어요. "다시 시작"이라고 말하거나 브라우저 카드의 "이어서 하기"를 누르면 이어서 찾고, 바꿀 조건을 말하면 그 조건으로 다시 찾아요.');
    return;
  }
  say(`멈췄어요. 지금까지 모은 ${priced}곳의 견적으로 비교할게요. 멈춘 브라우저는 "다시 시작"이라고 말하거나 카드의 "이어서 하기"를 누르면 이어서 해요.`);
  maybeOpenGate();
}

/** 멈춘 브라우저를 모두 이어서 진행 (멈춘 게 없으면 false). 사용자가 멈춘 것이라 업체 찾기 시도 횟수에는 넣지 않는다 */
function resumeStopped() {
  const stopped = VENDOR_IDS.filter((id) => getVendorStatus(id) === 'stopped');
  if (!requirements || stopped.length === 0) return false;
  say(`멈췄던 브라우저 ${stopped.join('·')}를 이어서 진행할게요.`);
  for (const id of stopped) void (getVendor(id) ? collect(id) : hunt(id, generation, false));
  return true;
}

export function retry(slot: VendorId) {
  // 실패·멈춘 브라우저만 (collect·hunt가 바로 browsing으로 바꿔 연달아 눌러도 한 번만 돈다)
  if (!['failed', 'stopped'].includes(getVendorStatus(slot)) || pendingSlots.has(slot)) return;
  void (getVendor(slot) ? collect(slot) : hunt(slot));
}

/** 막힌 업체를 빼고 같은 브라우저로 새 업체를 찾는다 */
export function replace(slot: VendorId) {
  const old = getVendor(slot);
  if (!requirements || !VENDOR_IDS.includes(slot) || pendingSlots.has(slot) || ['browsing', 'parsing'].includes(getVendorStatus(slot))) return;
  if (old) {
    banned.add(hostKey(old.url));
    say(`${josa(old.name, '은/는')} 빼고 브라우저 ${slot}로 다른 업체를 찾아볼게요.`);
  }
  dropVendor(slot);
  tries.set(slot, 0);
  // 사용자가 지정한 업체였어도 "다른 업체로"를 누르면 자유롭게 찾는다
  targets.delete(slot);
  void hunt(slot);
}

function applyFields(slot: VendorId, fields: ReportedFields, meta: QuoteMeta, channel: 'web' | 'mail' | 'file', ref: string, answered = false) {
  quoteStore.mergeMeta(slot, meta);
  const p = fields.listedPrice?.value;
  if (channel === 'web' && typeof p === 'number') noteVerdict(slot, ref, `${getVendor(slot)?.name ?? '이 업체'} 가격 ${p.toLocaleString('ko-KR')}원 확인함`);
  return quoteStore.apply(slot, fields, { channel, ref }, answered);
}

/** 브라우저 3개가 모두 탐색·분석을 마쳤는지 */
const allSettled = () => VENDOR_IDS.every((id) => !['browsing', 'parsing'].includes(getVendorStatus(id)));

function maybeOpenGate() {
  if (!allSettled()) return;
  // 사용자가 멈췄는데 모은 견적이 없으면 빈 비교를 열지 않는다 (stop()이 안내함)
  if (VENDOR_IDS.some((id) => getVendorStatus(id) === 'stopped') && !listVendors().some((v) => quoteStore.hasListedPrice(v.id))) return;
  quoteStore.openGate();
  // 반영 대기 중인 값이 없으면 지금 바로 가격 이상치 확인·추천 (있으면 큐가 비었을 때 onQuotesSettled에서)
  if (!quoteStore.hasPending()) onQuotesSettled();
}

function showCompare() {
  setStage('compare');
  if (compareShown) return;
  compareShown = true;
  timeline({ kind: 'compare' });
}

// ─── 사이트 가견적서 PDF ──────────────────────────────────────

/** 에이전트가 사이트에서 받은 가견적서 PDF: 원본으로 보관하고, Claude가 PDF를 직접 읽어 견적에 반영한다 */
async function onQuotePdf(slot: VendorId, file: PdfFile): Promise<string[]> {
  if (!requirements) return [];
  if (!getVendor(slot)) claim(slot, { name: new URL(file.url).hostname.replace(/^www\./, ''), url: file.url, reason: '가견적서를 받은 사이트' });
  emit('original', {
    vendorId: slot,
    payload: {
      id: randomUUID(),
      vendorId: slot,
      channel: 'file',
      title: `사이트 가견적서 · ${file.name}`,
      url: file.url,
      fileName: file.name,
      ref: file.name,
      mime: 'application/pdf',
      fileData: `data:application/pdf;base64,${file.data.toString('base64')}`,
      capturedAt: new Date().toISOString()
    } satisfies QuoteOriginal
  });
  const { fields, meta } = await parseQuoteFile({ vendorId: slot, requirements, name: file.name, mime: 'application/pdf', data: file.data });
  const added = applyFields(slot, fields, meta, 'file', file.name);
  say(
    `${vendorName(slot)} 사이트에서 가견적서 PDF(${file.name})를 받아 읽었어요${added.length ? `: ${added.join(', ')}` : '. 숫자 항목은 찾지 못했어요'}. 업체 견적서의 "받은 원본"에서 PDF를 볼 수 있어요.`
  );
  return added;
}

// ─── 파일 채널 ────────────────────────────────────────────────

export async function onFileUpload(slot: VendorId, input: { name: string; mime: string; data: Uint8Array }) {
  if (!requirements || !VENDOR_IDS.includes(slot)) return;
  // renderer 입력이라 이름·형식·크기를 확인한다
  const name = typeof input?.name === 'string' ? (input.name.split(/[\\/]/).pop() ?? '').trim().slice(0, 200) : '';
  const mime = typeof input?.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(input.mime) ? input.mime.toLowerCase() : '';
  const data = input?.data instanceof Uint8Array ? input.data : null;
  if (!name || !data) return notice('파일을 읽지 못했어요. 다시 올려 주세요.', slot);
  if (data.length > MAX_QUOTE_FILE_BYTES) return notice(`파일이 너무 커요 (${Math.ceil(data.length / 1024 / 1024)}MB). 15MB 이하 견적서만 올릴 수 있어요.`, slot);
  const file = { name, mime, data };
  if (!quoteFileBlock(file)) return notice(`지원하지 않는 파일 형식이에요 (${name}). PDF·사진·글 파일을 올려 주세요.`, slot);
  try {
    setVendorStatus(slot, 'parsing');
    emit('original', {
      vendorId: slot,
      payload: {
        id: randomUUID(),
        vendorId: slot,
        channel: 'file',
        title: file.name,
        fileName: file.name,
        ref: file.name,
        mime: file.mime,
        fileData: `data:${file.mime || 'application/octet-stream'};base64,${Buffer.from(file.data).toString('base64')}`,
        text: file.mime.startsWith('text/') ? Buffer.from(file.data).toString('utf8').slice(0, 20000) : undefined,
        capturedAt: new Date().toISOString()
      } satisfies QuoteOriginal
    });
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

// ─── 문자·카톡 채널 (사용자가 직접 보내고, 받은 견적서·답장을 넣는다) ─────

/** 사용자가 문의를 보냄 → 회신 대기 */
export function onMessageSent(slot: VendorId) {
  if (!messages.has(slot)) return;
  setVendorStatus(slot, 'waiting_reply');
  maybeOpenGate();
}

/** 받은 답장 글을 붙여 넣음 → 견적서와 같은 방식으로 항목을 뽑아 비교에 넣는다 */
export async function onPasteMessage(slot: VendorId, text: string) {
  const body = typeof text === 'string' ? text.trim().slice(0, 20000) : '';
  if (!requirements || !body) return;
  const ref = '문자·카톡 답장';
  setVendorStatus(slot, 'parsing');
  emit('original', {
    vendorId: slot,
    payload: { id: randomUUID(), vendorId: slot, channel: 'file', title: ref, ref, text: body, capturedAt: new Date().toISOString() } satisfies QuoteOriginal
  });
  try {
    const { fields, meta } = await extractQuote({ vendorId: slot, requirements, hint: ref, ref, channel: 'file', content: [{ type: 'text', text: body }] });
    const added = applyFields(slot, quoteStore.hasField(slot, 'leadTimeDays') ? fields : fillLeadTimeFromText(fields, body), meta, 'file', ref);
    setVendorStatus(slot, 'done');
    say(added.length ? `${vendorName(slot)} 답장에서 ${added.join(', ')}를 확인했어요.` : `${vendorName(slot)} 답장에서 견적 값을 찾지 못했어요. 견적서 PDF를 받으면 올려 주세요.`);
  } catch (e) {
    setVendorStatus(slot, 'waiting_reply');
    notice(`${vendorName(slot)} 답장 분석 실패: ${errMsg(e)}`, slot);
  }
  maybeOpenGate();
}

/** 문자 앱 열기. 번호는 main이 가진 초안에서 꺼낸다 (renderer가 임의 주소를 열지 못하게) */
export async function onOpenSms(slot: VendorId, body: string) {
  const phone = messages.get(slot)?.phone;
  if (!phone || !/^0\d{8,10}$/.test(phone)) return { ok: false, error: '전화번호가 없어요. 초안을 복사해 보내 주세요.' };
  try {
    await shell.openExternal(`sms:${phone}?body=${encodeURIComponent(String(body ?? '').slice(0, 2000))}`);
    return { ok: true };
  } catch {
    return { ok: false, error: '이 컴퓨터에서 문자 앱을 열 수 없어요. 초안을 복사해 휴대폰으로 보내 주세요.' };
  }
}

// ─── 메일 채널 ────────────────────────────────────────────────

/** watch=false: 받은편지함으로 회신을 기다리지 않는다 (계정으로 못 보내 시연으로만 보낸 메일) */
function afterSent(draft: MailDraft, watch = true) {
  if (draft.kind === 'order') return;
  setVendorStatus(draft.vendorId, 'waiting_reply');
  if (draft.kind === 'question' && draft.fields) quoteStore.markAsked(draft.vendorId, draft.fields);
  // 조건 변경 뒤 늦게 온 이전 검색의 회신은 새 견적에 섞지 않는다
  const gen = generation;
  if (watch && imapConfigured()) watchReply(draft.vendorId, draft.kind, subjectTag(draft), (r) => void (gen === generation && handleReply(draft.vendorId, draft.kind, r)));
  maybeOpenGate();
}

/** renderer가 보낸 초안: 이번 검색에서 main이 만든 초안이어야 하고, 고친 받는 사람·제목·본문만 반영한다 (업체·종류·항목은 main 것) */
function liveDraft(input: MailDraft): MailDraft | null {
  const stored = typeof input?.id === 'string' ? drafts.get(input.id) : undefined;
  if (!stored) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return { ...stored, to: str(input.to, 320).trim(), subject: str(input.subject, 300), body: str(input.body, 20000) };
}
const STALE_DRAFT = '이 메일 초안은 이미 보냈거나 지난 검색의 초안이라 보낼 수 없어요.';

export async function onMailSend(input: MailDraft) {
  const draft = liveDraft(input);
  if (!draft) return { ok: false, error: STALE_DRAFT };
  if (!draft.to) return { ok: false, error: '받는 사람 메일 주소를 넣어 주세요.' };
  // 보내는 동안 새 견적·조건 변경이 일어나면 이 메일의 회신을 새 검색에 섞지 않는다
  const gen = generation;
  // 연달아 눌러도 한 번만 보내도록 보내는 동안 초안을 빼 둔다 (실패하면 되돌림)
  const stored = drafts.get(draft.id)!;
  drafts.delete(draft.id);
  // 시연용 주소면 보내는 동안 회신(견적서 PDF)을 미리 만든다
  const demo = isDemoAddress(draft.to);
  const req = requirements;
  const prepared = demo && req ? demoReply(draft, req, vendorName(draft.vendorId), marketTotal(draft.vendorId, req)).catch(() => null) : null;
  let sent: Awaited<ReturnType<typeof sendMail>>;
  try {
    sent = await sendMail(draft);
  } catch (e) {
    if (gen === generation) drafts.set(draft.id, stored);
    return { ok: false, error: errMsg(e) };
  }
  if (gen !== generation) return { ok: true, imap: false };
  afterSent(draft, !sent.simulated);
  // 시연용 주소인데 계정으로 못 보냈으면(토큰 만료 등) 시연이 멈추지 않게 회신만 흉내 낸다
  if (sent.simulated) notice(`메일 계정으로 보내지 못해 실제 발송 없이 시연용 회신만 받을게요 (${sent.simulated})`, draft.vendorId);
  if (prepared) scheduleDemoReply(draft, sent, prepared);
  return { ok: true, imap: imapConfigured() || demo };
}

/** 시연용 회신 가격 기준: 다른 업체의 최저 총액 (총액이 다 나온 업체 우선, 없으면 표시가가 있는 업체의 확인된 합계) */
function marketTotal(self: VendorId, req: Requirements): number | undefined {
  const others = (Object.values(quoteStore.quotes) as Quote[]).filter((q) => q && q.vendorId !== self && q.listedPrice.value !== null);
  const full = others.map((q) => q.totalPrice).filter((t): t is number => t !== null && t > 0);
  const sums = full.length ? full : others.map((q) => confirmedSum(q, req)).filter((t) => t > 0);
  return sums.length ? Math.min(...sums) : undefined;
}

/** 시연용 주소(.test)로 보낸 메일: 목업 업체가 견적서 PDF를 붙여 답장한 것처럼 회신을 바로 반영한다.
 *  회신(견적서 PDF)은 메일을 보내는 동안 미리 만들어 두고(prepared), 보내자마자 넣는다.
 *  메일 계정이 있으면 같은 회신을 받은편지함에도 넣어 두지만, 그쪽은 기다리지 않는다 (IMAP으로 다시 읽지 않게 기다림을 먼저 거둔다) */
function scheduleDemoReply(draft: MailDraft, sent: MailRecord, prepared: ReturnType<typeof demoReply>) {
  const gen = generation;
  const tag = subjectTag(draft);
  cancelWatch(tag);
  void (async () => {
    const reply = await prepared;
    if (!reply || gen !== generation) return;
    if (imapConfigured()) {
      void demoReplyMessage({ vendorAddress: draft.to, fromName: reply.fromName, to: mailUser(), subject: sent.subject, inReplyTo: sent.id, text: reply.text, attachments: reply.attachments })
        .then(appendToInbox)
        .catch((e) => console.warn('[demo-mail] 받은편지함에 넣지 못함:', errMsg(e)));
    }
    await handleReply(draft.vendorId, draft.kind, {
      vendorId: draft.vendorId,
      tag,
      messageId: `<demo-${randomUUID()}@doldari.local>`,
      from: `${reply.fromName} <${draft.to}>`,
      subject: `Re: ${sent.subject}`,
      text: reply.text,
      attachments: reply.attachments
    });
  })().catch((e) => notice(`시연용 회신을 처리하지 못했어요: ${errMsg(e)}`, draft.vendorId));
}

export async function onMailExternal(input: MailDraft) {
  const draft = liveDraft(input);
  if (!draft) return { ok: false, error: STALE_DRAFT };
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

/** 업체 이름을 주소(localhost:4102 등)로밖에 못 정했으면, 받은 견적서의 공급자 상호로 바꾼다 */
function renameFromSupplier(slot: VendorId, supplier?: string) {
  const v = getVendor(slot);
  const name = supplier?.trim().slice(0, 60);
  if (!v || !name || (!provisional.has(slot) && v.name !== hostLabel(v.url))) return;
  provisional.delete(slot);
  replaceVendor({ ...v, name });
  quoteStore.renameVendor(slot, name);
  emit('vendors', { payload: listVendors() });
}

async function handleReply(slot: VendorId, kind: MailKind, r: IncomingReply) {
  if (!requirements) return;
  recordMail({ id: r.messageId, direction: 'in', vendorId: slot, kind, from: r.from, subject: r.subject, body: r.text, at: new Date().toISOString() });
  // 첨부 중 견적서로 볼 PDF·사진만 (명함 vcf 같은 글 첨부는 뺀다). 원본에도 그대로 붙여 메일 모양으로 보여 준다
  const docs = r.attachments.flatMap((a) => {
    const block = quoteFileBlock({ name: a.filename, mime: a.contentType, data: a.content });
    if (!block || block.type === 'text') return [];
    const mime = block.type === 'document' ? 'application/pdf' : block.type === 'image' && block.source.type === 'base64' ? block.source.media_type : a.contentType;
    return [{ block, name: a.filename || '첨부 파일', mime, data: `data:${mime};base64,${a.content.toString('base64')}` }];
  });
  const mailId = randomUUID();
  emit('original', {
    vendorId: slot,
    payload: {
      id: mailId,
      vendorId: slot,
      channel: 'mail',
      title: r.subject,
      ref: r.messageId,
      from: r.from || undefined,
      text: r.text,
      attachments: docs.length ? docs.map(({ name, mime, data }) => ({ name, mime, data })) : undefined,
      capturedAt: new Date().toISOString()
    } satisfies QuoteOriginal
  });
  // 첨부 견적서는 받은 원본에 따로도 넣는다 ("메일 회신" 옆에 "견적서 PDF"로 보이게)
  for (const d of docs) {
    emit('original', {
      vendorId: slot,
      payload: { id: randomUUID(), vendorId: slot, channel: 'file', title: `메일 첨부 · ${d.name}`, fileName: d.name, ref: r.messageId, mime: d.mime, fileData: d.data, capturedAt: new Date().toISOString() } satisfies QuoteOriginal
    });
  }
  setVendorStatus(slot, 'parsing');
  if (docs.length) {
    say(`${vendorName(slot)}에서 회신이 왔어요. 첨부된 견적서(${docs.map((d) => d.name).join(', ')})를 읽어 견적서 양식으로 정리할게요.`);
    timeline({ kind: 'reply_file', vendorId: slot, originalId: mailId });
  } else {
    say(`${vendorName(slot)}에서 회신이 왔어요. 견적서 양식으로 정리할게요.`);
  }
  try {
    const files = docs.map((d) => d.block);
    const { fields, meta } = await extractQuote({
      vendorId: slot,
      requirements,
      hint: '메일 회신',
      ref: r.messageId,
      channel: 'mail',
      content: [
        ...files,
        { type: 'text', text: `제목: ${r.subject}\n\n${r.text}` }
      ]
    });
    renameFromSupplier(slot, meta.supplier?.name);
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
/** 받은 견적서에 적힌 합계와 앱이 계산한 합계를 맞춰 본다. 다르면 빠진 항목이 있을 수 있으니 한 번 알린다
 *  (견적서 합계가 배송비 별도인 경우, 요구 A/S 기간에 맞추려고 앱이 연장비를 더한 경우도 맞는 것으로 본다) */
function checkStatedTotals() {
  if (!requirements) return;
  for (const v of listVendors()) {
    const q = quoteStore.get(v.id);
    const stated = q?.meta?.statedTotal;
    if (!q || !stated || q.listedPrice.value === null) continue;
    const computed = confirmedSum(q, requirements);
    const ship = q.shippingFee.value ?? 0;
    // A/S 연장비는 업체 견적서 합계에는 없고 앱이 비교용으로 더한 금액
    const warranty = needsWarrantyExtension(q, requirements) ? q.warrantyExtraFee.value ?? 0 : 0;
    const near = (a: number) => Math.abs(a - stated) <= Math.max(100, stated * 0.01);
    if ([computed, computed - warranty].some((c) => near(c) || near(c - ship))) {
      if (q.meta?.totalMismatch) quoteStore.mergeMeta(v.id, { totalMismatch: undefined });
      continue;
    }
    if (q.meta?.totalMismatch?.stated === stated && q.meta.totalMismatch.computed === computed) continue;
    quoteStore.mergeMeta(v.id, { totalMismatch: { stated, computed } });
    say(`${v.name} 견적서에 적힌 합계는 ${won(stated)}인데, 돌다리가 항목을 더한 합계는 ${won(computed)}이에요 (차이 ${won(Math.abs(stated - computed))}). 빠진 항목이 없는지 "견적서 보기"의 원본과 비교해 주세요.`);
  }
}

function onQuotesSettled() {
  if (!requirements) return;
  checkPriceOutliers();
  checkStatedTotals();
  // 먼저 끝난 업체만으로 추천·통합 견적서를 띄우지 않고 세 곳(가격 재확인 포함)이 다 끝날 때까지 기다린다
  if (!allSettled()) return;
  const priced = listVendors().filter((v) => quoteStore.get(v.id)?.listedPrice.value !== null);
  if (priced.length === 0) return;
  setStage('questions');
  // 비교가 바뀔 때마다 히스토리에 저장 (같은 견적 건은 같은 파일을 덮어씀)
  saveRecord(requirements, listVendors(), quoteStore.quotes);
  const rec = recommend(quoteStore.quotes, requirements);
  const missing = priced.filter((v) => missingKeys(quoteStore.get(v.id)!, requirements!).length > 0).length;
  // 금액·이유는 아래 추천 카드에 있으니 채팅은 한 줄로. 보이는 문장이 같으면 다시 말하지 않는다 (이유 속 숫자만 바뀐 경우 등)
  const line = `${rec.vendorId ? `${josa(vendorName(rec.vendorId), '을/를')} 추천해요${rec.tentative ? ' (확인 필요)' : ''}.` : '조건을 모두 만족하는 업체가 없어요.'}${missing ? ` 빠진 항목이 있는 업체 ${missing}곳은 확인 질문 메일로 채울 수 있어요.` : ''}`;
  if (line === announced) return;
  announced = line;
  say(line);
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
  const run = runOf(slot);
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
        signal: { get aborted() { return halted(slot, gen, run); } }
      }
    );
  } catch (e) {
    notice(`${v.name} 가격 재확인 실패: ${errMsg(e)}`, slot);
  }
  if (halted(slot, gen, run)) return;
  setVendorStatus(slot, 'done');
  // 큐가 반영된 뒤 값 비교
  setTimeout(() => {
    const q = quoteStore.get(slot);
    if (!q || !requirements) return;
    const changed = q.listedPrice.value !== before.listed || priceQty(q) !== before.pq;
    const amt = productAmount(q, requirements);
    // 바뀌지도 않았고 "맞음"이라고 확인하지도 못했으면 믿을 수 없는 금액 → 추천에서 빼고 사용자 확인을 부탁한다
    const confirmed = /맞음|맞다|맞습니다|확인됨/.test(note) && !/확정\s*못|확인\s*못|불확실|모름|알 수 없/.test(note);
    if (changed) {
      quoteStore.mergeMeta(slot, { priceDoubt: undefined });
      say(`${v.name} 가격을 바로잡았어요: ${amt?.toLocaleString('ko-KR')}원 (${priceQty(q)}개 기준 ${q.listedPrice.value?.toLocaleString('ko-KR')}원).${note ? ` ${note}` : ''}`);
    } else if (confirmed) {
      say(`${v.name} 가격을 다시 확인했어요. 수량 기준은 맞고 실제로 차이가 나요.${note ? ` ${note}` : ''}`);
    } else {
      quoteStore.mergeMeta(slot, { priceDoubt: note || '기준 수량을 확인하지 못함' });
      say(`${josa(v.name, '은/는')} 금액이 몇 개 기준인지 확인하지 못해 추천에서 뺐어요. 사이트에서 직접 확인해 주세요.${note ? ` ${note}` : ''}`);
    }
    // 추천 문장이 바뀌었을 때만 다시 알린다 (같은 문장이면 onQuotesSettled가 건너뜀)
    onQuotesSettled();
  }, 2500);
  maybeOpenGate();
}

export async function onSavePdf(win: BrowserWindow, html: string, fileName: string) {
  return savePdf(win, html, fileName);
}

// ─── 작성: 주문 문의(폼 handoff 또는 메일) / 확인 질문 ─

/** 추천 업체 주문 페이지 열기: 견적을 받은 상품 페이지를 그 업체 브라우저에 띄운다.
 *  옵션을 맞춰 둔 화면이 그대로 있으면 이동하지 않는다. 주문·결제 버튼은 사용자가 직접 누른다 (돌다리는 누르지 않음) */
export async function openOrderPage(slot: VendorId): Promise<{ ok: boolean; url?: string; message: string }> {
  const v = getVendor(slot);
  if (!v) return { ok: false, message: '업체 정보가 없어요.' };
  const url = orderUrl(quoteStore.get(slot), v.url) ?? v.url;
  try {
    const d = getDriver(slot);
    const now = await d.url().catch(() => '');
    const same = (() => {
      try {
        const a = new URL(now);
        const b = new URL(url);
        return a.host === b.host && a.pathname === b.pathname;
      } catch {
        return false;
      }
    })();
    if (!same) await d.navigate(url);
    const spec = [requirements?.item, requirements?.quantity ? `${requirements.quantity.toLocaleString('ko-KR')}개` : ''].filter(Boolean).join(' · ');
    say(`${v.name} 주문 페이지를 열었어요. 옵션과 수량(${spec})이 견적과 같은지 확인하고 직접 주문해 주세요. 주문·결제 버튼은 돌다리가 누르지 않아요.`);
    return { ok: true, url, message: same ? '견적을 받은 화면 그대로예요.' : '주문 페이지로 이동했어요.' };
  } catch (e) {
    return { ok: false, url, message: `페이지를 열지 못했어요: ${errMsg(e)}` };
  }
}

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
  // 새 견적·조건 변경·멈춤이면 다른 탐색처럼 이 에이전트도 멈춘다
  const gen = generation;
  await setHandoff(slot, undefined);
  setVendorStatus(slot, 'browsing');
  const run = runOf(slot);
  try {
    const outcome = await runAgent(
      { slot, driver, onAfter: () => void refreshState(slot) },
      {
        system: formSystemPrompt(v, requirements, formMessage(slot, requirements)),
        goal: `${v.url} 에서 견적·주문 문의 폼을 찾아 채우고 제출 직전에 handoff 해 줘.`,
        tools: ['navigate', 'read_text', 'snapshot', 'click', 'fill', 'handoff', 'request_user'],
        maxSteps: 16,
        signal: { get aborted() { return halted(slot, gen, run); } }
      }
    );
    if (halted(slot, gen, run)) return;
    setVendorStatus(slot, 'done');
    if (outcome.kind === 'handoff') {
      await setHandoff(slot, 'AI가 여기까지 작성했습니다. 이름·연락처를 확인하고 직접 제출하세요.');
      say('폼을 채워 두었어요. 화면에서 내용을 확인하고 최종 제출은 직접 해 주세요.');
      return;
    }
    say(`${v.name} 사이트에서 문의 폼을 쓸 수 없어요${outcome.kind === 'user' ? ` (${clause(outcome.reason)})` : ''}. 대신 주문 문의 메일을 써 두었어요.`);
  } catch (e) {
    if (halted(slot, gen, run)) return;
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
  // 시연 모드: 받는 사람을 시연용 주소로 바꿔 둔다 (카드에서 직접 고칠 수 있음)
  const demoTo = demoMailTo();
  if (demoTo) draft = { ...draft, to: demoTo };
  drafts.set(draft.id, draft);
  timeline({ kind: 'mail', draft });
}

// ─── 새 견적 ──────────────────────────────────────────────────

/** 브라우저 정리가 끝나기 전에 새 검색을 시작하지 않도록 기다릴 대상 */
let resetting: Promise<void> = Promise.resolve();

/** 진행 중인 검색을 멈추고 업체·견적 상태를 비운다 (대화·요구 조건은 호출한 쪽이 정함).
 *  상태는 바로 비우고, 시간이 걸리는 브라우저 정리는 돌려주는 Promise로 기다린다 */
function clearRun() {
  generation++;
  compareShown = false;
  announced = '';
  reportShown = false;
  drafts.clear();
  messages.clear();
  // 이전 검색의 메일 회신은 더 기다리지 않는다 (남겨 두면 IMAP 폴링이 계속 돈다)
  cancelAllWatches();
  banned.clear();
  captured.clear();
  verified.clear();
  tries.clear();
  fallbacks.clear();
  triedNames.clear();
  engines.clear();
  handoffMode.clear();
  targets.clear();
  provisional.clear();
  activeSlots = [...VENDOR_IDS];
  resetShared();
  stopSizeScan(true);
  setVendors([]);
  resetStatuses();
  quoteStore.reset(null);
  setStage('interview', true);
  // 정리에 실패해도 다음 검색은 진행할 수 있어야 하므로 실패는 삼킨다
  resetting = resetAll().catch((e) => console.log(`[reset] 브라우저 정리 실패: ${errMsg(e)}`));
  return resetting;
}

/** 히스토리에서 지난 견적을 골라 이어서 하기: 그 견적의 조건·업체·견적을 지금 견적으로 되살린다.
 *  이후 주문 페이지 열기·메일·조건 바꾸기 등을 그대로 이어서 할 수 있고, 저장은 같은 기록에 쌓인다 */
export async function resumeHistory(id: string): Promise<{ ok: boolean; message?: string }> {
  await reset();
  const rec = resumeRecord(id);
  if (!rec) return { ok: false, message: '이 기록을 열 수 없어요.' };
  interview = new Interview();
  interview.apply(rec.requirements);
  requirements = rec.requirements;
  activeSlots = rec.vendors.map((v) => v.id);
  setVendors(rec.vendors);
  emit('vendors', { payload: listVendors() });
  quoteStore.onGateOpen = showCompare;
  quoteStore.onDrained = onQuotesSettled;
  quoteStore.restore(requirements, rec.quotes);
  for (const v of rec.vendors) setVendorStatus(v.id, quoteStore.get(v.id) ? 'done' : 'failed');
  // 비교·견적서·추천은 이미 보여 준 견적이라 다시 띄우지 않는다
  compareShown = reportShown = true;
  setStage('draft', true);
  emit('requirements', { payload: requirements });
  // 업체 브라우저는 그 업체 상품 페이지로 다시 열어 둔다 (주문 페이지 열기·직접 확인용)
  for (const v of rec.vendors) {
    const url = orderUrl(quoteStore.get(v.id), v.url);
    if (url) void getDriver(v.id).navigate(url).then(() => refreshState(v.id)).catch(() => undefined);
  }
  return { ok: true };
}

export async function reset() {
  // 비교까지 가지 못한 검색도 그때까지의 업체·견적으로 남긴다 (비교가 끝난 기록은 그대로)
  if (requirements) saveRecord(requirements, listVendors(), quoteStore.quotes, { incomplete: true });
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
  if (!interview || !requirements || getStage() === 'interview') return;
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
  // 비교 전에 조건을 바꾼 검색도 그때까지의 업체·견적으로 남긴다 (비교가 끝난 기록은 그대로)
  saveRecord(req, listVendors(), quoteStore.quotes, { incomplete: true });
  // renderer가 이 시점 화면(단계·업체·견적)을 이전 검색으로 얼려 두므로, 상태를 비우기 전에 먼저 알린다
  emit('revised', { payload: summary });
  // 탐색 중인 브라우저 정리는 시간이 걸리므로 기다리지 않는다 (시작 버튼이 startSearch에서 잠깐 기다림)
  void clearRun();
  requirements = null;
  if (!fromChat) {
    // 기본값으로 채운 항목까지 카드에 보이도록 확정했던 조건을 그대로 넣어 둔다
    interview.apply(req);
    interview.reopen();
  }
  timeline({ kind: 'requirements' });
  emit('requirements', { payload: interview.req });
  emit('requirements_ready', { payload: { ready: true, asking: false } });
  if (!fromChat) say('이전 검색 결과는 위에 그대로 남겨 두었어요. 오른쪽에서 조건을 고치거나 바꿀 내용을 말해 주세요. 준비되면 "이 조건으로 찾기 시작"을 눌러 주세요.');
}
