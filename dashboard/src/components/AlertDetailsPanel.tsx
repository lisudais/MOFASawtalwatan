import { useEffect, useMemo, useState } from 'react';
import { X, MapPin, Clock, Radio, Link2, ShieldCheck, AlertTriangle, Pencil, ChevronDown, ChevronUp, Navigation } from 'lucide-react';
import { TYPE_LABEL_AR } from '../constants';
import { classifyRiskByScore } from '../services/riskClassification';
import { getSaudiPresence } from '../services/mockData';
import { countryNameAr } from '../services/feed/countryNames';
import { getEmbassyForCountryCode } from '../services/embassies';
import {
  addApprovedAlert, useApprovedAlerts, formatDateTimeAr,
  ALERT_APPROVAL_STATUS_AR, ALERT_APPROVAL_STATUS_COLOR,
} from '../services/alertApprovals';
import AlertApprovalModal from './AlertApprovalModal';
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

// Colour + word from the app-wide central classifier — the score shown here as
// "Score: N/100" reads with the exact same band/label as the feed list.
const scoreColor = (score: number): string => classifyRiskByScore(score).color;
const severityWord = (score: number): string => classifyRiskByScore(score).labelAr;

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
  // Clicking the footer button no longer sends anything itself — it opens the
  // approval modal, which records the approval into the shared queue below.
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  // Citizens dropdown — state lives only in this right-sidebar panel.
  const [isCitizensMenuOpen, setIsCitizensMenuOpen] = useState(false);
  const [selectedCitizen, setSelectedCitizen] = useState<Traveler | null>(null);
  const [trackNotice, setTrackNotice] = useState('');

  // Single shared source of truth for approval/send status (services/
  // alertApprovals.ts) — also read by EmbassyDashboard. Whichever side
  // updates it (e.g. the consulate executing the real send), this panel
  // picks the new status up live, no manual refresh needed.
  const approvedAlerts = useApprovedAlerts();
  const linkedApproval = useMemo(() => {
    if (!card) return null;
    const forThisCard = approvedAlerts.filter((a) => a.sourceCardId === card.id);
    if (forThisCard.length === 0) return null;
    return forThisCard.reduce((latest, a) => (a.approvedAt > latest.approvedAt ? a : latest));
  }, [approvedAlerts, card]);

  // Regenerate the editable draft whenever a different card is selected.
  useEffect(() => {
    if (!card) return;
    setShowApprovalModal(false);
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
  // Which consulate an approval routes to — resolved the same way the
  // embassy dashboards scope their own live feeds (services/embassies.ts).
  const targetEmbassy = getEmbassyForCountryCode(countryCode, card.country ?? undefined);

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
              {/* Mock visa-holder estimate for this country (always a number). */}
              <div className="presence-visa-count mono-num">{getSaudiPresence(countryCode).visaHolders.toLocaleString('en-US')}</div>
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
        {/* Live status synced from the shared approval queue — updates the
            instant the consulate side executes the real send, no refresh. */}
        {linkedApproval && (
          <div className="alert-approval-live-status" dir="rtl">
            <span
              className="embassy-sev-chip"
              style={{ color: ALERT_APPROVAL_STATUS_COLOR[linkedApproval.status], borderColor: ALERT_APPROVAL_STATUS_COLOR[linkedApproval.status] }}
            >
              {ALERT_APPROVAL_STATUS_AR[linkedApproval.status]}
            </span>
            {linkedApproval.sentByAr && linkedApproval.sentAt && (
              <span className="rc-last">
                نفّذ الإرسال: <span className="rc-last-val">{linkedApproval.sentByAr}</span> — {formatDateTimeAr(new Date(linkedApproval.sentAt))}
              </span>
            )}
          </div>
        )}
        {/* Frontend-only: no send API exists in this project. This button no
            longer sends anything itself — it opens the approval modal, which
            records the approval; the actual dispatch now lives in
            EmbassyDashboard's "إرسال التنبيه الآن للمسافرين" (see
            services/alertApprovals.ts markAlertSent). */}
        <button
          className="btn-alert-all"
          style={{ background: '#FF1744' }} // --danger-critical
          onClick={() => setShowApprovalModal(true)}
          disabled={!!linkedApproval}
        >
          <ShieldCheck size={14} style={{ marginLeft: 6 }} />
          {linkedApproval ? 'تم الاعتماد' : 'اعتماد وإرسال الأمر للقنصلية'}
        </button>
      </div>

      {showApprovalModal && (
        <AlertApprovalModal
          messageAr={editableRightAlertMessage}
          placeAr={placeAr}
          expectedAffected={citizensHere}
          unrouted={!targetEmbassy}
          onCancel={() => setShowApprovalModal(false)}
          onConfirm={(approvedByAr) => {
            addApprovedAlert({
              embassyId: targetEmbassy?.id ?? '',
              messageAr: editableRightAlertMessage,
              countryCode,
              countryAr: placeAr,
              expectedAffected: citizensHere,
              approvedByAr,
              sourceCardId: card.id,
            });
            setShowApprovalModal(false);
          }}
        />
      )}
    </div>
  );
}
