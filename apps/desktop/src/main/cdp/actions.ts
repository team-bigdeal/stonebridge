// 브라우저 조작: navigate / click / fill / expand_all / handoff. 커서 애니메이션과 금지 규칙 포함.
import { sleep } from '../config';
import { cursorTo } from '../browser/cursor';
import { QUOTE_FORM_CHECK, QUOTE_ISSUE_RE, SUBMIT_CHECK, type QuoteFormCheck } from '../browser/guard';
import { CdpSession, waitForLoad } from './session';

export class ToolError extends Error {}
/** 사이트에 연결하지 못함 (주소 오류·서버 꺼짐·인터넷 끊김). 차단 화면과 달리 사람이 해결할 화면도 없다 */
export class NavError extends ToolError {}

/** 연결 단계에서 실패한 이동 (다운로드로 끝나는 ERR_ABORTED 같은 것은 빼고) */
const NET_FAIL = /ERR_(CONNECTION|NAME|ADDRESS|INTERNET|NETWORK|TIMED_OUT|EMPTY_RESPONSE|SSL|CERT|TUNNEL|PROXY)/;

/** 누르기 전에 제출·결제 버튼인지 확인한다. 확인하지 못하면 누르지 않는다 */
async function assertNotSubmit(cdp: CdpSession, id: number, sid?: string) {
  const info = await cdp.callOn<{ isSubmit: boolean; text: string }>(id, `function () { return (${SUBMIT_CHECK})(this); }`, sid);
  if (!info || typeof info.isSubmit !== 'boolean') throw new ToolError('누를 요소를 확인하지 못했습니다. snapshot을 다시 찍어 최신 ref를 사용하세요.');
  if (info.isSubmit) {
    // 견적서 신청자명 양식의 다음 버튼이어도 click으로는 누르지 않는다 (이름을 넣고 누르는 전용 도구로 안내)
    const q = await checkQuoteButton(cdp, id, recentTrigger(cdp), sid).catch(() => null);
    if (q?.ok) throw new ToolError(`"${info.text}"는 견적서 신청자명 양식의 버튼입니다. click 대신 quote_name_form 도구로 신청자명을 넣고 눌러 견적서를 받으세요.`);
    throw new ToolError(`"${info.text}"는 제출·결제 버튼이라 클릭이 금지되어 있습니다. 폼 작성을 마쳤다면 handoff 도구로 사용자에게 넘기세요.`);
  }
  return info;
}

/** 최근(3분 안)에 누른 견적서 출력·인쇄 버튼 글자. 견적서 출력 창을 연 버튼이라 그 창의 맥락으로 쓴다 */
export const recentTrigger = (cdp: CdpSession) =>
  cdp.lastClick && Date.now() - cdp.lastClick.at < 180_000 && QUOTE_ISSUE_RE.test(cdp.lastClick.text) ? cdp.lastClick.text : '';

/** 본문과 같은 출처 iframe(모달 안 견적서 창 등)의 문서들 */
const DOCS_EXPR = `(() => { const docs = [document]; for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument && f.contentDocument.body) docs.push(f.contentDocument); } catch (e) {} } return docs; })()`;

/** 그 버튼이 견적서 신청자명 양식의 다음·확인 버튼인지 (양식 모양까지) */
function checkQuoteButton(cdp: CdpSession, id: number, trigger: string, sid?: string) {
  return cdp.callOn<QuoteFormCheck>(id, `function () { return (${QUOTE_FORM_CHECK})(this, ${JSON.stringify(trigger)}); }`, sid);
}

/** 화면(본문·같은 출처 iframe)에서 견적서 신청자명 양식을 찾는다. 통과한 양식의 칸·버튼에 표시가 붙는다 */
export function findQuoteForm(cdp: CdpSession, trigger = recentTrigger(cdp)) {
  return cdp.evaluate<QuoteFormCheck>(`(() => {
    const check = ${QUOTE_FORM_CHECK};
    const docs = ${DOCS_EXPR};
    for (const d of docs) d.querySelectorAll('[data-doldari-qname], [data-doldari-qnext]').forEach((e) => { e.removeAttribute('data-doldari-qname'); e.removeAttribute('data-doldari-qnext'); });
    let best = null;
    for (const d of docs) {
      const r = check(d, ${JSON.stringify(trigger)});
      if (r.ok) return r;
      if (r.found && (!best || (r.context && !best.context))) best = r;
    }
    return best || { found: false, ok: false, reason: '신청자명 양식이 없습니다', button: '', fields: [], context: '' };
  })()`);
}

