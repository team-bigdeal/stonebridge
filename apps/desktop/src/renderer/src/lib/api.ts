// window.doldari 래퍼. 히스토리에서 지난 견적을 보는 중(replay)에는 지금 진행 중인 main 상태를 바꾸는 호출을 막는다.
// contextBridge 객체는 얼어 있어서(frozen) 직접 바꾸거나 Proxy로 감쌀 수 없으니, 같은 모양의 새 객체를 만든다.
import { useStore } from '@/store';

type Api = typeof window.doldari;

const MUTATING = new Set<string>([
  'sendChat', 'uploadFile', 'sendMail', 'openMailApp', 'pasteReply', 'draftOrder', 'draftQuestion',
  'retry', 'replace', 'skip', 'resume', 'browserInput', 'browserBack'
]);

function blocked() {
  useStore.getState().handle({
    type: 'notice',
    at: new Date().toISOString(),
    message: '지난 견적은 보기 전용이에요. 이어서 하려면 "현재 견적으로" 돌아가거나 새 견적을 시작하세요.'
  });
  return Promise.resolve(null);
}

export const api = Object.fromEntries(
  Object.entries(window.doldari).map(([key, fn]) => [
    key,
    typeof fn === 'function' && MUTATING.has(key)
      ? (...args: unknown[]) => (useStore.getState().replay ? blocked() : (fn as (...a: unknown[]) => unknown)(...args))
      : fn
  ])
) as Api;
