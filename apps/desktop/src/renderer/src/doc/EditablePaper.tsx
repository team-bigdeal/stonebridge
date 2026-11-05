// 화면에 그린 문서를 그 자리에서 고칠 수 있게 하는 틀 (고친 HTML은 hostRef로 꺼내 PDF로 저장)
import { useLayoutEffect, useRef, type RefObject } from 'react';

export function EditablePaper({ markup, hostRef }: { markup: string; hostRef: RefObject<HTMLDivElement | null> }) {
  const last = useRef('');
  // 문서 내용(기안자·결재선 등)이 바뀔 때만 다시 그린다. 그 전의 직접 수정은 유지
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host && last.current !== markup) {
      host.innerHTML = markup;
      last.current = markup;
    }
  }, [markup, hostRef]);
  return <div ref={hostRef} contentEditable suppressContentEditableWarning spellCheck={false} className="cursor-text outline-none" />;
}
