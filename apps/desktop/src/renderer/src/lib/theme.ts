import { useEffect } from 'react';
import type { ThemeMode } from '@shared/types';

const CACHE_KEY = 'doldari-theme';
const query = () => window.matchMedia('(prefers-color-scheme: dark)');

/** <html>에 .dark 클래스와 color-scheme을 적용한다. 앱 화면에만 걸리고 nativeTheme은 건드리지 않는다 */
export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && query().matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** 첫 그림 전에 마지막 설정으로 적용해서 켤 때 색이 번쩍이지 않게 한다 */
export function applyCachedTheme() {
  const v = localStorage.getItem(CACHE_KEY);
  applyTheme(v === 'light' || v === 'dark' ? v : 'system');
}

/** 설정값에 맞춰 테마를 적용하고, system이면 OS 설정이 바뀔 때 바로 따라간다 */
export function useTheme(mode: ThemeMode | undefined) {
  useEffect(() => {
    if (!mode) return;
    localStorage.setItem(CACHE_KEY, mode);
    applyTheme(mode);
    if (mode !== 'system') return;
    const mq = query();
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);
}