/** 양식을 받지 않는 이유 (에이전트에게 보여 줄 말) */
export function quoteFormRefusal(q?: QuoteFormCheck | null) {
  if (q?.found && q.context) return `견적서 출력 양식: ${q.reason}. 개인정보는 넣지 않으니 이 견적서는 받지 않습니다. 화면의 가격으로 report_quote 하거나, 사람이 직접 해야 하면 request_user로 넘기세요.`;
  return `지금 화면에 신청자명만 묻는 견적서 출력 양식이 없습니다 (${q?.reason || '확인하지 못함'}). snapshot으로 화면을 다시 확인하세요.`;
}

/** 판정 함수가 표시해 둔 요소들 → backendNodeId */
async function markedNodes(cdp: CdpSession, attr: string, sid?: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { result } = await cdp.send<{ result: { objectId?: string } }>('Runtime.evaluate', { expression: `${DOCS_EXPR}.flatMap((d) => [...d.querySelectorAll('[${attr}]')])[${i}] || null` }, sid);
    if (!result?.objectId) break;
    const { node: n } = await cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId: result.objectId }, sid);
    out.push(n.backendNodeId);
  }
  return out;
}

/** 견적서 신청자명 양식: 이름 칸에 name을 넣고 다음·확인 버튼을 누른다 (SUBMIT_CHECK의 좁은 예외).
 *  이름 칸만 있는 견적서 출력 창인지 누르기 직전에 다시 확인하고, 아니면 누르지 않는다 */
export async function submitQuoteForm(cdp: CdpSession, name: string, trigger: string, ref?: number): Promise<QuoteFormCheck> {
  assertUnlocked(cdp);
  const sid = ref ? cdp.refFrame.get(ref) : undefined;
  const q = ref ? await checkQuoteButton(cdp, node(cdp, ref), trigger, sid) : await findQuoteForm(cdp, trigger);
  if (!q?.ok) throw new ToolError(quoteFormRefusal(q));
  for (const id of await markedNodes(cdp, 'data-doldari-qname', sid)) await typeInto(cdp, id, name, sid);
  const [btn] = await markedNodes(cdp, 'data-doldari-qnext', sid);
  if (!btn) throw new ToolError('견적서 양식의 다음·확인 버튼을 찾지 못했습니다. snapshot을 다시 찍으세요.');
  const again = await checkQuoteButton(cdp, btn, trigger, sid);
  if (!again?.ok) throw new ToolError(quoteFormRefusal(again));
  const { x, y } = await centerOf(cdp, btn, sid);
  await mouseClick(cdp, x, y);
  return again;
}

function node(cdp: CdpSession, ref: number): number {
  const id = cdp.refs.get(ref);
  if (!id) throw new ToolError(`ref=${ref}를 찾을 수 없습니다. snapshot을 다시 찍어 최신 ref를 사용하세요.`);
  return id;
}

export async function centerOf(cdp: CdpSession, backendNodeId: number, sid?: string) {
  if (sid) await cdp.frameOffset(sid);
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, sid).catch(() => undefined);
  await sleep(120);
  const { quads } = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId }, sid);
  if (!quads?.length) throw new ToolError('요소가 화면에 보이지 않습니다.');
  const q = quads[0];
  // iframe 안 요소면 iframe 위치를 더해 페이지 좌표로
  const off = await cdp.frameOffset(sid);
  return { x: off.x + (q[0] + q[2] + q[4] + q[6]) / 4, y: off.y + (q[1] + q[3] + q[5] + q[7]) / 4 };
}

async function viewport(cdp: CdpSession) {
  const v = await cdp.evaluate<[number, number]>('[window.innerWidth, window.innerHeight]').catch(() => [0, 0] as [number, number]);
  return { w: v[0], h: v[1] };
}

export async function moveCursor(cdp: CdpSession, x: number, y: number) {
  const v = await viewport(cdp);
  cdp.cursor = { x, y };
  await cursorTo(cdp.slot, x, y, v.w, v.h);
}

