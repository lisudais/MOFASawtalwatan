import { ChevronDown } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

interface EmbassyAccordionProps {
  id: string;
  title: string;
  icon: ComponentType<{ size?: number | string }>;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

// Collapsible section built on the shared .panel card shell — expands and
// collapses in place (no modal, no navigation). Animated height/opacity via
// the CSS grid 0fr→1fr technique; chevron rotation mirrors the state. Fully
// keyboard-accessible: the whole header is a real <button> with aria-expanded.
export default function EmbassyAccordion({ id, title, icon: Icon, count, isOpen, onToggle, children }: EmbassyAccordionProps) {
  return (
    <section className={`panel embassy-card embassy-accordion${isOpen ? ' open' : ''}`}>
      <button
        type="button"
        className="panel-header embassy-accordion-header"
        dir="rtl"
        aria-expanded={isOpen}
        aria-controls={`${id}-content`}
        onClick={onToggle}
      >
        <Icon size={13} />
        <span>{title}</span>
        {typeof count === 'number' && <span className="panel-badge">{count}</span>}
        <ChevronDown size={14} className="embassy-accordion-chevron" aria-hidden="true" />
      </button>
      <div id={`${id}-content`} className="embassy-accordion-content" role="region" aria-label={title}>
        <div className="embassy-accordion-inner">
          {children}
        </div>
      </div>
    </section>
  );
}
