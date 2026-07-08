import { Share2, Download, MapPin, Clock, Zap } from 'lucide-react';
import { RISK_COLORS } from '../constants';
import { REGION_LABEL_AR, REGION_LABEL_EN, type Region } from '../services/regions';
import type { GeoEvent, RiskLevel } from '../types';

interface RegionAlertCardProps {
  region: Region;
  events: GeoEvent[];
  newIds: Set<string>;
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
}

const PRIORITY: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, SAFE: 4 };

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function shareRegion(region: Region, events: GeoEvent[]) {
  const summary = `${REGION_LABEL_AR[region]} (${REGION_LABEL_EN[region]}) — ${events.length} حدث نشط:\n` +
    events.slice(0, 5).map((e) => `• ${e.title}`).join('\n');

  if (navigator.share) {
    try { await navigator.share({ title: REGION_LABEL_AR[region], text: summary }); } catch { /* user cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(summary); } catch { /* clipboard unavailable */ }
  }
}

function downloadRegion(region: Region, events: GeoEvent[]) {
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${region.toLowerCase()}-events.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RegionAlertCard({ region, events, newIds, selectedEvent, onSelectEvent }: RegionAlertCardProps) {
  const sorted = [...events].sort(
    (a, b) => PRIORITY[a.riskLevel] - PRIORITY[b.riskLevel] || b.timestamp.getTime() - a.timestamp.getTime()
  );

  const hasCritical = events.some((e) => e.riskLevel === 'CRITICAL');
  const newCount = events.filter((e) => newIds.has(e.id)).length;
  const hasCriticalNew = events.some((e) => newIds.has(e.id) && e.riskLevel === 'CRITICAL');

  return (
    <div className="region-card">
      <div className={`region-accent-bar${hasCritical ? ' critical' : ''}`} />

      <div className="region-card-header">
        <span className="region-count mono-num">{events.length}</span>
        <button className="region-icon-btn" title="مشاركة" onClick={() => shareRegion(region, events)}>
          <Share2 size={13} />
        </button>
        <button className="region-icon-btn" title="تنزيل" onClick={() => downloadRegion(region, events)}>
          <Download size={13} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        {newCount > 0 && (
          <span className={`region-new-pill${hasCriticalNew ? ' critical' : ''}`}>{newCount} جديد</span>
        )}
        <div className="region-name-block">
          <span className="region-name-ar">{REGION_LABEL_AR[region]}</span>
          <span className="region-name-en">{REGION_LABEL_EN[region]}</span>
        </div>
      </div>

      <div className="region-item-list">
        {sorted.map((event) => {
          const color = RISK_COLORS[event.riskLevel];
          const isSelected = selectedEvent?.id === event.id;
          const isNew = newIds.has(event.id);
          return (
            <div
              key={event.id}
              className={`region-item${isSelected ? ' selected' : ''}`}
              style={{ borderInlineStartColor: color }}
              onClick={() => onSelectEvent(event)}
            >
              <div className="region-item-tags">
                <span className="region-tag">{event.type}</span>
                {event.riskLevel === 'CRITICAL' && (
                  <span className="region-tag alert"><Zap size={8} /> ALERT</span>
                )}
                {isNew && <span className="region-tag new">جديد</span>}
                <span className="region-item-source">{event.source}</span>
              </div>
              <div className="region-item-title">{event.title}</div>
              <div className="region-item-meta">
                {event.country && <span><MapPin size={9} /> {event.country}</span>}
                <span><Clock size={9} /> {timeAgo(event.timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
