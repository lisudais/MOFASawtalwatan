import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check } from 'lucide-react';

export interface MapLayer {
  id: string;
  labelAr: string;
  icon: ReactNode;
  enabled: boolean;
  /** Optional: renders the row's checkbox/icon in this layer's own accent
   *  color instead of the default gold — used for the experimental/predicted
   *  layer, which is deliberately blue everywhere else on the map. */
  accentColor?: string;
}

interface MapLayersPanelProps {
  layers: MapLayer[];
  onToggle: (id: string) => void;
  onClose: () => void;
  /** The trigger button — the panel positions itself just below it. Portaled
   *  to document.body (see below) so it isn't clipped by .map-section's
   *  `overflow: hidden`, which the map area default width (75vw sidebar)
   *  makes a real problem, not a hypothetical one. */
  anchorRef: RefObject<HTMLElement | null>;
}

// Checklist-style dropdown for the map's layer toggles — replaces the row of
// separate buttons that used to sit in .map-toggle-row. Purely presentational:
// it owns the search text and its own screen position, nothing else. Which
// Leaflet layer groups are actually shown/hidden is entirely WorldMap's
// state; this component just reports which id was clicked.
export default function MapLayersPanel({ layers, onToggle, onClose, anchorRef }: MapLayersPanelProps) {
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function updatePosition() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left });
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [anchorRef]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return layers;
    return layers.filter((l) => l.labelAr.includes(q));
  }, [layers, query]);

  if (!pos) return null;

  return createPortal(
    <>
      {/* Transparent click-catcher — same technique as .modal-overlay (click
          outside to dismiss), just not dimmed, since this sits over the map. */}
      <div className="map-layers-backdrop" onClick={onClose} />
      <div
        className="map-layers-panel"
        dir="rtl"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="map-layers-search-row">
          <Search size={13} />
          <input
            className="map-layers-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن طبقة…"
            autoFocus
            aria-label="بحث عن طبقة خريطة"
          />
        </div>

        <div className="map-layers-list">
          {filtered.map((layer) => {
            const accent = layer.accentColor;
            return (
              <button
                key={layer.id}
                type="button"
                className={`map-layer-row${layer.enabled ? ' active' : ''}`}
                onClick={() => onToggle(layer.id)}
                role="checkbox"
                aria-checked={layer.enabled}
              >
                <span
                  className={`map-layer-checkbox${layer.enabled ? ' checked' : ''}`}
                  style={layer.enabled && accent ? { background: accent, borderColor: accent } : undefined}
                >
                  {layer.enabled && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="map-layer-icon" style={layer.enabled && accent ? { color: accent } : undefined}>
                  {layer.icon}
                </span>
                <span className="map-layer-label">{layer.labelAr}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="widget-empty-state">لا توجد طبقات مطابقة.</div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