async function mouseClick(cdp: CdpSession, x: number, y: number) {
  await moveCursor(cdp, x, y);
  const v = await viewport(cdp);
  await cursorTo(cdp.slot, x, y, v.w, v.h, true);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

function assertUnlocked(cdp: CdpSession) {
  if (cdp.locked) throw new ToolError('handoff 이후에는 이 화면을 조작할 수 없습니다. 사용자가 직접 확인하고 제출합니다.');
}

export async function navigate(cdp: CdpSession, url: string) {
  if (!/^https?:\/\//.test(url)) throw new ToolError('http(s) URL만 열 수 있습니다.');
  const res = await cdp.send<{ errorText?: string }>('Page.navigate', { url });
  if (res?.errorText && NET_FAIL.test(res.errorText)) throw new NavError(`사이트에 연결하지 못했습니다 (${res.errorText}). 주소가 맞는지, 사이트가 열려 있는지 확인이 필요합니다.`);
  await waitForLoad(cdp.wc);
  return `이동 완료: ${cdp.url()}`;
}

export async function click(cdp: CdpSession, ref: number) {
  assertUnlocked(cdp);
  const id = node(cdp, ref);
  const sid = cdp.refFrame.get(ref);
  const info = await assertNotSubmit(cdp, id, sid);
  const { x, y } = await centerOf(cdp, id, sid);
  await mouseClick(cdp, x, y);
  cdp.lastClick = { text: info.text, at: Date.now() };
  await sleep(300);
  await waitForLoad(cdp.wc);
  return `클릭 완료 ("${info.text}"). 현재 URL: ${cdp.url()}`;
}

export async function fill(cdp: CdpSession, ref: number, text: string) {
  assertUnlocked(cdp);
  const id = node(cdp, ref);
  await typeInto(cdp, id, text, cdp.refFrame.get(ref));
  return `입력 완료: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`;
}

/** 입력칸을 눌러 기존 값을 지우고 text를 타이핑한다 */
async function typeInto(cdp: CdpSession, id: number, text: string, sid?: string) {
  const { x, y } = await centerOf(cdp, id, sid);
  await mouseClick(cdp, x, y);
  await cdp.send('DOM.focus', { backendNodeId: id }, sid);
  await cdp.callOn(id, `function () { if ('value' in this) { this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); } }`, sid);
  // 타이핑이 보이도록 몇 글자씩 나눠 입력
  const step = text.length > 60 ? 6 : 1;
  for (let i = 0; i < text.length; i += step) {
    await cdp.send('Input.insertText', { text: text.slice(i, i + step) });
    await sleep(22);
  }
}

export function handoff(cdp: CdpSession, reason: string) {
  cdp.locked = true;
  return `사용자에게 넘김: ${reason}`;
}

/** 옵션 글자 비교용: 공백·mm 제거, ×·*·X → x ("90mm * 50mm" = "90x50") */
export const NORM_FN = `(s) => String(s || '').toLowerCase().replace(/\\s+/g, '').replace(/[×*✕]/g, 'x').replace(/mm/g, '').replace(/[()\\[\\]]/g, '')`;

/** 페이지에서 지금 보이는 선택지 중 option과 맞는 것을 찾아 표시해 둔다 (커스텀 드롭다운의 펼쳐진 목록).
 *  controls: 드롭다운의 aria-controls·aria-owns id. 펼쳐진 목록 안 항목을 먼저 보고, 제출·결제 버튼은 후보에서 뺀다 */
export const PICK_FN = (option: string, controls = '') => `(() => {
  const norm = ${NORM_FN};
  const want = norm(${JSON.stringify(option)});
  const submitLike = (e) => { try { return (${SUBMIT_CHECK})(e).isSubmit; } catch { return true; } };
  document.querySelectorAll('[data-doldari-pick]').forEach((e) => e.removeAttribute('data-doldari-pick'));
  const sel = '[role=option],[role=menuitem],[role=menuitemradio],[role=radio],li,.v-list-item,[class*=option],[class*=item],a,button,label';
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3; };
  const cands = [...document.querySelectorAll(sel)].filter(vis).map((e) => ({ e, t: (e.innerText || e.textContent || '').trim() })).filter((c) => c.t && c.t.length < 80 && !submitLike(c.e));
  const score = (c) => { const n = norm(c.t); return n === want ? 3 : n.startsWith(want) ? 2 : n.includes(want) ? 1 : 0; };
  // 펼쳐진 목록(aria-controls가 가리키는 곳, listbox·menu) 안에 맞는 항목이 있으면 그 안에서만 고른다
  const boxes = [document.getElementById(${JSON.stringify(controls)}), ...document.querySelectorAll('[role=listbox],[role=menu]')].filter((b) => b && vis(b));
  const matched = cands.filter((c) => score(c));
  const inBox = matched.filter((c) => boxes.some((b) => b.contains(c.e)));
  let best = null;
  for (const c of inBox.length ? inBox : matched) {
    const s = score(c);
    // 점수가 같으면 더 작은(안쪽) 요소, 목록 항목(role=option 등)을 고른다
    const area = c.e.getBoundingClientRect().width * c.e.getBoundingClientRect().height;
    const listy = c.e.matches('[role=option],[role=menuitem],.v-list-item,li') ? 1 : 0;
    const key = s * 10 + listy;
    if (!best || key > best.key || (key === best.key && area < best.area)) best = { ...c, key, area };
  }
  if (best) { best.e.setAttribute('data-doldari-pick', '1'); return { found: best.t }; }
  const shown = [...new Set(cands.filter((c) => c.e.matches('[role=option],[role=menuitem],.v-list-item,li')).map((c) => c.t))].slice(0, 25);
  return { found: null, shown };
})()`;

/** 숨은 요소(커스텀 드롭다운 안의 감춰진 input 등)면 화면에 보이는 가장 가까운 조상을 대신 누른다 */
async function visibleTarget(cdp: CdpSession, id: number, sid?: string): Promise<number> {
  const marked = await cdp
    .callOn<boolean>(
      id,
      `function () {
        const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
        if (vis(this)) return false;
        let e = this.parentElement;
        for (let i = 0; e && i < 5; i++, e = e.parentElement) if (vis(e)) { e.setAttribute('data-doldari-target', '1'); return true; }
        return false;
      }`,
      sid
    )
    .catch(() => false);
  if (!marked) return id;
  const { result } = await cdp.send<{ result: { objectId?: string } }>('Runtime.evaluate', { expression: `document.querySelector('[data-doldari-target]')` }, sid);
  await cdp.evaluate(`document.querySelectorAll('[data-doldari-target]').forEach((e) => e.removeAttribute('data-doldari-target'))`, sid).catch(() => undefined);
  if (!result?.objectId) return id;
  const { node: n } = await cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId: result.objectId }, sid);
  return n.backendNodeId;
}

