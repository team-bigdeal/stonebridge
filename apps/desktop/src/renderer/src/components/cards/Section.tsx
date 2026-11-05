import { cn } from '@/lib/utils';

/** 카드 머리말: 제목 + 짧은 설명 + 오른쪽 영역 */
export function SectionHead({ title, hint, right, className }: { title: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold leading-tight">{title}</h3>
        {hint && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {right && <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  );
}

/** 상태 표시: 충족(ok) · 확인 필요(warn) · 문제(bad) · 보통(muted) */
export function Pill({ tone = 'muted', children, title, className }: { tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'primary'; children: React.ReactNode; title?: string; className?: string }) {
  const tones = {
    ok: 'bg-ok/12 text-ok',
    warn: 'bg-warn/12 text-warn',
    bad: 'bg-destructive/12 text-destructive',
    muted: 'bg-secondary text-muted-foreground',
    primary: 'bg-primary/15 text-primary'
  };
  return (
    <span title={title} className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none', tones[tone], className)}>
      {children}
    </span>
  );
}
