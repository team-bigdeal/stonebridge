import { useEffect, useState } from 'react';
import { FileText, History, Trash2 } from 'lucide-react';
import type { HistoryRecord, HistorySummary, Quote } from '@shared/types';
import { confirmedSum, productAmount } from '@shared/quote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStore, VENDOR_DOT } from '@/store';
import { cn } from '@/lib/utils';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const CHANNEL = { web: '웹', mail: '메일', file: '파일' } as const;

/** 왼쪽 사이드 탭: 지난 견적 목록. 누르면 상세 창이 열린다 */
export function HistorySidebar() {
  const { sidebarOpen, historyRev, historyRecord, set } = useStore();
  const [list, setList] = useState<HistorySummary[] | null>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    void window.doldari.historyList().then(setList);
  }, [sidebarOpen, historyRev]);

  if (!sidebarOpen) return null;
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex h-10 items-center gap-2 px-3 text-[12px] font-semibold text-muted-foreground">
        <History className="size-3.5" /> 히스토리
        {list && list.length > 0 && <span className="font-normal">{list.length}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {list === null ? (
          <div className="px-2 py-3 text-[12px] text-muted-foreground">불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="px-2 py-3 text-[12px] leading-relaxed text-muted-foreground">아직 저장된 견적이 없어요. 견적 비교가 끝나면 여기에 자동으로 쌓여요.</div>
        ) : (
          <ul className="space-y-0.5">
            {list.map((h) => (
              <li key={h.id} className="group relative">
                <button
                  type="button"
                  className={cn('w-full rounded-md px-2.5 py-2 text-left hover:bg-accent', historyRecord?.id === h.id && 'bg-accent')}
                  onClick={async () => set({ historyRecord: await window.doldari.historyGet(h.id) })}
                >
                  <div className="truncate pr-6 text-[13px] font-medium">{h.item}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{when(h.updatedAt)}</span>
                    <span>·</span>
                    <span>{h.quantity.toLocaleString('ko-KR')}개</span>
                    <span>·</span>
                    <span>{h.pricedCount}/{h.vendorCount}곳</span>
                  </div>
                  {h.best && (
                    <div className="mt-0.5 truncate text-[11px]">
                      <span className="text-muted-foreground">추천 {h.best.name} </span>
                      <span className="font-semibold text-primary">{won(h.best.total)}</span>
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  title="이 기록 삭제"
                  className="absolute right-1.5 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
                  onClick={async () => {
                    if (!confirm(`"${h.item}" 견적 기록을 삭제할까요?`)) return;
                    await window.doldari.historyDelete(h.id);
                    if (historyRecord?.id === h.id) set({ historyRecord: null });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** 히스토리에서 고른 견적 한 건 */
export function HistoryDetail() {
  const { historyRecord: record, set } = useStore();
  if (!record) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && set({ historyRecord: null })}>
      <DialogContent className="flex max-h-[86vh] max-w-[860px] flex-col gap-3 sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>{record.requirements.item} · {record.requirements.quantity.toLocaleString('ko-KR')}개</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RecordDetail record={record} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordDetail({ record }: { record: HistoryRecord }) {
  const set = useStore((s) => s.set);
  const r = record.requirements;
  const rows = record.vendors.map((v) => ({ v, q: record.quotes[v.id] as Quote | undefined }));
  const rec = record.recommendation;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/30 p-3 text-[13px] sm:grid-cols-4">
        <div><span className="text-muted-foreground">예산 </span>{won(r.budgetMax)} 이하</div>
        <div><span className="text-muted-foreground">납기 </span>{r.deadline}까지</div>
        <div><span className="text-muted-foreground">설치 </span>{r.needInstall ? '필요' : '불필요'}</div>
        <div><span className="text-muted-foreground">지역 </span>{r.region || '—'}</div>
        <div className="col-span-full text-[12px] text-muted-foreground">견적 일시 {new Date(record.createdAt).toLocaleString('ko-KR')} · 마지막 갱신 {new Date(record.updatedAt).toLocaleString('ko-KR')}</div>
      </div>

      <table className="w-full text-[13px]">
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left font-medium">업체</th>
            <th className="px-2 py-1 text-right font-medium">제품 금액</th>
            <th className="px-2 py-1 text-right font-medium">합계</th>
            <th className="px-2 py-1 text-right font-medium">납기</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ v, q }) => {
            const amount = q ? productAmount(q, r) : null;
            return (
              <tr key={v.id} className={cn('border-t', rec?.vendorId === v.id && 'bg-primary/10')}>
                <td className="px-2 py-2">
                  <span className={cn('mr-1.5 inline-block size-2 rounded-full', VENDOR_DOT[v.id])} />
                  <span className="font-semibold">{v.name}</span>
                  {q && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">{CHANNEL[q.channel]}</Badge>}
                  {rec?.vendorId === v.id && <Badge className="ml-1.5 h-4 px-1 text-[10px]">추천</Badge>}
                </td>
                <td className="px-2 text-right">{amount !== null ? won(amount) : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-2 text-right font-semibold">{q && amount !== null ? won(q.totalPrice ?? confirmedSum(q, r)) : '—'}{q && q.totalPrice === null && amount !== null && <span className="ml-0.5 text-orange-400">?</span>}</td>
                <td className="px-2 text-right">{q?.leadTimeDays.value != null ? `${q.leadTimeDays.value}일` : '—'}</td>
                <td className="px-2 text-right">
                  {q && amount !== null && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => set({ viewer: { kind: 'vendor', id: v.id, record } })}>
                      <FileText className="size-3.5" /> 견적서
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rec && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-[13px]">
          <div className="mb-1 font-semibold">{rec.vendorName ? `추천: ${rec.vendorName}${rec.total !== undefined ? ` · ${won(rec.total)}` : ''}` : '조건을 만족하는 업체 없음'}</div>
          <ul className="text-muted-foreground">{rec.reasons.map((x) => <li key={x}>· {x}</li>)}</ul>
        </div>
      )}

      <Button onClick={() => set({ viewer: { kind: 'integrated', record } })}>
        <FileText className="size-4" /> 통합 견적서 보기
      </Button>
    </div>
  );
}
