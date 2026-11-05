import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';

/** 숫자가 바뀌면 이전 값에서 카운트업 */
export default function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const controls = animate(prev.current, value, { duration: 0.8, ease: 'easeOut', onUpdate: (v) => setShown(Math.round(v)) });
    prev.current = value;
    return () => controls.stop();
  }, [value]);
  return <>{shown.toLocaleString('ko-KR')}원</>;
}
