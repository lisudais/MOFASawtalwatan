import { useEffect, useState } from 'react';
import { X, MapPin, Clock, Radio, Link2, Send, AlertTriangle, Pencil, ChevronDown, ChevronUp, Navigation } from 'lucide-react';
import { TYPE_LABEL_AR } from '../constants';
import { countryNameAr } from '../services/feed/countryNames';
import type { FeedCard } from '../services/feed/feedCards';
import type { EventType } from '../services/feed/types';
import type { GeoEvent, Traveler } from '../types';

interface AlertDetailsPanelProps {
  /**
   * The selected feed card. This is the primary input: EVERY card can open the
   * panel, including security / statement / GDELT clusters that have no GeoEvent
   * behind them. Previously the panel took only a GeoEvent, so clicking one of
   * those cards closed the panel with nothing in it.
   */
  card: FeedCard | null;
  /**
   * The legacy GeoEvent, when the cluster contains a geophysical signal that maps
   * back to one. Supplies only what that source uniquely carries — coordinates,
   * original headline, description, recommended action. Optional by design.
   */
  event: GeoEvent | null;
  travelers: Traveler[];
  onClose: () => void;
  /** Centers the map on a tracked citizen. Reuses WorldMap's existing
   *  selectedTraveler fly-to; leaves every other marker layer alone. */
  onTrackCitizen: (citizen: Traveler) => void;
}

const NA = 'غير متاح';
const MESSAGE_MAX = 500;

const TYPE_LABEL_EN: Record<GeoEvent['type'], string> = {
  EARTHQUAKE: 'Earthquake',
  FLOOD: 'Flood',
  STORM: 'Tropical Storm',
  VOLCANO: 'Volcanic Eruption',
  CONFLICT: 'Armed Conflict',
  TERROR: 'Terrorist Activity',
  CIVIL_UNREST: 'Civil Unrest',
  DISEASE: 'Disease Outbreak',
  DROUGHT: 'Extreme Weather',
  WILDFIRE: 'Wildfire',
};

// Arabic type label for each real feed behind an event — the only source
// metadata the alert object actually carries. Nothing here is invented.
const SOURCE_TYPE_AR: Record<GeoEvent['source'], string> = {
  GDACS: 'إنذار كوارث',
  USGS: 'رصد زلزالي',
  EMSC: 'رصد زلزالي',
  EONET: 'رصد بيئي',
  RELIEFWEB: 'إنساني',
  ACLED: 'رصد النزاعات',
  MOCK: '—',
};
const SOURCE_LABEL: Record<GeoEvent['source'], string> = {
  GDACS: 'GDACS',
  USGS: 'USGS',
  EONET: 'NASA EONET',
  EMSC: 'EMSC',
  RELIEFWEB: 'OCHA / ReliefWeb',
  ACLED: 'ACLED',
  MOCK: 'MOCK',
};

/** Same thresholds as the feed card: Stage 5's score, not a riskLevel enum. */
function scoreColor(score: number): string {
  if (score >= 75) return '#FF1744';
  if (score >= 55) return '#FF6D00';
  if (score >= 30) return '#FFD600';
  return '#00E676';
}
function severityWord(score: number): string {
  if (score >= 75) return 'حرج';
  if (score >= 55) return 'مرتفع';
  if (score >= 30) return 'متوسط';
  return 'منخفض';
}

const EVENT_TYPE_AR: Record<EventType, string> = {
  security: 'أمني',
  natural_disaster: 'كارثة طبيعية',
  health: 'صحي',
  economic: 'اقتصادي',
  political_unrest: 'اضطراب سياسي',
};
const EVENT_TYPE_EN: Record<EventType, string> = {
  security: 'Security',
  natural_disaster: 'Natural Disaster',
  health: 'Health',
  economic: 'Economic',
  political_unrest: 'Political Unrest',
};

function textDir(s: string): 'rtl' | 'ltr' {
  return /[؀-ۿ]/.test(s) ? 'rtl' : 'ltr';
}

const na = (v: unknown): string =>
  v === null || v === undefined || v === '' ? NA : String(v);

