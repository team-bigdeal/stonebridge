// 브라우저 조작: navigate / click / fill / expand_all / handoff. 커서 애니메이션과 금지 규칙 포함.
import { sleep } from '../config';
import { cursorTo } from '../browser/cursor';
import { CdpSession, waitForLoad } from './session';

export class ToolError extends Error {}

const SUBMIT_CHECK = `function () {
  const tag = this.tagName;
  const type = (this.getAttribute && (this.getAttribute('type') || '')).toLowerCase();
  const text = ((this.innerText || this.value || this.getAttribute('aria-label') || '') + '').trim();
  const role = this.getAttribute && this.getAttribute('role');
  const buttonLike = tag === 'BUTTON' || role === 'button' || (tag === 'INPUT' && (type === 'button' || type === 'submit'));
  const calc = /계산|견적\\s*보기|견적\\s*확인|가격\\s*(확인|조회)|금액\\s*(확인|조회)|조회|적용|견적서\\s*(출력|다운|발행|인쇄|받기|보기|저장)|가견적|PDF|인쇄/i.test(text) && !/결제|구매|주문|장바구니|제출|전송|보내기/.test(text);
  const isSubmit = !calc && ((tag === 'BUTTON' && (type === '' || type === 'submit') && !!this.form) ||
    (tag === 'INPUT' && type === 'submit') ||
    (buttonLike && /제출|보내기|전송|문의하기|결제|구매|주문하기|장바구니/.test(text)));
  return { tag, type, text: text.slice(0, 40), isSubmit };
}`;

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
  await cdp.send('Page.navigate', { url });
  await waitForLoad(cdp.wc);
  return `이동 완료: ${cdp.url()}`;
}

export async function click(cdp: CdpSession, ref: number) {
  assertUnlocked(cdp);
  const id = node(cdp, ref);
  const sid = cdp.refFrame.get(ref);
  const info = await cdp.callOn<{ isSubmit: boolean; text: string }>(id, SUBMIT_CHECK, sid);
  if (info?.isSubmit) {
    throw new ToolError(`"${info.text}"는 제출 버튼이라 클릭이 금지되어 있습니다. 폼 작성을 마쳤다면 handoff 도구로 사용자에게 넘기세요.`);
  }
  const { x, y } = await centerOf(cdp, id, sid);
  await mouseClick(cdp, x, y);
  await sleep(300);
  await waitForLoad(cdp.wc);
  return `클릭 완료 ("${info?.text ?? ''}"). 현재 URL: ${cdp.url()}`;
}

export async function fill(cdp: CdpSession, ref: number, text: string) {
  assertUnlocked(cdp);
  const id = node(cdp, ref);
  const sid = cdp.refFrame.get(ref);
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
  return `입력 완료: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`;
}

export function handoff(cdp: CdpSession, reason: string) {
  cdp.locked = true;
  return `사용자에게 넘김: ${reason}`;
}

/** 옵션 글자 비교용: 공백·mm 제거, ×·*·X → x ("90mm * 50mm" = "90x50") */
export const NORM_FN = `(s) => String(s || '').toLowerCase().replace(/\\s+/g, '').replace(/[×*✕]/g, 'x').replace(/mm/g, '').replace(/[()\\[\\]]/g, '')`;

/** 페이지에서 지금 보이는 선택지 중 option과 맞는 것을 찾아 표시해 둔다 (커스텀 드롭다운의 펼쳐진 목록) */
const PICK_FN = (option: string) => `(() => {
  const norm = ${NORM_FN};
  const want = norm(${JSON.stringify(option)});
  document.querySelectorAll('[data-doldari-pick]').forEach((e) => e.removeAttribute('data-doldari-pick'));
  const sel = '[role=option],[role=menuitem],[role=menuitemradio],[role=radio],li,.v-list-item,[class*=option],[class*=item],a,button,label';
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3; };
  const cands = [...document.querySelectorAll(sel)].filter(vis).map((e) => ({ e, t: (e.innerText || e.textContent || '').trim() })).filter((c) => c.t && c.t.length < 80);
  const score = (c) => { const n = norm(c.t); return n === want ? 3 : n.startsWith(want) ? 2 : n.includes(want) ? 1 : 0; };
  let best = null;
  for (const c of cands) {
    const s = score(c);
    if (!s) continue;
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
  // 이미 펼쳐 둔 목록에 있으면 바로 고르고, 없으면 드롭다운을 눌러 펼친다
  let pick = await cdp.evaluate<{ found: string | null; shown?: string[] }>(PICK_FN(option), sid);
  if (!pick?.found) {
    const { x, y } = await centerOf(cdp, await visibleTarget(cdp, id, sid), sid);
    await mouseClick(cdp, x, y);
    await sleep(500);
    pick = await cdp.evaluate<{ found: string | null; shown?: string[] }>(PICK_FN(option), sid);
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
  const { x, y } = await centerOf(cdp, picked.backendNodeId, sid);
  await mouseClick(cdp, x, y);
  await sleep(800);
  await cdp.evaluate(`document.querySelectorAll('[data-doldari-pick]').forEach((e) => e.removeAttribute('data-doldari-pick'))`, sid).catch(() => undefined);
  return `옵션 선택 완료: ${pick.found}. read_text로 다시 계산된 금액을 확인하세요.`;
}