/** 네이티브 <select>가 아닌 드롭다운(Vuetify·커스텀 목록 등): 눌러서 펼치고, 보이는 목록에서 option을 실제 마우스로 누른다 */
export async function selectCustom(cdp: CdpSession, ref: number, option: string) {
  assertUnlocked(cdp);
  const id = node(cdp, ref);
  const sid = cdp.refFrame.get(ref);
  // 드롭다운이라며 제출·결제 버튼을 누르지 않게 먼저 확인한다
  await assertNotSubmit(cdp, id, sid);
  const controls = () =>
    cdp
      .callOn<string>(id, `function () { const e = this.closest && this.closest('[aria-controls],[aria-owns]'); return e ? (e.getAttribute('aria-controls') || e.getAttribute('aria-owns') || '').split(/\\s+/)[0] : ''; }`, sid)
      .catch(() => '');
  // 이미 펼쳐 둔 목록에 있으면 바로 고르고, 없으면 드롭다운을 눌러 펼친다
  let pick = await cdp.evaluate<{ found: string | null; shown?: string[] }>(PICK_FN(option, await controls()), sid);
  if (!pick?.found) {
    const target = await visibleTarget(cdp, id, sid);
    if (target !== id) await assertNotSubmit(cdp, target, sid);
    const { x, y } = await centerOf(cdp, target, sid);
    await mouseClick(cdp, x, y);
    await sleep(500);
    pick = await cdp.evaluate<{ found: string | null; shown?: string[] }>(PICK_FN(option, await controls()), sid);
  }
  if (!pick?.found) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
    const shown = pick?.shown?.length ? ` 펼쳐진 목록: ${pick.shown.join(' / ')}` : ' 눌러도 목록이 보이지 않았습니다. snapshot으로 드롭다운 ref를 다시 확인하세요.';
    throw new ToolError(`"${option}" 선택지를 찾지 못했습니다.${shown}`);
  }
  const { result } = await cdp.send<{ result: { objectId?: string } }>('Runtime.evaluate', { expression: `document.querySelector('[data-doldari-pick]')` }, sid);
  if (!result?.objectId) throw new ToolError('선택지를 다시 찾지 못했습니다. 다시 시도하세요.');
  const { node: picked } = await cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId: result.objectId }, sid);
  await assertNotSubmit(cdp, picked.backendNodeId, sid);
  const { x, y } = await centerOf(cdp, picked.backendNodeId, sid);
  await mouseClick(cdp, x, y);
  await sleep(800);
  await cdp.evaluate(`document.querySelectorAll('[data-doldari-pick]').forEach((e) => e.removeAttribute('data-doldari-pick'))`, sid).catch(() => undefined);
  return `옵션 선택 완료: ${pick.found}. read_text로 다시 계산된 금액을 확인하세요.`;
}
