import { useEffect, useState } from 'react';

/** 창 너비가 이보다 좁으면 지난 견적 사이드바를 대화 위에 겹쳐 연다 (대화가 너무 좁아지지 않게) */
export const NARROW_WIDTH = 1280;

/** 지금 창 너비 (창 크기를 바꾸면 다시 그림) */
export function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export const useNarrow = () => useViewportWidth() < NARROW_WIDTH;
