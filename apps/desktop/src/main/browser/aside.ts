// Aside 브라우저(사용자의 실제 Chrome 기반 브라우저) 드라이버. 슬롯마다 `aside mcp` 프로세스 하나, 탭 하나.
import type { Slot } from '@shared/types';
import { cursorTo } from './cursor';
import { type BrowserDriver, ToolError } from './driver';
import { McpClient, pickJson } from './mcp';

const J = (v: unknown) => JSON.stringify(v);
// 탭은 REPL 전역 객체에 보관 (const/let은 호출마다 새 이름이 필요하므로)
const T = 'globalThis.__dl.tab';
// Aside 페이지 객체에는 isClosed()가 없어 열린 탭 목록으로 확인한다
const PRE = 'globalThis.__dl ??= {}; globalThis.__dl.alive = (t) => !!t && tabs.includes(t);';
const ALIVE = `globalThis.__dl.alive(${T})`;
const OUT = (expr: string) => `console.log('@@' + JSON.stringify(${expr}));`;

const SUBMIT_CHECK = `(el) => {
  const tag = el.tagName;
  const type = ((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
  const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim();
  const role = el.getAttribute && el.getAttribute('role');
  const buttonLike = tag === 'BUTTON' || role === 'button' || (tag === 'INPUT' && (type === 'button' || type === 'submit'));
  const calc = /계산|견적\s*보기|견적\s*확인|가격\s*(확인|조회)|금액\s*(확인|조회)|조회|적용/.test(text) && !/결제|구매|주문|장바구니|제출|전송|보내기/.test(text);
  const isSubmit = !calc && ((tag === 'BUTTON' && (type === '' || type === 'submit') && !!el.form) || (tag === 'INPUT' && type === 'submit') ||
    (buttonLike && /제출|보내기|전송|문의하기|결제|구매하기|주문하기|장바구니/.test(text)));
  return { text: text.slice(0, 40), isSubmit };
}`;

export class AsideDriver implements BrowserDriver {
  readonly kind = 'aside' as const;
  locked = false;
  private mcp: McpClient;
  private hasTab = false;

  constructor(
    readonly slot: Slot,
    bin: string
  ) {
    this.mcp = new McpClient(bin);
  }

  private run<Tr>(body: string, title?: string): Promise<Tr> {
    return this.mcp.repl(`${PRE}\n${body}`, title).then((t) => pickJson<Tr>(t));
  }

  private requireTab() {
    if (!this.hasTab) throw new ToolError('아직 열린 페이지가 없습니다. navigate나 search_web을 먼저 쓰세요.');
  }

  private assertUnlocked() {
    if (this.locked) throw new ToolError('handoff 이후에는 이 화면을 조작할 수 없습니다. 사용자가 직접 확인합니다.');
  }

