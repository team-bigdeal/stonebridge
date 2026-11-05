// 견적 상태 + 필드 확정 큐. 값이 하나 확정될 때마다 재정렬 이벤트를 내보낸다 (순위 역전 연출의 원천)
import type { Channel, FieldKey, Quote, QuoteMeta, Requirements, ReportedFields, Source, VendorId } from '@shared/types';
import { FIELD_KEYS, FIELD_LABELS, VENDOR_IDS } from '@shared/types';
import { lowestListed, rankQuotes, recompute } from '@shared/quote';
import { sleep } from '../config';
import { emit, notice } from '../events';
import { vendorName } from '../vendors';
import { normalizeField } from './normalize';

interface Pending {
  vendorId: VendorId;
  key: FieldKey;
  value: number;
  source: Source;
  answered: boolean;
}

const emptyField = () => ({ value: null, status: 'missing' as const });

function emptyQuote(vendorId: VendorId, channel: Channel): Quote {
  return {
    vendorId,
    vendorName: vendorName(vendorId),
    channel,
    listedPrice: emptyField(),
    installFee: emptyField(),
    shippingFee: emptyField(),
    warrantyMonths: emptyField(),
    warrantyExtraFee: emptyField(),
    leadTimeDays: emptyField(),
    totalPrice: null,
    missing: [],
    meta: {}
  };
}

const PRIORITY: Record<FieldKey, number> = {
  listedPrice: 0, shippingFee: 1, installFee: 2, warrantyMonths: 3, warrantyExtraFee: 4, leadTimeDays: 5
};

class QuoteStore {
  quotes: Partial<Record<VendorId, Quote>> = {};
  requirements: Requirements | null = null;
  private queue: Pending[] = [];
  private draining = false;
  private current: Pending | null = null;
  /** 표시가가 2개 이상 모이면 열린다. 그 전에는 숨은 비용을 쌓아 두었다가 비교표에서 하나씩 공개 */
  private gateOpen = false;
  onGateOpen: () => void = () => undefined;
  onDrained: () => void = () => undefined;

  /** 지난 견적을 이어서 할 때 저장된 견적을 그대로 되살린다 (비교는 이미 열린 상태) */
  restore(req: Requirements, quotes: Partial<Record<VendorId, Quote>>) {
    this.requirements = req;
    this.queue = [];
    this.gateOpen = true;
    this.quotes = {};
    for (const [id, q] of Object.entries(quotes)) {
      if (!q) continue;
      this.quotes[id as VendorId] = recompute(q, req);
      emit('quote_update', { vendorId: id as VendorId, payload: { quote: this.quotes[id as VendorId] } });
    }
  }

  reset(req: Requirements | null, ids: VendorId[] = VENDOR_IDS) {
    this.requirements = req;
    this.quotes = {};
    this.queue = [];
    this.gateOpen = false;
    if (!req) return;
    for (const id of ids) {
      this.quotes[id] = recompute(emptyQuote(id, 'web'), req);
      emit('quote_update', { vendorId: id, payload: { quote: this.quotes[id] } });
    }
  }

  /** 검색 중에 새 브라우저 자리를 열 때 (빈 견적을 만든다) */
  ensure(id: VendorId) {
    if (!this.requirements || this.quotes[id]) return;
    this.quotes[id] = recompute(emptyQuote(id, 'web'), this.requirements);
    emit('quote_update', { vendorId: id, payload: { quote: this.quotes[id] } });
  }

  renameVendor(id: VendorId, name: string) {
    const q = this.quotes[id];
    if (!q) return;
    this.quotes[id] = { ...q, vendorName: name };
    emit('quote_update', { vendorId: id, payload: { quote: this.quotes[id] } });
  }

  /** 한 업체만 비우기 (다른 업체로 교체) */
  resetOne(id: VendorId) {
    this.queue = this.queue.filter((p) => p.vendorId !== id);
    this.quotes[id] = recompute(emptyQuote(id, 'web'), this.requirements);
    emit('quote_update', { vendorId: id, payload: { quote: this.quotes[id] } });
  }

  /** 제품명·공급자·조건·추가 비용 등 숫자 외 정보 병합 */
  mergeMeta(id: VendorId, meta: QuoteMeta) {
    const q = this.quotes[id];
    if (!q) return;
    const prev = q.meta ?? {};
    const extras = [...(prev.extras ?? [])];
    for (const e of meta.extras ?? []) {
      const i = extras.findIndex((x) => x.name === e.name);
      if (i >= 0) extras[i] = e;
      else extras.push(e);
    }
    const next: QuoteMeta = {
      priceQty: meta.priceQty ?? prev.priceQty,
      statedTotal: meta.statedTotal ?? prev.statedTotal,
      productUrl: meta.productUrl ?? prev.productUrl,
      totalMismatch: 'totalMismatch' in meta ? meta.totalMismatch : prev.totalMismatch,
      // 값을 다시 받으면(재확인·재보고) 의심 표시는 새 값 기준으로: 명시적으로 넘긴 경우만 바꾼다
      priceDoubt: 'priceDoubt' in meta ? meta.priceDoubt : prev.priceDoubt,
      productName: meta.productName || prev.productName,
      spec: meta.spec || prev.spec,
      supplier: { ...prev.supplier, ...Object.fromEntries(Object.entries(meta.supplier ?? {}).filter(([, v]) => v)) },
      terms: { ...prev.terms, ...Object.fromEntries(Object.entries(meta.terms ?? {}).filter(([, v]) => v)) },
      extras,
      notes: [...new Set([...(prev.notes ?? []), ...(meta.notes ?? [])])].slice(0, 8)
    };
    this.set({ ...q, meta: next });
    emit('quote_update', { vendorId: id, payload: { quote: this.quotes[id] } });
  }

