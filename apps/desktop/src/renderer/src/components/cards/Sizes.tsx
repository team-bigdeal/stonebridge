// 사이즈 조사 카드: 업체 사이트에서 모은 사이즈를 화면에 실제 크기(mm)로 그려 비교하고, 눌러서 고른다.
import { useEffect, useState } from 'react';
import { Check, Loader2, Ruler } from 'lucide-react';
import type { SizeOption, SizeScanStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { useApi, useRunStore } from '@/runScope';
import { cn } from '@/lib/utils';
import { Pill, SectionHead } from './Section';

/** 신용카드(ISO/IEC 7810 ID-1) 크기: 화면 실제 크기 맞추기 기준 */
const CARD_MM = { w: 85.6, h: 53.98 };
const STORE_KEY = 'doldari.pxPerMm';
/** 한 칸에 그릴 수 있는 최대 크기(px). 넘으면 비율대로 줄이고 "n% 축소"로 표시 */
const MAX_W = 620;
const MAX_H = 440;

/** 화면 1mm가 CSS 몇 px인지. 맞춘 값이 없으면 기기 추정값 (맥 레티나 ≈ 113ppi, 그 밖 96dpi) */
function defaultPxPerMm() {
  return (/Mac/.test(navigator.platform) ? 113 : 96) / 25.4;
}
function loadPxPerMm(): number {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { px: number; dpr: number } | null;
    // 앱 배율(⌘+/-)이 바뀌면 CSS px 크기도 바뀌므로 맞출 때의 배율로 환산한다
    if (v && v.px > 1 && v.dpr > 0) return (v.px * v.dpr) / window.devicePixelRatio;
  } catch {
    /* 저장소를 못 쓰면 추정값 */
  }
  return defaultPxPerMm();
}
function savePxPerMm(px: number) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ px, dpr: window.devicePixelRatio }));
  } catch {
    /* 무시 */
  }
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function SizesCard({ item, status, options }: { item: string; status: SizeScanStatus; options: SizeOption[] }) {
  const api = useApi();
  const { scoped } = useRunStore();
  const stage = useStore((s) => s.stage);
  const push = useStore((s) => s.push);
  const [pxPerMm, setPxPerMm] = useState(loadPxPerMm);
  const [calibrating, setCalibrating] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const canPick = !scoped && stage === 'interview';

  useEffect(() => {
    const onZoom = () => setPxPerMm(loadPxPerMm());
    window.addEventListener('resize', onZoom);
    return () => window.removeEventListener('resize', onZoom);
  }, []);

  const pick = (o: SizeOption) => {
    if (!canPick) return;
    const text = `사이즈는 ${o.label} (${fmt(o.widthMm)}×${fmt(o.heightMm)}mm)로 할게요`;
    setPicked(o.label);
    push({ id: crypto.randomUUID(), kind: 'user', text });
    void api.sendChat(text);
  };

  return (
    <div className="space-y-4 rounded-lg bg-white px-5 py-5">
      <SectionHead
        title={`"${item}" 사이즈 비교 (실제 크기)`}
        hint="업체 사이트에서 실제로 파는 사이즈를 모았어요. 화면에 실제 크기로 그렸으니 대 보고 눌러서 고르세요."
        right={
          <>
            {status === 'searching' && (
              <Pill tone="primary">
                <Loader2 className="size-3 animate-spin" /> 사이트 돌아보는 중
              </Pill>
            )}
            {status === 'done' && <Pill tone="ok">{options.length}종 모음</Pill>}
            {(status === 'failed' || status === 'stopped') && !options.length && <Pill>찾지 못함</Pill>}
            <Button size="sm" variant="ghost" onClick={() => setCalibrating((v) => !v)} title="신용카드를 화면에 대고 크기를 맞춰요">
              <Ruler className="size-3.5" /> 실제 크기 맞추기
            </Button>
          </>
        }
      />

      {calibrating && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/60 p-4">
          <div
            className="shrink-0 rounded-[3mm] border-2 border-primary bg-tint"
            style={{ width: CARD_MM.w * pxPerMm, height: CARD_MM.h * pxPerMm }}
            aria-label="신용카드 크기 상자"
          />
          <div className="min-w-[220px] flex-1 space-y-2 text-[13px] text-muted-foreground">
            <p>신용카드나 체크카드를 화면의 파란 상자에 대 보고, 크기가 같아지도록 막대를 움직여 주세요.</p>
            <input
              type="range"
              min={2}
              max={8}
              step={0.01}
              value={pxPerMm}
              onChange={(e) => setPxPerMm(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
              aria-label="화면 크기 맞추기"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  savePxPerMm(pxPerMm);
                  setCalibrating(false);
                }}
              >
                <Check className="size-3.5" /> 이 크기로 저장
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPxPerMm(defaultPxPerMm())}>
                기본값
              </Button>
            </div>
          </div>
        </div>
      )}

      {options.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-muted-foreground">
          {status === 'searching' ? '업체 사이트에서 사이즈를 찾고 있어요. 찾는 대로 여기에 실제 크기로 보여 드릴게요.' : '사이즈 선택지를 찾지 못했어요. 원하는 크기를 채팅으로 말씀해 주세요.'}
        </p>
      ) : (
        <SizeCompare options={options} pxPerMm={pxPerMm} picked={picked} canPick={canPick} onPick={pick} />
      )}
    </div>
  );
}

