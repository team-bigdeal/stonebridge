// 대화 안에 남아 있는 "이전 검색" 카드용 범위.
// 조건을 바꾸면 그 전 검색의 상태를 RunSnapshot으로 얼려 두고, 그 검색에 속한 카드는
// RunContext 안에서 그 스냅샷 값으로 그린다. 이전 검색 카드는 보기 전용(진행 버튼은 막힘).
import { createContext, useContext } from 'react';
import type { RunSnapshot } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/store';

export const RunContext = createContext<RunSnapshot | null>(null);

type State = ReturnType<typeof useStore.getState>;

/** 이 카드가 이전 검색에 속하면 그 스냅샷, 아니면 지금 상태. scoped=true면 보기 전용 */
export function useRunStore(): State & { scoped: boolean } {
  const live = useStore();
  const scope = useContext(RunContext);
  if (!scope) return { ...live, scoped: false };
  return {
    ...live,
    ...scope,
    reqReady: false,
    busy: false,
    flash: null,
    scoped: true,
    // 이전 검색 카드에서 연 견적서는 그 검색의 값으로 보여 준다
    set: (p) => live.set(p.viewer ? { ...p, viewer: { ...p.viewer, scope } } : p)
  };
}

/** 선택자 버전 (훅 규칙상 useStore는 항상 부른다) */
export function useRunSel<T>(sel: (s: State) => T): T {
  const live = useStore(sel);
  const scope = useContext(RunContext);
  return scope ? sel({ ...useStore.getState(), ...scope }) : live;
}

const BLOCKED_MSG = '이전 검색 카드는 보기 전용이에요. 지금 검색에서 진행해 주세요.';
const blockedApi = Object.fromEntries(
  Object.entries(api).map(([k, fn]) => [
    k,
    typeof fn === 'function' && /^(sendChat|uploadFile|sendMail|openMailApp|pasteReply|draftOrder|draftQuestion|retry|replace|skip|resume|browserInput|browserBack|startSearch|revise)$/.test(k)
      ? () => {
          useStore.getState().handle({ type: 'notice', at: new Date().toISOString(), message: BLOCKED_MSG });
          return Promise.resolve(null);
        }
      : fn
  ])
) as typeof api;

/** 이전 검색 카드에서는 진행 호출을 막은 api */
export function useApi() {
  return useContext(RunContext) ? blockedApi : api;
}