  setChannel(id: VendorId, channel: Channel) {
    const q = this.quotes[id];
    if (!q) return;
    this.quotes[id] = { ...q, channel };
    emit('quote_update', { vendorId: id, payload: { quote: this.quotes[id] } });
  }

  get(id: VendorId) {
    return this.quotes[id]!;
  }

  /** 추출 결과를 큐에 넣는다 (answered = 확인 질문에 대한 회신) */
  apply(vendorId: VendorId, fields: ReportedFields, src: { channel: Channel; ref: string }, answered = false) {
    const added: string[] = [];
    for (const key of FIELD_KEYS) {
      const f = fields[key];
      if (!f) continue;
      const n = normalizeField(key, f);
      if (!n) continue;
      const source: Source = { channel: src.channel, ref: src.ref, snippet: n.snippet, capturedAt: new Date().toISOString() };
      this.queue = this.queue.filter((p) => !(p.vendorId === vendorId && p.key === key));
      this.queue.push({ vendorId, key, value: n.value, source, answered });
      added.push(FIELD_LABELS[key]);
    }
    this.queue.sort((a, b) => PRIORITY[a.key] - PRIORITY[b.key]);
    void this.pump();
    return added;
  }

  /** 확인 질문을 보낸 필드 표시 */
  markAsked(vendorId: VendorId, keys: FieldKey[]) {
    const q = { ...this.get(vendorId) };
    for (const k of keys) if (q[k].value === null) q[k] = { ...q[k], status: 'asked' };
    this.set(q);
  }

  openGate() {
    if (this.gateOpen) return;
    this.gateOpen = true;
    this.onGateOpen();
    void this.pump();
  }

  isGateOpen() {
    return this.gateOpen;
  }

  /** 이 업체의 필드 값이 확정됐거나 반영 대기 중인지 */
  hasField(vendorId: VendorId, key: FieldKey) {
    return (
      this.quotes[vendorId]?.[key].value != null ||
      this.queue.some((p) => p.vendorId === vendorId && p.key === key) ||
      (this.current?.vendorId === vendorId && this.current.key === key)
    );
  }

  /** 이 업체의 표시가가 확정됐거나 반영 대기 중인지 */
  hasListedPrice(vendorId: VendorId) {
    return (
      this.quotes[vendorId]?.listedPrice.value != null ||
      this.queue.some((p) => p.vendorId === vendorId && p.key === 'listedPrice') ||
      (this.current?.vendorId === vendorId && this.current.key === 'listedPrice')
    );
  }

  hasPending(vendorId?: VendorId) {
    return this.queue.some((p) => !vendorId || p.vendorId === vendorId) || this.draining;
  }

  private set(q: Quote) {
    this.quotes[q.vendorId] = recompute(q, this.requirements);
  }

  private next(): Pending | undefined {
    const idx = this.gateOpen ? 0 : this.queue.findIndex((p) => p.key === 'listedPrice');
    return idx >= 0 ? this.queue.splice(idx, 1)[0] : undefined;
  }

  private async pump() {
    if (this.draining) return;
    this.draining = true;
    try {
      let item: Pending | undefined;
      while ((item = this.next())) {
        this.current = item;
        const leader = lowestListed(this.quotes);
        const before = rankQuotes(this.quotes, this.requirements);
        const q = { ...this.get(item.vendorId) };
        q[item.key] = { value: item.value, source: item.source, status: item.answered ? 'answered' : 'found' };
        this.set(q);
        const after = rankQuotes(this.quotes, this.requirements);
        emit('quote_update', { vendorId: item.vendorId, payload: { quote: this.quotes[item.vendorId], field: item.key } });
        emit('source', { vendorId: item.vendorId, payload: { ...item.source, vendorId: item.vendorId, field: item.key } });

        // 표시가 최저였던 업체의 순위가 내려가면 강조 로그
        const watch = leader ?? item.vendorId;
        const rb = before.indexOf(watch) + 1;
        const ra = after.indexOf(watch) + 1;
        if (!(item.vendorId === watch && item.key === 'listedPrice') && rb > 0 && ra > rb) {
          notice(`숨은 비용 반영: ${this.get(watch).vendorName} ${rb}위 → ${ra}위`, watch);
        }

        const listedCount = Object.values(this.quotes).filter((x) => x?.listedPrice.value !== null).length;
        if (!this.gateOpen && listedCount >= 2) {
          this.gateOpen = true;
          this.onGateOpen();
          this.queue.sort((a, b) => PRIORITY[a.key] - PRIORITY[b.key]);
        }
        // 값이 하나씩 더해지며 순위가 바뀌는 게 보이도록 간격을 둔다
        await sleep(900);
      }
    } finally {
      this.current = null;
      this.draining = false;
    }
    if (this.gateOpen && this.queue.length === 0) this.onDrained();
  }
}

export const quoteStore = new QuoteStore();
