// webContents.debugger(CDP) 래퍼. 업체 뷰마다 하나.
import type { WebContents } from 'electron';
import type { Slot } from '@shared/types';
import { asAgent } from '../browser/focus';

export class CdpSession {
  /** snapshot이 부여한 ref ↔ backendDOMNodeId */
  refs = new Map<number, number>();
  /** ref가 다른 출처 iframe 안 요소면 그 iframe의 CDP sessionId */
  refFrame = new Map<number, string>();
  /** 다른 출처 iframe(별도 프로세스) 세션: sessionId → iframe 정보 */
  frames = new Map<string, { targetId: string; url: string }>();
  /** handoff 이후 click/fill 금지 */
  locked = false;
  cursor = { x: 40, y: 40 };
  /** 마지막으로 누른 요소 글자 (견적서 출력 창을 연 버튼인지 볼 때) */
  lastClick: { text: string; at: number } | null = null;
  private attached = false;

  constructor(
    readonly slot: Slot,
    readonly wc: WebContents
  ) {}

  async init() {
    if (this.attached) return;
    this.wc.debugger.attach('1.3');
    this.attached = true;
    this.wc.debugger.on('detach', () => (this.attached = false));
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Runtime.enable');
    await this.send('Accessibility.enable');
    // alert/confirm 창이 뜨면 닫는다 (에이전트가 막히지 않도록)
    // 다른 출처 iframe(옵션 계산기를 iframe으로 넣은 쇼핑몰 등)도 따로 붙어서 읽고 조작할 수 있게 한다
    this.wc.debugger.on('message', (_e, method, params, sessionId) => {
      if (method === 'Page.javascriptDialogOpening') void this.send('Page.handleJavaScriptDialog', { accept: params.type === 'alert' }, sessionId || undefined).catch(() => undefined);
      if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
        const sid = params.sessionId as string;
        this.frames.set(sid, { targetId: params.targetInfo.targetId, url: params.targetInfo.url });
        void (async () => {
          for (const m of ['DOM.enable', 'Runtime.enable', 'Accessibility.enable', 'Page.enable']) await this.send(m, {}, sid).catch(() => undefined);
          await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => undefined);
        })();
      }
      if (method === 'Target.targetInfoChanged' && params.targetInfo?.type === 'iframe') {
        for (const f of this.frames.values()) if (f.targetId === params.targetInfo.targetId) f.url = params.targetInfo.url;
      }
      if (method === 'Target.detachedFromTarget') this.frames.delete(params.sessionId);
    });
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send<T = any>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    if (!this.attached) await this.init();
    const run = () => (sessionId ? this.wc.debugger.sendCommand(method, params, sessionId) : this.wc.debugger.sendCommand(method, params)) as Promise<T>;
    // 에이전트의 클릭·키 입력은 사람 입력과 구분해 둔다 (그 때문에 생긴 포커스 이동은 되돌림)
    return method.startsWith('Input.') ? asAgent(this.wc, run) : run();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate<T = any>(expression: string, sessionId?: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate 실패');
    return res.result?.value as T;
  }

  /** backendNodeId 요소에서 함수 실행 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async callOn<T = any>(backendNodeId: number, fn: string, sessionId?: string): Promise<T> {
    const { object } = await this.send('DOM.resolveNode', { backendNodeId }, sessionId);
    const res = await this.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, returnByValue: true }, sessionId);
    return res.result?.value as T;
  }

  /** 다른 출처 iframe 안 좌표 → 페이지 좌표로 옮길 때 더할 값 (iframe 내용 영역의 왼쪽 위) */
  async frameOffset(sessionId?: string): Promise<{ x: number; y: number }> {
    if (!sessionId) return { x: 0, y: 0 };
    const f = this.frames.get(sessionId);
    if (!f) throw new Error('iframe이 사라졌습니다. snapshot을 다시 찍으세요.');
    const { backendNodeId } = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: f.targetId });
    await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
    const { quads } = await this.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId });
    const inner = await this.callOn<[number, number]>(backendNodeId, `function () { const cs = getComputedStyle(this); return [this.clientLeft + parseFloat(cs.paddingLeft || '0'), this.clientTop + parseFloat(cs.paddingTop || '0')]; }`);
    if (!quads?.length) throw new Error('iframe이 화면에 보이지 않습니다.');
    return { x: quads[0][0] + (inner?.[0] ?? 0), y: quads[0][1] + (inner?.[1] ?? 0) };
  }

  /** 보이는 다른 출처 iframe 세션 */
  frameSessions() {
    return [...this.frames.entries()].map(([sessionId, f]) => ({ sessionId, ...f }));
  }

  url() {
    return this.wc.getURL();
  }

  reset() {
    this.locked = false;
    this.lastClick = null;
    this.refs.clear();
    this.refFrame.clear();
  }
}

export function waitForLoad(wc: WebContents, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    if (!wc.isLoading()) {
      // 클릭 직후에는 아직 로딩이 시작되지 않았을 수 있다
      setTimeout(() => (wc.isLoading() ? waitForLoad(wc, timeoutMs).then(resolve) : resolve()), 250);
      return;
    }
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      wc.removeListener('did-stop-loading', done);
      resolve();
    }
    wc.once('did-stop-loading', done);
  });
}
