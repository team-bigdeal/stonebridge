// webContents.debugger(CDP) 래퍼. 업체 뷰마다 하나.
import type { WebContents } from 'electron';
import type { Slot } from '@shared/types';

export class CdpSession {
  /** snapshot이 부여한 ref ↔ backendDOMNodeId */
  refs = new Map<number, number>();
  /** handoff 이후 click/fill 금지 */
  locked = false;
  cursor = { x: 40, y: 40 };
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
    this.wc.debugger.on('message', (_e, method, params) => {
      if (method === 'Page.javascriptDialogOpening') void this.send('Page.handleJavaScriptDialog', { accept: params.type === 'alert' }).catch(() => undefined);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.attached) await this.init();
    return this.wc.debugger.sendCommand(method, params) as Promise<T>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.wc.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate 실패');
    return res.result?.value as T;
  }

  /** backendNodeId 요소에서 함수 실행 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async callOn<T = any>(backendNodeId: number, fn: string): Promise<T> {
    const { object } = await this.send('DOM.resolveNode', { backendNodeId });
    const res = await this.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, returnByValue: true });
    return res.result?.value as T;
  }

  url() {
    return this.wc.getURL();
  }

  reset() {
    this.locked = false;
    this.refs.clear();
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
