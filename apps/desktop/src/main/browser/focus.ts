// 에이전트 브라우저가 키보드 포커스를 가져가지 않게 한다.
// 내장 브라우저는 앱 창 위에 겹친 별도 웹 화면이라, 뷰를 붙이거나 페이지를 불러오거나 에이전트가 클릭하면
// 그 화면이 포커스를 가져가 채팅 입력창 커서가 풀렸다. 사람이 직접 누른 경우만 포커스를 넘기고, 나머지는 원래 자리로 돌린다.
import type { WebContents } from 'electron';
import { getWindow } from '../events';

/** 에이전트 입력(CDP Input.*)이 진행 중인 화면 → 겹친 횟수 */
const agentInput = new Map<number, number>();
/** 사람이 마지막으로 누른 브라우저 화면 */
let userPick: { id: number; at: number } | null = null;
/** 사람이 쓰던 브라우저 화면 (null이면 앱 화면) */
let owner: WebContents | null = null;
let appTracked = false;

/** 에이전트가 이 화면에 입력을 보내는 동안 (그동안의 마우스 누름은 사람이 아님) */
export async function asAgent<T>(wc: WebContents, fn: () => Promise<T>): Promise<T> {
  agentInput.set(wc.id, (agentInput.get(wc.id) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    // 입력 이벤트·포커스 이벤트가 조금 늦게 올 수 있어 잠깐 더 에이전트 입력으로 본다
    setTimeout(() => {
      const n = (agentInput.get(wc.id) ?? 1) - 1;
      if (n > 0) agentInput.set(wc.id, n);
      else agentInput.delete(wc.id);
    }, 300);
  }
}

/** 이 화면이 사람 손 없이 포커스를 가져가면 사람이 쓰던 곳(보통 채팅 입력창)으로 돌려준다 */
export function guardFocus(wc: WebContents) {
  const app = getWindow();
  if (app && !appTracked) {
    appTracked = true;
    app.webContents.on('focus', () => (owner = null));
  }
  wc.on('input-event', (_e, input) => {
    if (input.type === 'mouseDown' && !agentInput.has(wc.id)) userPick = { id: wc.id, at: Date.now() };
  });
  wc.on('focus', () => {
    if (userPick?.id === wc.id && Date.now() - userPick.at < 1500) {
      owner = wc;
      return;
    }
    const win = getWindow();
    // 다른 프로그램을 쓰는 중이면 앱 창을 앞으로 끌어오지 않는다
    if (!win?.isFocused()) return;
    const back = owner && !owner.isDestroyed() ? owner : win.webContents;
    if (back === wc) return;
    // focus 이벤트 안에서 바로 돌려주면 Chromium이 포커스 이동을 마저 끝내며 다시 가져가므로 한 박자 뒤에
    setTimeout(() => {
      if (!back.isDestroyed() && !wc.isDestroyed() && wc.isFocused()) back.focus();
    }, 0);
  });
}
