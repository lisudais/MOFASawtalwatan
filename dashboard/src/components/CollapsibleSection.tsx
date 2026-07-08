import { useState, useRef, useCallback } from 'react';
import type { ReactNode, PointerEvent } from 'react';

interface CollapsibleSectionProps {
  icon: ReactNode;
  titleEn: string;
  titleAr: string;
  badge?: ReactNode;
  children: ReactNode;
}

const DEFAULT_HEIGHT = 380;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 900;

export default function CollapsibleSection({ icon, titleEn, titleAr, badge, children }: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const storageKey = `sidebar-height-${titleEn}`;
  const [bodyHeight, setBodyHeight] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= MIN_HEIGHT && saved <= MAX_HEIGHT ? saved : DEFAULT_HEIGHT;
  });
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: bodyHeight };
  }, [bodyHeight]);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta));
    setBodyHeight(next);
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    localStorage.setItem(storageKey, String(bodyHeight));
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, [bodyHeight, storageKey]);

  return (
    <div className="panel collapsible-section">
      <div className="panel-header collapsible-header" onClick={() => setExpanded((v) => !v)}>
        {icon}
        <span>{titleEn}</span>
        <span className="panel-header-ar">{titleAr}</span>
        {badge}
        <span className="collapsible-chevron">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <>
          <div className="collapsible-body" style={{ maxHeight: bodyHeight }}>
            {children}
          </div>
          <div
            className="resize-handle"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            title="اسحب لتغيير حجم الصندوق"
          >
            <span className="resize-handle-grip" />
          </div>
        </>
      )}
    </div>
  );
}
