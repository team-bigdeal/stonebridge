// 받은 원본(웹 화면·메일 회신·견적서 파일) 목록: main 히스토리와 renderer가 같은 규칙으로 보관하고 보여 준다
import type { Quote, QuoteOriginal } from './types';

/** 업체마다 보관하는 원본 수 */
export const MAX_ORIGINALS = 4;

/** 원본 종류 이름 (원본 탭의 이름표) */
export function originalLabel(o: QuoteOriginal): string {
  if (o.channel === 'web') return '웹 화면';
  if (o.channel === 'mail') return '메일 회신';
  if (o.mime === 'application/pdf') return '견적서 PDF';
  if (o.mime?.startsWith('image/')) return '견적서 사진';
  return o.fileData ? '견적서 파일' : '받은 답장';
}

/** 원본 하나를 넣는다. 같은 원본(id)·같은 웹 화면(주소)은 바꿔 끼우고,
 *  넘치면 웹 화면 캡처부터 오래된 것을 버린다 (받은 견적서·메일은 웹 화면에 밀려나지 않게) */
export function addOriginal(list: QuoteOriginal[], o: QuoteOriginal, max = MAX_ORIGINALS): QuoteOriginal[] {
  const same = (x: QuoteOriginal) => x.id === o.id || (o.channel === 'web' && x.channel === 'web' && Boolean(o.url) && x.url === o.url);
  const next = [...list.filter((x) => !same(x)), o];
  while (next.length > max) {
    const web = next.findIndex((x, i) => x.channel === 'web' && i < next.length - 1);
    next.splice(web >= 0 ? web : 0, 1);
  }
  return next;
}

/** 원본 탭 순서: 견적 값(표시가)을 뽑은 원본 → 받은 문서(견적서·메일) → 웹 화면. 같은 순위면 최근 것부터.
 *  표시가를 웹 화면에서 읽었을 때만 웹 화면이 먼저 온다 */
export function orderOriginals(list: QuoteOriginal[], q?: Quote | null): QuoteOriginal[] {
  const src = q?.listedPrice.source;
  const fromWeb = src?.channel === 'web';
  const rank = (o: QuoteOriginal) => {
    if (src?.ref && (o.ref === src.ref || o.fileName === src.ref || (o.channel === src.channel && o.url === src.ref))) return 0;
    return o.channel === 'web' ? (fromWeb ? 1 : 2) : fromWeb ? 2 : 1;
  };
  return list
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || b.i - a.i)
    .map((x) => x.o);
}
