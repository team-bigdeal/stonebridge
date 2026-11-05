import { cn } from '@/lib/utils';

/** 카드 머리말: 제목 + 짧은 설명 + 오른쪽 영역 */
export function SectionHead({ title, hint, right, className }: { title: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold leading-tight text-ink">{title}</h3>
        {hint && <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {right && <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  );
}

/** 상태 표시: 충족(ok) · 확인 필요(warn) · 문제(bad) · 보통(muted) · 강조(primary) */
export function Pill({ tone = 'muted', children, title, className }: { tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'primary'; children: React.ReactNode; title?: string; className?: string }) {
  const tones = {
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-warn/10 text-warn',
    bad: 'bg-destructive/10 text-destructive',
    muted: 'bg-muted text-muted-foreground',
    primary: 'bg-tint text-primary'
  };
  return (
    <span title={title} className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium leading-none', tones[tone], className)}>
      {children}
    </span>
  );
}
