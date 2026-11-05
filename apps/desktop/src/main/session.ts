// 견적 세션: 여러 견적을 동시에 돌리기 위해 상태를 세션마다 따로 둔다.
// 지금 실행 중인 코드가 어느 세션 것인지는 AsyncLocalStorage로 들고 다닌다 (await·타이머를 지나도 이어짐).
// 화면(renderer)에서 온 조작은 화면이 보고 있는 세션(focused)에서 실행한다.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const als = new AsyncLocalStorage<string>();
const newId = () => randomUUID().slice(0, 8);

let focused = newId();
const alive = new Set<string>([focused]);

/** 컨텍스트 밖(앱 시작·창 이벤트 등)에서는 화면이 보고 있는 세션 */
export const currentSid = () => als.getStore() ?? focused;
export const focusedSid = () => focused;
export const withSession = <T>(sid: string, fn: () => T): T => als.run(sid, fn);
/** 지금 세션 id를 잡아 두었다가 나중에 같은 세션에서 실행 (메일 폴링 콜백처럼 컨텍스트가 끊기는 곳) */
export function bindSession<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const sid = currentSid();
  return (...a) => als.run(sid, () => fn(...a));
}

export function newSession() {
  const sid = newId();
  alive.add(sid);
  return sid;
}
export const isAlive = (sid: string) => alive.has(sid);
export const sessions = () => [...alive];
export function setFocused(sid: string) {
  if (alive.has(sid)) focused = sid;
}

const stores: Map<string, unknown>[] = [];
const disposers: ((sid: string) => void)[] = [];

/** 세션마다 따로 만드는 값. 반환 함수를 부르면 지금 세션의 값 */
export function perSession<T>(init: () => T): () => T {
  const m = new Map<string, T>();
  stores.push(m);
  return () => {
    const sid = currentSid();
    let v = m.get(sid);
    if (v === undefined) m.set(sid, (v = init()));
    return v;
  };
}

/** perSession 값을 객체처럼 쓰는 대리 객체 (Map·Set·상태 묶음). 속성·메서드는 지금 세션의 값으로 넘긴다 */
export function scoped<T extends object>(init: () => T): T {
  const get = perSession(init);
  return new Proxy({} as T, {
    get(_t, k) {
      const target = get() as Record<string | symbol, unknown>;
      const v = Reflect.get(target, k, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set(_t, k, v) {
      return Reflect.set(get() as object, k, v);
    },
    has(_t, k) {
      return Reflect.has(get() as object, k);
    },
    deleteProperty(_t, k) {
      return Reflect.deleteProperty(get() as object, k);
    },
    ownKeys() {
      return Reflect.ownKeys(get() as object);
    },
    getOwnPropertyDescriptor(_t, k) {
      const d = Reflect.getOwnPropertyDescriptor(get() as object, k);
      return d && { ...d, configurable: true };
    }
  });
}

/** 세션을 없앨 때 같이 정리할 일 (브라우저 닫기 등) */
export const onDispose = (fn: (sid: string) => void) => disposers.push(fn);

export function disposeSession(sid: string) {
  if (sid === focused || !alive.delete(sid)) return;
  for (const fn of disposers) fn(sid);
  for (const m of stores) m.delete(sid);
}
