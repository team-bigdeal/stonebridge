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

async function centerOf(cdp: CdpSession, backendNodeId: number) {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
  await sleep(120);
  const { quads } = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId });
  if (!quads?.length) throw new ToolError('요소가 화면에 보이지 않습니다.');
  const q = quads[0];
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
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
  const info = await cdp.callOn<{ isSubmit: boolean; text: string }>(id, SUBMIT_CHECK);
  if (info?.isSubmit) {
    throw new ToolError(`"${info.text}"는 제출 버튼이라 클릭이 금지되어 있습니다. 폼 작성을 마쳤다면 handoff 도구로 사용자에게 넘기세요.`);
  }
  const { x, y } = await centerOf(cdp, id);
  await mouseClick(cdp, x, y);
  await sleep(300);
  await waitForLoad(cdp.wc);
  return `클릭 완료 ("${info?.text ?? ''}"). 현재 URL: ${cdp.url()}`;
}

export async function fill(cdp: CdpSession, ref: number, text: string) {
  assertUnlocked(cdp);
  const id = node(cdp, ref);
  const { x, y } = await centerOf(cdp, id);
  await mouseClick(cdp, x, y);
  await cdp.send('DOM.focus', { backendNodeId: id });
  await cdp.callOn(id, `function () { if ('value' in this) { this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); } }`);
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
