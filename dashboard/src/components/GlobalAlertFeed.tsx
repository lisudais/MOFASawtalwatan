import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Radar, Zap, AlertTriangle, ChevronLeft, ChevronDown, ChevronUp,
  MapPin, Clock, ExternalLink, Sparkles,
} from 'lucide-react';
import { TYPE_ICON } from '../constants';
import { countryNameAr } from '../services/feed/countryNames';
import { groupFeedCards, type FeedCardGroup } from '../services/feed/groupCards';
import type { FeedCard } from '../services/feed/feedCards';
import type { EventType } from '../services/feed/types';
import type { GeoEvent } from '../types';

interface GlobalAlertFeedProps {
  /** Stages 1-6 pipeline output. Replaces the legacy GeoEvent list as the card source. */
  cards: FeedCard[];
  loading: boolean;
  error: boolean;
  /** Right-sidebar-only selection — never shared with the left sidebar's state. */
  selectedCardId: string | null;
  onSelectCard: (card: FeedCard) => void;
  /** Header title. Defaults to the global feed's; the consular feed overrides it. */
  titleAr?: string;
}

/** Stage 5's score drives the colour, on the same thresholds as the severity word. */
function scoreColor(score: number): string {
  if (score >= 75) return '#FF1744'; // حرج
  if (score >= 55) return '#FF6D00'; // مرتفع
  if (score >= 30) return '#FFD600'; // متوسط
  return '#00E676';                  // منخفض
}

/**
 * The original card's severity chip, restored. It used RISK_LABEL_AR[riskLevel];
 * riskLevel no longer exists, so the word is derived from Stage 5's score on the
 * same thresholds that pick the colour. Same vocabulary, same position.
 */
function severityWord(score: number): string {
  if (score >= 75) return 'حرج';
  if (score >= 55) return 'مرتفع';
  if (score >= 30) return 'متوسط';
  return 'منخفض';
}

/**
 * Per-type icon, restored. `geoType` carries the ORIGINAL GeoEvent['type'] for
 * geophysical signals, so a flood renders the flood glyph again rather than the
 * earthquake one. Sources with no GeoEvent behind them (security, statements,
 * GDELT) fall back to a representative type for their coarse eventType.
 */
const EVENT_TYPE_FALLBACK_ICON: Record<EventType, GeoEvent['type']> = {
  security: 'CONFLICT',
  natural_disaster: 'EARTHQUAKE',
  health: 'DISEASE',
  economic: 'DROUGHT',
  political_unrest: 'CIVIL_UNREST',
};

function iconFor(geoType: string | null, eventType: EventType) {
  const key = (geoType as GeoEvent['type']) ?? EVENT_TYPE_FALLBACK_ICON[eventType];
  return TYPE_ICON[key] ?? AlertTriangle;
}

const EVENT_TYPE_AR: Record<EventType, string> = {
  security: 'أمني',
  natural_disaster: 'كارثة طبيعية',
  health: 'صحي',
  economic: 'اقتصادي',
  political_unrest: 'اضطراب سياسي',
};

/** Stage 3's tier, stated plainly. null means neither official nor trusted media. */
const TIER_LABEL: Record<string, string> = {
  '1': 'مصدر رسمي',
  '2': 'إعلام موثوق',
  null: 'غير مصنّف',
};

const TAG_LABEL = {
  corroborated: 'مؤكَّد من مصدرين',
  unconfirmed: 'غير مؤكَّد',
  official: 'رسمي',
};

