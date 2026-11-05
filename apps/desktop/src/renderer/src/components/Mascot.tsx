import mascot from '@/assets/figma/mascot.svg';
import { cn } from '@/lib/utils';

/** 돌다리 캐릭터 (파란 칸 안 구름 얼굴). 크기는 size로 */
export function Mascot({ size = 47, className }: { size?: number; className?: string }) {
  return <img src={mascot} alt="" aria-hidden width={size} height={size} className={cn('shrink-0 select-none', className)} draggable={false} />;
}