/** 모든 사이즈를 왼쪽 아래 모서리에 맞춰 실제 크기로 겹쳐 그린다. 오른쪽 목록에 올리면 그 윤곽이 강조되고, 누르면 고른다 */
function SizeCompare({ options, pxPerMm, picked, canPick, onPick }: { options: SizeOption[]; pxPerMm: number; picked: string | null; canPick: boolean; onPick: (o: SizeOption) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const maxW = Math.max(...options.map((o) => o.widthMm)) * pxPerMm;
  const maxH = Math.max(...options.map((o) => o.heightMm)) * pxPerMm;
  const scale = Math.min(1, MAX_W / maxW, MAX_H / maxH);
  const active = hover ?? options.findIndex((o) => o.label === picked);
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="shrink-0 space-y-2">
        <div className="relative" style={{ width: maxW * scale, height: maxH * scale }}>
          {options.map((o, i) => {
            const on = i === active;
            return (
              <div
                key={`${o.widthMm}x${o.heightMm}`}
                className={cn('absolute bottom-0 left-0 rounded-[2px] border transition-colors duration-200', on ? 'z-10 border-2 border-primary bg-primary/10' : 'border-dashed border-foreground/25')}
                style={{ width: o.widthMm * pxPerMm * scale, height: o.heightMm * pxPerMm * scale }}
              >
                {on && (
                  <span className="absolute right-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">
                    {fmt(o.widthMm)}×{fmt(o.heightMm)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-muted-foreground">{scale < 1 ? `화면에 다 들어가도록 ${Math.round(scale * 100)}%로 줄였어요` : '실제 크기예요 (모서리를 맞춰 겹쳐 그림)'}</p>
      </div>
      <ul className="min-w-[260px] flex-1 space-y-1.5">
        {options.map((o, i) => {
          const chosen = picked === o.label;
          return (
            <li key={`${o.widthMm}x${o.heightMm}`}>
              <button
                type="button"
                disabled={!canPick}
                onClick={() => onPick(o)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  chosen ? 'border-primary bg-tint' : i === active ? 'border-primary/40 bg-muted/50' : 'border-transparent hover:bg-muted/50',
                  !canPick && 'cursor-default'
                )}
              >
                <span className="w-[92px] shrink-0 text-[14px] font-semibold tabular-nums text-black">
                  {fmt(o.widthMm)}×{fmt(o.heightMm)}
                </span>
                <span className="min-w-0 flex-1">
                  {o.label.replace(/[\s×xX*mm]/g, '') !== `${fmt(o.widthMm)}${fmt(o.heightMm)}` && <span className="block truncate text-[13px] text-black">{o.label}</span>}
                  <span className="block truncate text-[12px] text-muted-foreground" title={o.vendors.map((v) => v.name).join(', ')}>
                    {o.vendors.length > 1 ? `${o.vendors[0].name} 외 ${o.vendors.length - 1}곳` : o.vendors[0]?.name}
                    {o.note ? ` · ${o.note}` : ''}
                  </span>
                </span>
                {o.vendors.length > 1 && <Pill tone="primary">{o.vendors.length}곳</Pill>}
                {chosen && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
