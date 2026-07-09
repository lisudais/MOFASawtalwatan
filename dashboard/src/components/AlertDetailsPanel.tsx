import { useEffect, useState } from 'react';
import { X, MapPin, Clock, Radio, Link2, Send, AlertTriangle, Pencil, ChevronDown, ChevronUp, Navigation } from 'lucide-react';
import { RISK_COLORS, RISK_LABEL_AR, TYPE_LABEL_AR } from '../constants';
import type { GeoEvent, Traveler } from '../types';

interface AlertDetailsPanelProps {
  /** Right-sidebar selection only — never the left sidebar's `selectedEvent`. */
  alert: GeoEvent | null;
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
export default function AlertDetailsPanel({ alert, travelers, onClose, onTrackCitizen }: AlertDetailsPanelProps) {
  const [editableRightAlertMessage, setEditableRightAlertMessage] = useState('');
  const [sent, setSent] = useState(false);
  // Citizens dropdown — state lives only in this right-sidebar panel.
  const [isCitizensMenuOpen, setIsCitizensMenuOpen] = useState(false);
  const [selectedCitizen, setSelectedCitizen] = useState<Traveler | null>(null);
  const [trackNotice, setTrackNotice] = useState('');

  // Regenerate the editable draft whenever a different alert is selected.
  useEffect(() => {
    if (!alert) return;
    setSent(false);
    setIsCitizensMenuOpen(false);
    setSelectedCitizen(null);
    setTrackNotice('');
    setEditableRightAlertMessage(
      `تنبيه وزارة الخارجية: خطر ${RISK_LABEL_AR[alert.riskLevel]} في ${alert.country || NA}. ` +
      `${alert.recommendedAction || ''}`.trim()
    );
  }, [alert]);

  if (!alert) return null;

  const color = RISK_COLORS[alert.riskLevel];
  const hasCoords = alert.lat !== 0 || alert.lng !== 0;
  const arabicTitle = `${TYPE_LABEL_AR[alert.type]} · ${alert.country || NA}`;

  // Real citizens already present in the frontend traveler registry — no demo
  // list is introduced, and the alert object itself is never modified.
  const citizensForSelectedAlert = travelers.filter(
    (t) => t.countryCode && t.countryCode === alert.countryCode
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
            {TYPE_LABEL_EN[alert.type]}
          </span>
          <h3 className="adp-title" dir="rtl">{arabicTitle}</h3>
          <div className="adp-subtitle" dir={textDir(alert.title)}>{na(alert.title)}</div>
        </div>
        <button className="close-btn" onClick={onClose} title="إغلاق"><X size={16} /></button>
      </div>

      <div className="adp-body">
        {/* Severity — circular score visual + score card */}
        <div className="event-risk-row">
          <div className="score-visual">
            <div
              className="score-arc"
              style={{ background: `conic-gradient(${color} ${alert.score * 3.6}deg, #162440 0deg)` }}
            >
              <span style={{ color }}>{alert.score}</span>
            </div>
          </div>
          <div className="risk-level-display" style={{ background: color + '15', borderColor: color }}>
            <AlertTriangle size={16} color={color} />
            <span style={{ color }}>{alert.riskLevel} RISK</span>
            <span className="risk-score" style={{ color }}>Score: {alert.score}/100</span>
          </div>
        </div>
        <div className="severity-bar-track">
          <div className="severity-bar-fill" style={{ width: `${alert.score}%`, background: color }} />
        </div>

        {/* Metadata */}
        <div className="event-detail-body">
          <div className="detail-row">
            <MapPin size={13} />
            <span dir="ltr">
              {alert.country || NA}
              {hasCoords ? ` (${alert.lat.toFixed(2)}°, ${alert.lng.toFixed(2)}°)` : ''}
            </span>
          </div>
          <div className="detail-row">
            <Clock size={13} />
            <span dir="ltr">{alert.timestamp.toLocaleString('en-SA')}</span>
          </div>
          <div className="detail-row">
            <Radio size={13} />
            <span dir="ltr">Source: {SOURCE_LABEL[alert.source] ?? na(alert.source)}</span>
          </div>
        </div>

        {/* Description */}
        <div className="event-description" dir={textDir(alert.description || '')}>
          {na(alert.description)}
        </div>

        {/* Ministry recommendation */}
        <div className="event-recommendation" style={{ borderColor: color + '44', background: color + '0D' }}>
          <div className="rec-label" style={{ color: 'var(--saudi-light)' }} dir="rtl">
            الإجراء الموصى به · MINISTRY RECOMMENDATION
          </div>
          <div className="rec-text" dir="rtl">{na(alert.recommendedAction)}</div>
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
            <span className="source-badge" dir="rtl">
              {SOURCE_LABEL[alert.source] ?? na(alert.source)}{' '}
              <span style={{ opacity: 0.6 }}>{SOURCE_TYPE_AR[alert.source] ?? ''}</span>
            </span>
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
          style={{ background: RISK_COLORS.CRITICAL }}
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