/** Arabic relative time with correct number/noun agreement. */
function timeAgoAr(iso: string | null): string {
  if (!iso) return 'غير متاح';
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));

  function unit(n: number, one: string, two: string, few: string, many: string): string {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }

  if (mins < 60) return `منذ ${unit(mins, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${unit(hrs, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const days = Math.floor(hrs / 24);
  return `منذ ${unit(days, 'يوم', 'يومين', 'أيام', 'يوم')}`;
}

// Right column of the dashboard. Cards come from the Stages 1-6 pipeline, rolled
// up for display by groupCards.ts (one card per country + eventType). Layout,
// top to bottom: country title, AI summary, place + sources + tier badge,
// severity badge + score bar + number, corroboration tag, time, source link.
export default function GlobalAlertFeed({
  cards, loading, error, selectedCardId, onSelectCard, titleAr = 'التنبيهات العالمية',
}: GlobalAlertFeedProps) {
  const groups = useMemo(() => groupFeedCards(cards), [cards]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!selectedCardId) return;
    rowRefs.current.get(selectedCardId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedCardId]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="panel alert-feed alert-feed-rtl">
      <div className="panel-header" dir="rtl">
        <Radar size={14} />
        <span className="feed-header-title-ar">{titleAr}</span>
        <span className="panel-badge">{groups.length}</span>
      </div>

      <div className="feed-list case-detail-scrollable">
        {loading && groups.length === 0 && (
          <div className="widget-empty-state">جارٍ تحميل التنبيهات…</div>
        )}
        {error && groups.length === 0 && (
          <div className="widget-empty-state">تعذّر جلب التنبيهات من خط المعالجة.</div>
        )}
        {!loading && !error && groups.length === 0 && (
          <div className="widget-empty-state">لا توجد تنبيهات متاحة حاليًا.</div>
        )}

        {groups.map((group) => (
          <FeedGroupCard
            key={group.id}
            group={group}
            selectedCardId={selectedCardId}
            expanded={expanded.has(group.id)}
            onToggle={() => toggle(group.id)}
            onSelectCard={onSelectCard}
            registerRef={(el) => {
              if (el) rowRefs.current.set(group.lead.id, el);
              else rowRefs.current.delete(group.lead.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface FeedGroupCardProps {
  group: FeedCardGroup;
  selectedCardId: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelectCard: (card: FeedCard) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

function FeedGroupCard({
  group, selectedCardId, expanded, onToggle, onSelectCard, registerRef,
}: FeedGroupCardProps) {
  const color = scoreColor(group.score);
  const Icon = iconFor(group.lead.geoType, group.eventType);
  const isSelected = group.threats.some((t) => t.id === selectedCardId);
  const corroborated = group.tags.includes('corroborated');
  const place = countryNameAr(group.country);
  const provisional = group.lead.provisional === true;

  return (
    <div className="feed-group">
      <div
        ref={registerRef}
        dir="rtl"
        className={`feed-item${isSelected ? ' selected' : ''}`}
        style={{ borderLeftColor: color }}
        onClick={() => onSelectCard(group.lead)}
      >
        <div className="feed-icon-wrap" style={{ color }}>
          <Icon size={16} />
        </div>

        <div className="feed-body">
          {/* country title (+ the coarse event type, and a ×N chip when rolled up) */}
          <div className="feed-title">
            {place}
            <span className="feed-eventtype"> · {EVENT_TYPE_AR[group.eventType]}</span>
            {group.grouped && <span className="feed-count-chip">×{group.threats.length}</span>}
          </div>

          {/* Stage 6 summary, directly beneath the title */}
          {group.lead.summary && (
            <div className="feed-summary">
              {group.lead.aiGenerated && <Sparkles size={9} className="feed-summary-ai" />}
              {group.lead.summary}
            </div>
          )}

          {/* place · sources · tier badge */}
          <div className="feed-meta">
            <span className="feed-country">
              <MapPin size={9} /> {place}
            </span>
            <span className="feed-source" dir="ltr">{group.sources.join(' · ')}</span>
            <span className={`feed-tier-badge tier-${group.tier ?? 'none'}`}>
              {TIER_LABEL[String(group.tier)]}
            </span>
          </div>

          {/* severity badge + score bar + number */}
          <div className="feed-score-row">
            <span
              className="risk-badge"
              style={{ background: color + '22', color, border: `1px solid ${color}` }}
            >
              {group.score >= 75 && <Zap size={9} />}
              {severityWord(group.score)}
            </span>
            <div className="score-bar">
              <div className="score-fill" style={{ width: `${group.score}%`, background: color }} />
            </div>
            <span className="score-num" style={{ color }}>{group.score}</span>
          </div>

          {/* corroboration tag · time · link */}
          <div className="feed-meta">
            <span className={`feed-tag${corroborated ? ' corroborated' : ' unconfirmed'}`}>
              {corroborated ? TAG_LABEL.corroborated : TAG_LABEL.unconfirmed}
            </span>
            {group.tags.includes('official') && (
              <span className="feed-tag official">{TAG_LABEL.official}</span>
            )}
            {provisional && <span className="feed-tag provisional">أولي</span>}
            <span className="feed-time">
              <Clock size={9} />
              {timeAgoAr(group.occurredAt)}
            </span>
            {group.url && (
              <a
                className="feed-link"
                href={group.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={9} /> المصدر
              </a>
            )}
          </div>

          {/* expandable list of the distinct threats rolled into this card */}
          {group.grouped && (
            <button
              type="button"
              className="feed-expand-btn"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {expanded ? 'إخفاء التهديدات' : `عرض ${group.threats.length} تهديدات`}
            </button>
          )}
        </div>

        {group.score >= 75 ? (
          <div className="critical-indicator">
            <AlertTriangle size={14} color="#FF1744" />
          </div>
        ) : (
          <ChevronLeft size={14} className="feed-chevron" />
        )}
      </div>

      {group.grouped && expanded && (
        <div className="feed-threat-list" dir="rtl">
          {group.threats.map((threat) => {
            const tColor = scoreColor(threat.score);
            return (
              <button
                key={threat.id}
                type="button"
                className={`feed-threat-row${selectedCardId === threat.id ? ' selected' : ''}`}
                style={{ borderInlineStartColor: tColor }}
                onClick={(e) => { e.stopPropagation(); onSelectCard(threat); }}
              >
                <span className="feed-threat-score mono-num" style={{ color: tColor }}>{threat.score}</span>
                <span className="feed-threat-summary">{threat.summary ?? 'غير متاح'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