// Large details overlay for the alert selected in the RIGHT sidebar (Global
// Alert Feed). Absolutely positioned over the map and right-aligned so it sits
// beside the right sidebar — it never pushes, resizes or moves the map, and it
// never touches the left sidebar's state or its `.health-detail-*` panels.
// Every field comes from the selected alert object; missing ones read "غير متاح".
export default function AlertDetailsPanel({ card, event, travelers, onClose, onTrackCitizen }: AlertDetailsPanelProps) {
  const [editableRightAlertMessage, setEditableRightAlertMessage] = useState('');
  const [sent, setSent] = useState(false);
  // Citizens dropdown — state lives only in this right-sidebar panel.
  const [isCitizensMenuOpen, setIsCitizensMenuOpen] = useState(false);
  const [selectedCitizen, setSelectedCitizen] = useState<Traveler | null>(null);
  const [trackNotice, setTrackNotice] = useState('');

  // Regenerate the editable draft whenever a different card is selected.
  useEffect(() => {
    if (!card) return;
    setSent(false);
    setIsCitizensMenuOpen(false);
    setSelectedCitizen(null);
    setTrackNotice('');
    const where = countryNameAr(card.country);
    const action = event?.recommendedAction ?? '';
    setEditableRightAlertMessage(
      `تنبيه وزارة الخارجية: خطر ${severityWord(card.score)} في ${where}. ${action}`.trim()
    );
  }, [card, event]);

  if (!card) return null;

  // ── View model ────────────────────────────────────────────────────────────
  // Every field falls back to the card, which always exists. `event` only adds
  // what the geophysical sources uniquely carry. Nothing is invented: a missing
  // field renders "غير متاح".
  const color = scoreColor(card.score);
  const hasCoords = Boolean(event && (event.lat !== 0 || event.lng !== 0));
  const countryCode = card.country ?? event?.countryCode ?? '';
  const placeAr = countryNameAr(card.country ?? (event?.countryCode || null));

  const typeEn = event ? TYPE_LABEL_EN[event.type] : EVENT_TYPE_EN[card.eventType];
  const typeAr = event ? TYPE_LABEL_AR[event.type] : EVENT_TYPE_AR[card.eventType];
  const arabicTitle = `${typeAr} · ${placeAr}`;
  const headline = event?.title ?? card.summary ?? '';
  const description = event?.description ?? card.summary ?? '';
  const recommendation = event?.recommendedAction ?? null;
  const occurredAt = card.occurredAt ? new Date(card.occurredAt) : event?.timestamp ?? null;
  const sourceLabels = card.sources.length
    ? card.sources
    : event ? [SOURCE_LABEL[event.source] ?? event.source] : [];

  // Real citizens already present in the frontend traveler registry — no demo
  // list is introduced, and the card object itself is never modified.
  const citizensForSelectedAlert = travelers.filter(
    (t) => t.countryCode && t.countryCode === countryCode
  );
  const citizensHere = citizensForSelectedAlert.length;

  function handleTrackCitizen(citizen: Traveler) {
    setSelectedCitizen(citizen);
    const citizenHasCoords =
      Number.isFinite(citizen.lat) && Number.isFinite(citizen.lng) && (citizen.lat !== 0 || citizen.lng !== 0);
    if (!citizenHasCoords) {
      setTrackNotice('موقع المواطن غير متاح');
      return;
    }
    setTrackNotice('');
    onTrackCitizen(citizen);
  }

  return (
    <div className="alert-details-panel" dir="rtl" style={{ borderTopColor: color }}>
      <div className="adp-header">
        <div className="adp-header-main">
          <span className="event-type-tag" style={{ color, borderColor: color }}>
            {typeEn}
          </span>
          <h3 className="adp-title" dir="rtl">{arabicTitle}</h3>
          <div className="adp-subtitle" dir={textDir(headline)}>{na(headline)}</div>
        </div>
        <button className="close-btn" onClick={onClose} title="إغلاق"><X size={16} /></button>
      </div>

      <div className="adp-body">
        {/* Severity — circular score visual + score card */}
        <div className="event-risk-row">
          <div className="score-visual">
            <div
              className="score-arc"
              style={{ background: `conic-gradient(${color} ${card.score * 3.6}deg, #162440 0deg)` }}
            >
              <span style={{ color }}>{card.score}</span>
            </div>
          </div>
          <div className="risk-level-display" style={{ background: color + '15', borderColor: color }}>
            <AlertTriangle size={16} color={color} />
            <span style={{ color }}>{severityWord(card.score)}</span>
            <span className="risk-score" style={{ color }}>Score: {card.score}/100</span>
          </div>
        </div>
        <div className="severity-bar-track">
          <div className="severity-bar-fill" style={{ width: `${card.score}%`, background: color }} />
        </div>

        {/* Metadata */}
        <div className="event-detail-body">
          <div className="detail-row">
            <MapPin size={13} />
            <span>
              {placeAr}
              {hasCoords && event ? ` (${event.lat.toFixed(2)}°, ${event.lng.toFixed(2)}°)` : ''}
            </span>
          </div>
          <div className="detail-row">
            <Clock size={13} />
            <span dir="ltr">{occurredAt ? occurredAt.toLocaleString('en-SA') : NA}</span>
          </div>
          <div className="detail-row">
            <Radio size={13} />
            <span dir="ltr">Source: {sourceLabels.join(' · ') || NA}</span>
          </div>
        </div>

        {/* Description */}
        <div className="event-description" dir={textDir(description || '')}>
          {na(description)}
        </div>

        {/* Ministry recommendation */}
        <div className="event-recommendation" style={{ borderColor: color + '44', background: color + '0D' }}>
          <div className="rec-label" style={{ color: 'var(--saudi-light)' }} dir="rtl">
            الإجراء الموصى به · MINISTRY RECOMMENDATION
          </div>
          <div className="rec-text" dir="rtl">{na(recommendation)}</div>
        </div>

        {/* Sources & related resources — derived only from the alert's own source field */}
        <div className="cw-sources-section">
          <div className="cw-sources-header">
            <Link2 size={12} color="var(--saudi-gold)" />
            <span dir="rtl">المصادر والموارد ذات الصلة</span>
            <span
              className="source-badge"
              dir="rtl"
              style={{ color: 'var(--saudi-light)', borderColor: 'var(--saudi-light)' }}
            >
              موثوقة
            </span>
          </div>
          <div className="source-badge-row">
            {sourceLabels.length === 0 && <span className="source-badge" dir="rtl">{NA}</span>}
            {sourceLabels.map((sl) => (
              <span className="source-badge" key={sl} dir="rtl">
                {SOURCE_LABEL[sl as GeoEvent['source']] ?? sl}{' '}
                <span style={{ opacity: 0.6 }}>{SOURCE_TYPE_AR[sl as GeoEvent['source']] ?? ''}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Saudi presence */}
        <div className="cw-presence-section">
          <div className="cw-presence-header">
            <span className="stat-label-en">SAUDI PRESENCE</span>
            <span className="panel-header-ar">التواجد السعودي</span>
          </div>
          <div className="presence-grid-v2">
            <button
              type="button"
              className={`presence-citizens-card${isCitizensMenuOpen ? ' open' : ''}`}
              onClick={() => setIsCitizensMenuOpen((v) => !v)}
              aria-expanded={isCitizensMenuOpen}
              title="عرض المواطنين في المنطقة"
            >
              <div className="presence-citizens-count">{citizensHere}</div>
              <div className="presence-citizens-label">
                Saudi Citizens in Region
                <span className="panel-header-ar" style={{ marginRight: 0 }}>مواطنون في المنطقة</span>
              </div>
              {isCitizensMenuOpen ? <ChevronUp size={13} className="presence-chevron" /> : <ChevronDown size={13} className="presence-chevron" />}
            </button>
            <div className="presence-visa-card">
              {/* No visa-holder field exists on the alert object — never invented. */}
              <div className="presence-visa-count">0</div>
              <div className="presence-visa-label">
                Visa Holders
                <span className="panel-header-ar" style={{ marginRight: 0 }}>حاملو التأشيرات</span>
              </div>
            </div>
          </div>

          {/* Citizens dropdown — opens inside this panel, directly under the card */}
          {isCitizensMenuOpen && (
            <div className="citizens-menu" dir="rtl">
              {citizensForSelectedAlert.length === 0 ? (
                <div className="citizens-menu-empty">لا توجد بيانات مواطنين متاحة لهذه المنطقة</div>
              ) : (
                <div className="citizens-menu-list">
                  {citizensForSelectedAlert.map((c) => {
                    const isSelected = selectedCitizen?.id === c.id;
                    return (
                      <div key={c.id} className={`citizen-row${isSelected ? ' selected' : ''}`}>
                        <div className="citizen-info">
                          <div className="citizen-field">
                            <span className="citizen-field-label">الاسم</span>
                            <span className="citizen-field-value">{na(c.nameAr)}</span>
                          </div>
                          {/* Traveler carries `passportNumber`, not a national ID —
                              shown as-is rather than inventing a new field. */}
                          <div className="citizen-field">
                            <span className="citizen-field-label">الهوية</span>
                            <span className="citizen-field-value mono-num" dir="ltr">{na(c.passportNumber)}</span>
                          </div>
                          <div className="citizen-field">
                            <span className="citizen-field-label">رقم الجوال</span>
                            <span className="citizen-field-value mono-num" dir="ltr">{na(c.phone)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="citizen-track-btn"
                          onClick={() => handleTrackCitizen(c)}
                        >
                          <Navigation size={11} /> تتبع
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {trackNotice && <div className="citizens-menu-notice">{trackNotice}</div>}
            </div>
          )}
        </div>

        {/* Editable alert message */}
        <div className="editable-message-section">
          <div className="editable-message-label">
            <Pencil size={12} />
            <span>Editable Alert Message</span>
            <span className="panel-header-ar" style={{ marginRight: 0 }}>نص الإشعار القابل للتعديل</span>
          </div>
          <textarea
            className="editable-message-textarea"
            value={editableRightAlertMessage}
            maxLength={MESSAGE_MAX}
            onChange={(e) => setEditableRightAlertMessage(e.target.value)}
            dir="rtl"
            rows={4}
          />
          <div className="editable-message-charcount">{editableRightAlertMessage.length}/{MESSAGE_MAX}</div>
        </div>
      </div>

      <div className="adp-footer">
        {/* Frontend-only: no send API exists in this project, so nothing is dispatched. */}
        <button
          className="btn-alert-all"
          style={{ background: '#FF1744' }} // --danger-critical
          onClick={() => setSent(true)}
          disabled={sent}
        >
          <Send size={14} style={{ marginLeft: 6 }} />
          {sent ? 'تم الإرسال' : 'Send Alert to Travelers · إرسال تنبيه للمسافرين'}
        </button>
      </div>
    </div>
  );
}