  async navigate(url: string) {
    if (!/^https?:\/\//.test(url)) throw new ToolError('http(s) URL만 열 수 있습니다.');
    const r = await this.run<{ url: string }>(
      `if (!${ALIVE}) { ${T} = await openTab(${J(url)}); } else { await ${T}.goto(${J(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 }); await ${T}.waitForLoadState('load', { timeout: 8000 }).catch(() => {}); }
       ${OUT(`{ url: ${T}.url() }`)}`,
      '페이지 이동'
    );
    this.hasTab = true;
    return `이동 완료: ${r.url}`;
  }

  async snapshot() {
    this.requireTab();
    const tree = await this.run<string>(OUT(`(await snapshot(${T})).tree`), '화면 읽기');
    return tree.length > 16000 ? `${tree.slice(0, 16000)}\n…(이하 생략: read_text로 본문을 읽으세요)` : tree;
  }

  /** 요소를 화면에 보이게 하고 위치·뷰포트 크기를 돌려받는다 */
  private async locate(ref: string) {
    return this.run<{ bb: { x: number; y: number; width: number; height: number } | null; vw: number; vh: number }>(
      `const __l = ${T}.locator(${J(ref)});
       await __l.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
       ${OUT(`{ bb: await __l.boundingBox().catch(() => null), vw: await ${T}.evaluate(() => window.innerWidth), vh: await ${T}.evaluate(() => window.innerHeight) }`)}`.replaceAll('__l', `__l${Date.now()}`),
      '위치 확인'
    );
  }

  async click(ref: string) {
    this.requireTab();
    this.assertUnlocked();
    const info = await this.run<{ text: string; isSubmit: boolean }>(`${OUT(`await ${T}.locator(${J(ref)}).evaluate(${SUBMIT_CHECK})`)}`, '요소 확인');
    if (info.isSubmit) throw new ToolError(`"${info.text}"는 제출·결제 버튼이라 클릭이 금지되어 있습니다. 폼 작성을 마쳤다면 handoff로 사용자에게 넘기세요.`);
    const pos = await this.locate(ref);
    if (pos.bb) {
      const cx = pos.bb.x + pos.bb.width / 2;
      const cy = pos.bb.y + pos.bb.height / 2;
      await cursorTo(this.slot, cx, cy, pos.vw, pos.vh);
      await cursorTo(this.slot, cx, cy, pos.vw, pos.vh, true);
    }
    const r = await this.run<{ url: string }>(
      `await ${T}.locator(${J(ref)}).click({ timeout: 10000 });
       await ${T}.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
       ${OUT(`{ url: ${T}.url() }`)}`,
      '클릭'
    );
    return `클릭 완료 ("${info.text}"). 현재 URL: ${r.url}`;
  }

  async fill(ref: string, text: string) {
    this.requireTab();
    this.assertUnlocked();
    const pos = await this.locate(ref);
    if (pos.bb) await cursorTo(this.slot, pos.bb.x + 20, pos.bb.y + pos.bb.height / 2, pos.vw, pos.vh, true);
    const id = Date.now();
    await this.run(
      `const __f${id} = ${T}.locator(${J(ref)});
       await __f${id}.fill('');
       await __f${id}.pressSequentially(${J(text)}, { delay: ${text.length > 80 ? 4 : 18} });
       ${OUT('true')}`,
      '입력'
    );
    return `입력 완료: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`;
  }

  async selectOption(ref: string, option: string) {
    this.requireTab();
    this.assertUnlocked();
    const id = Date.now();
    const r = await this.run<string[]>(
      `const __o${id} = ${T}.locator(${J(ref)});
       const __r${id} = await __o${id}.selectOption({ label: ${J(option)} }, { timeout: 5000 }).catch(() => __o${id}.selectOption(${J(option)}, { timeout: 5000 }));
       await ${T}.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
       await sleep(800);
       ${OUT(`__r${id}`)}`,
      '옵션 선택'
    );
    return `옵션 선택 완료: ${option} (${(r ?? []).join(', ')}). 금액이 다시 계산됐을 수 있으니 read_text로 확인하세요.`;
  }

  async evaluate<R>(expression: string): Promise<R> {
    this.requireTab();
    return this.run<R>(`${OUT(`await ${T}.evaluate(${J(expression)})`)}`, '페이지 읽기');
  }

  async screenshot() {
    if (!this.hasTab) return null;
    try {
      const b64 = await this.run<string>(`${OUT(`Buffer.from(await ${T}.screenshot({ type: 'jpeg', quality: 55, timeout: 5000 })).toString('base64')`)}`, '화면');
      return Buffer.from(b64, 'base64');
    } catch {
      return null;
    }
  }

  async url() {
    if (!this.hasTab) return '';
    return this.run<string>(OUT(`${ALIVE} ? ${T}.url() : ''`)).catch(() => '');
  }

  async title() {
    if (!this.hasTab) return '';
    return this.run<string>(OUT(`${ALIVE} ? await ${T}.title() : ''`)).catch(() => '');
  }

  async back() {
    if (!this.hasTab) return;
    await this.run(`await ${T}.goBack({ timeout: 10000 }).catch(() => {}); ${OUT('true')}`);
  }

  async userInput(input: { type: 'click' | 'wheel' | 'text' | 'key'; x?: number; y?: number; deltaY?: number; text?: string; key?: string }) {
    if (!this.hasTab) return;
    const vp = `const __v = await ${T}.evaluate(() => [window.innerWidth, window.innerHeight]);`;
    const x = `__v[0] * ${input.x ?? 0}`;
    const y = `__v[1] * ${input.y ?? 0}`;
    let body = '';
    if (input.type === 'click') body = `${vp} await ${T}.mouse.click(${x}, ${y});`;
    else if (input.type === 'wheel') body = `${vp} await ${T}.mouse.move(${x}, ${y}); await ${T}.mouse.wheel(0, ${Number(input.deltaY ?? 0)});`;
    else if (input.type === 'text') body = `await ${T}.keyboard.insertText(${J(input.text ?? '')});`;
    else if (input.type === 'key' && /^(Enter|Backspace|Tab|Escape|Delete|Arrow(Up|Down|Left|Right))$/.test(input.key ?? '')) body = `await ${T}.keyboard.press(${J(input.key)});`;
    if (!body) return;
    const id = Date.now();
    await this.run(`${body.replaceAll('__v', `__v${id}`)} ${OUT('true')}`, '직접 조작').catch(() => undefined);
  }

  /** 새 견적: 돌다리가 연 탭을 닫는다 */
  async reset() {
    this.locked = false;
    if (this.hasTab) await this.run(`if (${ALIVE}) await closeTab(${T}); ${T} = null; ${OUT('true')}`).catch(() => undefined);
    this.hasTab = false;
  }

  async close() {
    if (this.hasTab) await this.run(`if (${ALIVE}) await closeTab(${T}); ${T} = null; ${OUT('true')}`).catch(() => undefined);
    this.hasTab = false;
    this.mcp.close();
  }

  /** Aside가 실행 중인지 확인 */
  async ping() {
    const tools = await this.mcp.listTools();
    return tools.includes('repl');
  }
}
