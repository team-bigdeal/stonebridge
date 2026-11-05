import { useEffect, useState } from 'react';
import { ArrowLeft, History, Plus, Trash2 } from 'lucide-react';
import type { HistorySummary } from '@shared/types';
import { saveSidebar, saveWidth, SIDEBAR_WIDTH, useStore } from '@/store';
import { ResizeHandle } from './ResizeHandle';
import { NARROW_WIDTH, useViewportWidth } from '@/lib/useNarrow';
import { cn } from '@/lib/utils';
import { Pill } from './cards/Section';
import { exitReplay, openReplay } from '@/replay';
import { SidebarToggle, useRestart } from './Shell';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
/** 오늘/어제는 "오늘 16:45", 그 전은 "11. 3." */
const when = (iso: string) => {
  const d = new Date(iso);
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86_400_000);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 0) return `오늘 ${time}`;
  if (diff === 1) return `어제 ${time}`;
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
};

/** 왼쪽 사이드 탭: 지난 견적 목록. 누르면 그 견적 세션(대화·브라우저·비교표)이 그대로 다시 뜬다 */
export function HistorySidebar() {
  const { sidebarOpen, historyRev, replay, liveId, sidebarWidth, set } = useStore();
  const active = replay?.id ?? liveId;
  const restart = useRestart();
  const [list, setList] = useState<HistorySummary[] | null>(null);
  const [closing, setClosing] = useState(false);
  const viewport = useViewportWidth();
  const narrow = viewport < NARROW_WIDTH;
  // 좁은 창으로 바뀌면 일단 닫는다 (열면 대화 위에 겹쳐 뜸). 저장한 열림 상태는 바꾸지 않는다
  useEffect(() => {
    if (narrow) set({ sidebarOpen: false });
  }, [narrow, set]);

  useEffect(() => {
    if (!sidebarOpen) return;
    void window.doldari.historyList().then(setList);
  }, [sidebarOpen, historyRev]);

  if (!sidebarOpen) return null;
  const close = () => set({ sidebarOpen: false });
  return (
    <>
    {/* 좁은 창: 바깥을 누르면 닫힘 */}
    {narrow && <div className="absolute inset-0 z-20 bg-black/20 animate-in fade-in-0" onClick={close} aria-hidden />}
    <aside
      className={cn(
        'flex shrink-0 animate-in flex-col border-r bg-card transition-opacity fade-in-0 slide-in-from-left-3 duration-200 ease-out motion-reduce:animate-none',
        narrow ? 'absolute inset-y-0 left-0 z-30 shadow-xl' : 'relative',
        closing && 'opacity-40'
      )}
      style={{ width: sidebarWidth }}
    >
      <ResizeHandle
        side="right"
        label="지난 견적 너비 조절"
        width={sidebarWidth}
        range={SIDEBAR_WIDTH}
        onResize={(w) => set({ sidebarWidth: w })}
        onDone={(w) => saveWidth('doldari.sidebarWidth', w)}
        onClosing={setClosing}
        onClose={() => {
          saveSidebar(false);
          set({ sidebarOpen: false });
        }}
      />
      {/* 새 견적 버튼 + 사이드바 닫기 */}
      <div className="flex items-center gap-1.5 pl-3 pr-2 pt-3">
        <button
          type="button"
          onClick={() => void restart()}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-[14px] font-medium text-primary hover:bg-primary/20"
        >
          <Plus className="size-4" /> 새 견적 추가하기
        </button>
        {/* 새 견적 버튼과 같은 높이로 */}
        <SidebarToggle className="size-10 rounded-lg hover:bg-muted" />
      </div>
      <div className="flex h-12 items-center gap-2 pl-5 pr-3 text-[14px] font-semibold text-ink">
        <History className="size-4 text-muted-foreground" /> 지난 견적
        {list && list.length > 0 && <span className="tabular-nums text-muted-foreground">{list.length}</span>}
      </div>
      {replay && (
        <button type="button" onClick={exitReplay} className="mx-3 mb-2 flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-[13px] font-medium text-primary hover:bg-primary/20">
          <ArrowLeft className="size-3.5" /> 현재 견적으로 돌아가기
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {list === null ? (
          <div className="px-2 py-3 text-[13px] text-muted-foreground">불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="px-2 py-3 text-[13px] leading-relaxed text-muted-foreground">아직 저장된 견적이 없어요. 견적 비교가 끝나면 여기에 자동으로 쌓여요.</div>
        ) : (
          <ul className="space-y-1">
            {list.map((h) => (
              <li key={h.id} className="group relative">
                <button
                  type="button"
                  className={cn('w-full rounded-lg px-3 py-2.5 text-left hover:bg-background', active === h.id && 'bg-secondary hover:bg-secondary')}
                  onClick={() => void openReplay(h.id)}
                  title={h.best ? `${h.item} · 추천 ${h.best.name} ${won(h.best.total)}` : h.item}
                >
                  {/* 1줄: 품목 + 추천 금액 / 2줄: 언제 · 수량 */}
                  <div className="flex items-baseline gap-2 pr-6">
                    <span className={cn('min-w-0 flex-1 truncate text-[14px] font-medium', active === h.id ? 'text-primary' : 'text-ink')}>
                      {h.id === liveId && <Pill tone="primary" className="mr-1.5">진행 중</Pill>}
                      {h.item}
                    </span>
                    {h.best && <span className="shrink-0 text-[12px] font-semibold tabular-nums text-ink">{won(h.best.total)}</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    {when(h.updatedAt)} · {h.quantity.toLocaleString('ko-KR')}개
                  </div>
                </button>
                <button
                  type="button"
                  title="이 기록 삭제"
                  aria-label={`${h.item} 견적 기록 삭제`}
                  className="absolute right-1.5 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-card hover:text-destructive group-hover:opacity-100"
                  onClick={async () => {
                    // 같은 품목 기록이 여러 개일 수 있어 언제 기록인지도 적는다
                    const at = new Date(h.updatedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    if (!confirm(`${at}에 저장한 "${h.item}" 견적 기록을 삭제할까요?`)) return;
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
    </>
  );
}
