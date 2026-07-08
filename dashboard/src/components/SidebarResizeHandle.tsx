import { useCallback, useRef } from 'react';
import type { PointerEvent } from 'react';

interface SidebarResizeHandleProps {
  pct: number;
  min: number;
  max: number;
  onChange: (pct: number) => void;
  onCommit: (pct: number) => void;
}

export default function SidebarResizeHandle({ pct, min, max, onChange, onCommit }: SidebarResizeHandleProps) {
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = Math.min(max, Math.max(min, (e.clientX / window.innerWidth) * 100));
    onChange(next);
  }, [onChange, min, max]);

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(pct);
  }, [onCommit, pct]);

  return (
    <div
      className="sidebar-resize-handle"
      style={{ left: `${pct}vw` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="اسحب لتغيير عرض الشريط الجانبي"
    />
  );
}
