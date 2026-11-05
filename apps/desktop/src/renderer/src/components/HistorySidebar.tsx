import { useEffect, useState } from 'react';
import { ArrowLeft, History, Trash2 } from 'lucide-react';
import type { HistorySummary } from '@shared/types';
import { useStore } from '@/store';
import { cn } from '@/lib/utils';
import { Pill } from './cards/Section';
import { exitReplay, openReplay } from '@/replay';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 왼쪽 사이드 탭: 지난 견적 목록. 누르면 그 견적 세션(대화·브라우저·비교표)이 그대로 다시 뜬다 */
export function HistorySidebar() {
  const { sidebarOpen, historyRev, replay, liveId } = useStore();
  const active = replay?.id ?? liveId;
  const [list, setList] = useState<HistorySummary[] | null>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    void window.doldari.historyList().then(setList);
  }, [sidebarOpen, historyRev]);

  if (!sidebarOpen) return null;
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex h-11 items-center gap-2 px-4 text-[13px] font-medium">
        <History className="size-4 text-muted-foreground" /> 지난 견적
        {list && list.length > 0 && <span className="tabular-nums text-muted-foreground">{list.length}</span>}
      </div>
      {replay && (
        <button type="button" onClick={exitReplay} className="mx-2 mb-2 flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-2 text-[12px] font-medium hover:bg-accent">
          <ArrowLeft className="size-3.5" /> 현재 견적으로 돌아가기
        </button>
      )}
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
                  className={cn('w-full rounded-md px-2.5 py-2 text-left hover:bg-accent', active === h.id && 'bg-accent')}
                  onClick={() => void openReplay(h.id)}
                >
                  <div className="truncate pr-6 text-[13px] font-medium">
                    {h.id === liveId && <Pill tone="primary" className="mr-1.5">진행 중</Pill>}
                    {h.item}
                  </div>
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
                      <span className="font-medium tabular-nums text-foreground">{won(h.best.total)}</span>
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  title="이 기록 삭제"
                  className="absolute right-1.5 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
                  onClick={async () => {
                    if (!confirm(`"${h.item}" 견적 기록을 삭제할까요?`)) return;
                    if (replay?.id === h.id) exitReplay();
                    await window.doldari.historyDelete(h.id);
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
