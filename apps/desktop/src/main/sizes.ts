// 사이즈 조사: 사용자가 사이즈를 잘 모를 때, 브라우저 1개가 업체 사이트 2~3곳을 돌며 파는 사이즈를 모은다.
// 모은 사이즈는 대화 카드에 실제 크기(mm)로 그려지고, 사용자가 누르면 그 사이즈로 조건이 정해진다.
import { randomUUID } from 'node:crypto';
import type { SizeOption, SizeScanStatus, SizesEventPayload, VendorId } from '@shared/types';
import { runAgent } from './agent/loop';
import { getDriver } from './browser';
import { emit, setVendorStatus, timeline } from './events';
import { scoped } from './session';

const SLOT: VendorId = 'A';

const H = scoped(() => ({ current: null as { id: string; item: string; status: SizeScanStatus; options: SizeOption[]; aborted: boolean } | null }));

/** 같은 사이즈 판단: 0.5mm 단위, 가로·세로 순서 무시 */
const key = (w: number, h: number) => [Math.round(w * 2) / 2, Math.round(h * 2) / 2].sort((a, b) => b - a).join('x');

function publish() {
  if (!H.current) return;
  emit('sizes', { payload: { id: H.current.id, status: H.current.status, options: H.current.options } satisfies SizesEventPayload });
}

function merge(list: { label: string; widthMm: number; heightMm: number; vendor: string; url: string; note?: string }[]) {
  if (!H.current) return 0;
  for (const s of list) {
    const k = key(s.widthMm, s.heightMm);
    const hit = H.current.options.find((o) => key(o.widthMm, o.heightMm) === k);
    const vendor = { name: s.vendor || (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return '업체'; } })(), url: s.url };
    if (hit) {
      if (!hit.vendors.some((v) => v.name === vendor.name)) hit.vendors.push(vendor);
      if (!hit.note && s.note) hit.note = s.note;
    } else {
      H.current.options.push({ label: s.label || `${s.widthMm}×${s.heightMm}`, widthMm: s.widthMm, heightMm: s.heightMm, vendors: [vendor], note: s.note });
    }
  }
  // 여러 업체가 파는 사이즈가 앞으로
  H.current.options.sort((a, b) => b.vendors.length - a.vendors.length);
  H.current.options = H.current.options.slice(0, 12);
  publish();
  return H.current.options.length;
}

export const sizeScanRunning = () => Boolean(H.current && H.current.status === 'searching');
export const sizeScanStarted = () => Boolean(H.current);

/** 사이즈 조사 시작 (이미 했으면 다시 하지 않는다) */
export async function startSizeScan(item: string, onDone: (options: SizeOption[]) => void) {
  if (H.current) return;
  const id = randomUUID();
  H.current = { id, item, status: 'searching', options: [], aborted: false };
  const me = H.current;
  // 작은 조사 브라우저를 먼저, 그 아래에 사이즈 선택 카드
  timeline({ kind: 'browser', slot: SLOT, title: `"${item}" 사이즈 조사`, compact: true });
  emit('timeline', { payload: { id, kind: 'sizes', item, status: 'searching', options: [] } });
  setVendorStatus(SLOT, 'browsing');
  const driver = getDriver(SLOT);
  driver.locked = false;
  try {
    await runAgent(
      { slot: SLOT, driver, onSizes: (list) => (me === H.current ? merge(list) : 0) },
      {
        system: `너는 견적 탐색 앱 '돌다리'의 조사 브라우저다. 사용자가 "${item}"을(를) 맞추려는데 어떤 사이즈가 있는지 잘 모른다.
업체 사이트 2~3곳(전문 인쇄·제작 쇼핑몰 우선)을 돌며 실제로 파는 사이즈 선택지를 모아 report_sizes로 보고한다.
- search_web으로 "${item} 사이즈" 또는 "${item} 주문" 같이 검색해 상품 페이지·사이즈 안내 페이지를 연다.
- 사이즈 드롭다운·옵션·안내 표에 적힌 규격을 가로×세로 mm로 옮긴다. "A4" 같은 이름만 있으면 표준 크기(A4=210×297)로 적는다. cm는 mm로 바꾼다.
- 사이트마다 대표 사이즈 3~8개면 충분하다. 가격이 같이 보이면 note에 짧게 적는다.
- 같은 사이트를 오래 보지 말고, 2~3곳을 보면 report_sizes(done=true)로 끝낸다. 결제·회원가입·로그인은 하지 않는다.
모든 도구의 intent는 사용자에게 보여 줄 한국어 한 줄로 적는다.`,
        goal: `"${item}"의 사이즈 선택지를 업체 사이트 2~3곳에서 모아 report_sizes로 보고해 줘.`,
        tools: ['search_web', 'navigate', 'read_text', 'find_in_page', 'snapshot', 'click', 'select_option', 'expand_all', 'report_sizes'],
        maxSteps: 20,
        signal: { get aborted() { return me.aborted; } }
      }
    );
    if (me.aborted) return;
    me.status = me.options.length ? 'done' : 'failed';
  } catch (e) {
    if (me.aborted) return;
    console.log(`[sizes] 사이즈 조사 실패: ${e instanceof Error ? e.message : String(e)}`);
    me.status = me.options.length ? 'done' : 'failed';
  }
  setVendorStatus(SLOT, 'idle');
  publish();
  onDone(me.options);
}

/** 검색 시작·새 견적 때 조사를 멈춘다 */
export function stopSizeScan(reset = false) {
  if (H.current && H.current.status === 'searching') {
    H.current.aborted = true;
    H.current.status = H.current.options.length ? 'done' : 'stopped';
    publish();
    setVendorStatus(SLOT, 'idle');
  }
  if (reset) H.current = null;
}
