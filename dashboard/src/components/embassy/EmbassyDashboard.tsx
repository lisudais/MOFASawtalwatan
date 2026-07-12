import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert, MapPin, Users, AlertTriangle, Inbox,
  Flame, HeartPulse, Siren, Plane, Clock,
  X, User, Landmark, Flag, ArrowUpRight, Info,
  Phone, MessageCircle, Mail, PhoneCall,
} from 'lucide-react';
import EmbassyMap from './EmbassyMap';
import EventDetail from '../EventDetail';
import AiChatbot from '../AiChatbot';
import AppHeader from '../AppHeader';
import ConsularAlertsPanel from './ConsularAlertsPanel';
import CompactStatsBar, { type CompactStat } from './CompactStatsBar';
import { fetchGDACSEvents } from '../../services/gdacs';
import { fetchUSGSEarthquakes } from '../../services/usgs';
import { fetchExtraDisasterEvents } from '../../services/disasters';
import { fetchHealthCountries } from '../../services/healthFeed';
import type { CountryHealthEntry } from '../../services/healthAnalysis';
import { fetchSecurityFeed, type CountrySecurityProfile } from '../../services/security';
import { fetchOfficialStatements } from '../../services/statementsFeed';
import type { OfficialStatement } from '../../services/officialStatements';
import { MOCK_TRAVELERS } from '../../services/mockData';
import {
  isEventInEmbassyScope, isTravelerInEmbassyScope, distanceKm,
  PORT_STATUS_AR, PORT_STATUS_COLOR,
  type EmbassyConfig,
} from '../../services/embassies';
import { fetchEmbassyWeather, type EmbassyWeather } from '../../services/embassyOps';
import { RISK_COLORS, TYPE_LABEL_AR } from '../../constants';
import type { GeoEvent, RiskLevel } from '../../types';

interface EmbassyDashboardProps {
  embassy: EmbassyConfig;
  onBack: () => void;
}

const NEAR_DANGER_KM = 300;

const RISK_LABEL_AR: Record<RiskLevel, string> = {
  CRITICAL: 'حرج', HIGH: 'مرتفع', MEDIUM: 'متوسط', LOW: 'منخفض', SAFE: 'آمن',
};

function timeAgoAr(date: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

/* DEMO side-panel data — there is still NO real citizen-registration or
   request backend. These are clearly-labeled "تجريبي" placeholders so the
   consulate view can be shown populated; every field that renders them keeps a
   visible demo tag. Replace with the real case-management API when it exists. */
interface EmbassyMockStats { registered: number; nearDanger: number; }
const MOCK_EMBASSY_STATS: Record<string, EmbassyMockStats> = {
  'indonesia-jakarta': { registered: 4820, nearDanger: 12 },
  'malaysia-kuala-lumpur': { registered: 6350, nearDanger: 3 },
  'pakistan-islamabad': { registered: 3110, nearDanger: 47 },
  'egypt-cairo': { registered: 9240, nearDanger: 8 },
};
const DEFAULT_MOCK_STATS: EmbassyMockStats = { registered: 1250, nearDanger: 5 };

type RequestKind = 'ASSISTANCE' | 'INCIDENT' | 'REGISTRATION';
type RequestPriority = 'URGENT' | 'HIGH' | 'NORMAL';
type RequestStage = 'RECEIVED' | 'REVIEW' | 'PROCESSING' | 'CLOSED';

interface CitizenRequest {
  id: string;
  kind: RequestKind;
  titleAr: string;
  submittedAt: Date;
  priority: RequestPriority;
  departmentAr: string;
  citizenNameAr: string;
  stage: RequestStage;
  situationAr: string;
  recommendedActionAr: string;
  // Contact details for the requester. Optional: not every record has them, and
  // there is no real contact backend yet — populated with clearly-marked
  // placeholders in the mock generator below.
  phone?: string;
  email?: string;
  lastContactAt?: Date;
}

// TODO: wire these to the real citizen-contact records when a backend exists.
// Placeholder-only values — NOT real citizen contact data.
const PLACEHOLDER_PHONE = '+966500000000';
const PLACEHOLDER_EMAIL = 'citizen@example.sa';

function formatDateTimeAr(d: Date): string {
  return d.toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
}

const REQUEST_KIND_AR: Record<RequestKind, string> = {
  ASSISTANCE: 'مساعدة', INCIDENT: 'بلاغ', REGISTRATION: 'تسجيل',
};
const REQUEST_KIND_COLOR: Record<RequestKind, string> = {
  ASSISTANCE: '#FFB300', INCIDENT: '#FF6D00', REGISTRATION: '#00E676',
};
const PRIORITY_AR: Record<RequestPriority, string> = {
  URGENT: 'عاجلة', HIGH: 'مرتفعة', NORMAL: 'عادية',
};
const PRIORITY_COLOR: Record<RequestPriority, string> = {
  URGENT: '#FF1744', HIGH: '#FF6D00', NORMAL: '#42A5F5',
};
const STAGE_ORDER: RequestStage[] = ['RECEIVED', 'REVIEW', 'PROCESSING', 'CLOSED'];
const STAGE_AR: Record<RequestStage, string> = {
  RECEIVED: 'استلام', REVIEW: 'مراجعة', PROCESSING: 'معالجة', CLOSED: 'إغلاق',
};

function mockCitizenRequests(embassy: EmbassyConfig): CitizenRequest[] {
  const now = Date.now();
  const city = embassy.cityAr;
  const base: CitizenRequest[] = [
    {
      id: 'req-1', kind: 'ASSISTANCE', titleAr: `فقدان جواز سفر في ${city}`,
      submittedAt: new Date(now - 35 * 60000), priority: 'URGENT', departmentAr: 'القسم القنصلي',
      citizenNameAr: 'محمد العتيبي', stage: 'REVIEW',
      situationAr: `مواطن مقيم في ${city} فقد جواز سفره أثناء رحلة داخلية، ويحتاج إلى وثيقة سفر طارئة لاستكمال عودته.`,
      recommendedActionAr: 'إصدار وثيقة سفر طارئة والتنسيق مع سلطات المطار المحلي لتسهيل المغادرة.',
    },
    {
      id: 'req-2', kind: 'INCIDENT', titleAr: 'بلاغ عن حادث مروري بسيط دون إصابات',
      submittedAt: new Date(now - 3 * 3600000), priority: 'NORMAL', departmentAr: 'قسم الطوارئ',
      citizenNameAr: 'سارة القحطاني', stage: 'RECEIVED',
      situationAr: 'تعرّضت لحادث مروري بسيط دون إصابات، وتحتاج إلى خطاب رسمي للجهات المحلية وشركة التأمين.',
      recommendedActionAr: 'توثيق البلاغ وإصدار خطاب تعريف للجهات المحلية ومتابعة إجراءات التأمين.',
    },
    {
      id: 'req-3', kind: 'REGISTRATION', titleAr: 'تسجيل وصول أسرة سعودية (٤ أفراد)',
      submittedAt: new Date(now - 6 * 3600000), priority: 'NORMAL', departmentAr: 'الشؤون الإدارية',
      citizenNameAr: 'فهد الحربي', stage: 'CLOSED',
      situationAr: 'أسرة سعودية وصلت حديثاً للإقامة وقدّمت طلب تسجيل في نظام السفارة للطوارئ.',
      recommendedActionAr: 'اعتماد التسجيل وإرسال معلومات التواصل في حالات الطوارئ للأسرة.',
    },
    {
      id: 'req-4', kind: 'ASSISTANCE', titleAr: 'طلب إرشاد طبي لمريض مقيم',
      submittedAt: new Date(now - 22 * 3600000), priority: 'HIGH', departmentAr: 'الشؤون الصحية',
      citizenNameAr: 'نورة الدوسري', stage: 'PROCESSING',
      situationAr: 'مواطنة مقيمة بحاجة إلى إرشاد للمستشفيات المعتمدة ومتابعة حالتها الصحية.',
      recommendedActionAr: 'تزويدها بقائمة المستشفيات المعتمدة والتنسيق مع الطبيب المناوب لمتابعة الحالة.',
    },
    {
      id: 'req-5', kind: 'INCIDENT', titleAr: 'انقطاع الاتصال بطالب مبتعث',
      submittedAt: new Date(now - 2 * 86400000), priority: 'URGENT', departmentAr: 'قسم الطوارئ',
      citizenNameAr: 'عبدالله الشمري', stage: 'PROCESSING',
      situationAr: 'انقطع الاتصال بطالب مبتعث منذ نحو ٤٨ ساعة، وتم فتح بلاغ بحث وتحرٍّ عن مكانه.',
      recommendedActionAr: 'التنسيق مع الجامعة والسلطات المحلية وتفعيل إجراءات البحث والتصعيد لمركز القيادة.',
    },
    {
      id: 'req-6', kind: 'REGISTRATION', titleAr: 'تحديث بيانات إقامة لمواطن',
      submittedAt: new Date(now - 3 * 86400000), priority: 'NORMAL', departmentAr: 'الشؤون الإدارية',
      citizenNameAr: 'خالد المطيري', stage: 'CLOSED',
      situationAr: 'طلب تحديث بيانات الإقامة بعد تجديد التأشيرة وتحديث بيانات التواصل.',
      recommendedActionAr: 'تحديث السجل في النظام وإشعار المواطن باكتمال التحديث.',
    },
  ];
  // TODO: replace phone/email/lastContactAt with real citizen-contact records
  // once a backend exists — placeholder values only for now.
  return base.map((r) => ({
    ...r,
    phone: PLACEHOLDER_PHONE,
    email: PLACEHOLDER_EMAIL,
    lastContactAt: r.stage === 'RECEIVED' ? undefined : new Date(r.submittedAt.getTime() + 45 * 60000),
  }));
}

// Request detail — floats over the map (same overlay pattern as EventDetail).
// PLACEHOLDER: every field is demo data; the "تجريبي" marker is kept at both
// the top and the bottom so nothing here reads as a real citizen case.
function RequestDetailCard({ request, onClose }: { request: CitizenRequest; onClose: () => void }) {
  const curIdx = STAGE_ORDER.indexOf(request.stage);
  const phone = request.phone ?? PLACEHOLDER_PHONE;
  const email = request.email ?? PLACEHOLDER_EMAIL;
  const waNumber = phone.replace(/[^\d]/g, ''); // wa.me needs digits only
  return (
    <div className="request-detail case-detail-scrollable" dir="rtl" role="dialog" aria-modal="true">
      <div className="request-detail-head">
        <div className="request-detail-titles">
          <div className="request-detail-kind">
            <span className="embassy-sev-chip" style={{ color: REQUEST_KIND_COLOR[request.kind], borderColor: REQUEST_KIND_COLOR[request.kind] }}>
              {REQUEST_KIND_AR[request.kind]}
            </span>
            <span className="embassy-demo-tag">تجريبي</span>
          </div>
          <h3 className="request-detail-title">{request.titleAr}</h3>
        </div>
        <button type="button" className="request-detail-close" onClick={onClose} aria-label="إغلاق">
          <X size={16} />
        </button>
      </div>

      <div className="request-detail-meta">
        <span className="rd-meta-item">
          <Flag size={12} style={{ color: PRIORITY_COLOR[request.priority] }} />
          الأولوية: <b style={{ color: PRIORITY_COLOR[request.priority] }}>{PRIORITY_AR[request.priority]}</b>
        </span>
        <span className="rd-meta-item"><Landmark size={12} /> {request.departmentAr}</span>
        <span className="rd-meta-item"><User size={12} /> المواطن: <b>{request.citizenNameAr}</b></span>
      </div>

      <div className="request-detail-section">
        <div className="rd-section-label">مسار الحالة</div>
        <div className="request-timeline">
          {STAGE_ORDER.map((s, i) => (
            <Fragment key={s}>
              <div className={`rt-step${i <= curIdx ? ' done' : ''}${i === curIdx ? ' current' : ''}`}>
                <span className="rt-dot" />
                <span className="rt-label">{STAGE_AR[s]}</span>
              </div>
              {i < STAGE_ORDER.length - 1 && <span className={`rt-connector${i < curIdx ? ' done' : ''}`} />}
            </Fragment>
          ))}
        </div>
        <div className="rd-stage-now">المرحلة الحالية: {STAGE_AR[request.stage]}</div>
      </div>

      <div className="request-detail-section">
        <div className="rd-section-label"><Info size={12} /> الحالة الراهنة</div>
        <p className="rd-text">{request.situationAr}</p>
      </div>

      <div className="request-detail-section">
        <div className="rd-section-label"><ArrowUpRight size={12} /> الإجراء الموصى به</div>
        <p className="rd-text">{request.recommendedActionAr}</p>
      </div>

      {/* التواصل مع مقدّم الطلب */}
      <div className="request-contact">
        <div className="rd-section-label"><Phone size={12} /> التواصل مع مقدّم الطلب</div>
        <div className="rc-citizen"><User size={12} /> {request.citizenNameAr}</div>
        <div className="rc-last">
          آخر تواصل:{' '}
          <span className="rc-last-val">
            {request.lastContactAt ? formatDateTimeAr(request.lastContactAt) : 'لا يوجد تواصل سابق'}
          </span>
        </div>
        <div className="rc-actions">
          <a className="rc-btn" href={`tel:${phone}`}>
            <Phone size={12} /> اتصال
          </a>
          <a className="rc-btn" href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer">
            <MessageCircle size={12} /> واتساب
          </a>
          <a className="rc-btn" href={`mailto:${email}`}>
            <Mail size={12} /> بريد
          </a>
        </div>
        <a className="rc-primary" href={`tel:${phone}`}>
          <PhoneCall size={14} /> تواصل الآن
        </a>
      </div>
    </div>
  );
}

// Consulate-scoped dashboard for one embassy. Center: host-country map + a
// data-grounded assistant. Around it: left key-stats, right citizen requests,
// bottom country-scoped alert sections. Every live feed below is filtered
// through the embassy configuration at the DATA layer before it reaches state.
export default function EmbassyDashboard({ embassy, onBack }: EmbassyDashboardProps) {
  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [health, setHealth] = useState<CountryHealthEntry[]>([]);
  const [security, setSecurity] = useState<CountrySecurityProfile[]>([]);
  const [statements, setStatements] = useState<OfficialStatement[]>([]);
  const [weather, setWeather] = useState<EmbassyWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<GeoEvent | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<CitizenRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [geo, hlth, sec, stmts, wthr] = await Promise.allSettled([
        Promise.allSettled([fetchGDACSEvents(), fetchUSGSEarthquakes(), fetchExtraDisasterEvents()])
          .then((settled) => {
            const live = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
            if (settled.every((r) => r.status === 'rejected')) throw new Error('all sources failed');
            return live;
          }),
        fetchHealthCountries(),
        fetchSecurityFeed(),
        fetchOfficialStatements(),
        fetchEmbassyWeather(embassy),
      ]);
      if (cancelled) return;

      setFeedError(geo.status === 'rejected');
      setEvents(geo.status === 'fulfilled' ? geo.value.filter((e) => isEventInEmbassyScope(e, embassy)) : []);
      setHealth(hlth.status === 'fulfilled'
        ? hlth.value.filter((h) => embassy.coveredCountryCodes.includes(h.countryCode) || embassy.coveredCountries.includes(h.country))
        : []);
      setSecurity(sec.status === 'fulfilled'
        ? sec.value.filter((s) => embassy.coveredCountryCodes.includes(s.countryCode))
        : []);
      setStatements(stmts.status === 'fulfilled'
        ? stmts.value.filter((s) =>
            embassy.coveredCountryCodes.includes(s.countryCode) ||
            embassy.coveredCountries.some((c) => s.country?.includes(c) || s.countries?.some((x) => x.includes(c))))
        : []);
      setWeather(wthr.status === 'fulfilled' ? wthr.value : null);
      setLastUpdated(new Date());
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [embassy]);

  // ── DEMO travelers (MOCK_TRAVELERS) — the only citizen-position source that
  //    exists; there is no real registration backend. Counts derived from it
  //    are labeled "تجريبي" in the UI. ────────────────────────────────────
  const travelers = useMemo(
    () => MOCK_TRAVELERS.filter((t) => isTravelerInEmbassyScope(t, embassy)),
    [embassy]
  );

  const dangerEvents = useMemo(
    () => events.filter((e) => e.riskLevel === 'CRITICAL' || e.riskLevel === 'HIGH'),
    [events]
  );

  const citizensNearDanger = useMemo(
    () => travelers.filter((t) =>
      dangerEvents.some((e) => distanceKm(t.lat, t.lng, e.lat, e.lng) <= NEAR_DANGER_KM)),
    [travelers, dangerEvents]
  );

  const activeCases = travelers.filter((t) => t.status === 'ALERTED' || t.status === 'EVACUATED').length;

  // DEMO side-panel data (clearly tagged "تجريبي" in the UI).
  const mockStats = MOCK_EMBASSY_STATS[embassy.id] ?? DEFAULT_MOCK_STATS;
  const citizenRequests = useMemo(() => mockCitizenRequests(embassy), [embassy]);

  // Risk zones — DERIVED deterministically from the live feed: the number of
  // distinct in-scope areas carrying an active HIGH/CRITICAL event. Auditable
  // (not a stored figure); an event with no affectedArea falls back to a coarse
  // country + coordinate bucket so it still counts as one distinct zone.
  const riskZoneCount = useMemo(() => {
    const zones = new Set<string>();
    for (const e of events) {
      if (e.riskLevel === 'CRITICAL' || e.riskLevel === 'HIGH') {
        const key = e.affectedArea?.trim() || `${e.country}:${e.lat.toFixed(0)},${e.lng.toFixed(0)}`;
        zones.add(key);
      }
    }
    return zones.size;
  }, [events]);

  // Overall situation = worst signal across every scoped source.
  const overallRisk: RiskLevel = useMemo(() => {
    const order: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const signals: RiskLevel[] = [
      ...events.map((e) => e.riskLevel),
      ...security.map((s) => s.riskLevel as RiskLevel),
      ...health.map((h) => h.analysis.risk_level.category as RiskLevel),
    ];
    for (const level of order) if (signals.includes(level)) return level;
    return 'SAFE';
  }, [events, security, health]);

  const disasters = useMemo(
    () => [...events].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
    [events]
  );
  const latestStatement = statements[0] ?? null;

  const securityThreats = useMemo(
    () => security.flatMap((p) => p.currentThreats.map((t) => ({ ...t, country: p.country }))).slice(0, 8),
    [security]
  );

  // Scoped situation summary handed to the assistant — the ONLY data it sees.
  const chatbotScope = useMemo(() => ({
    embassyNameAr: embassy.nameAr,
    hostCountryAr: embassy.hostCountryAr,
    contextSummaryAr: [
      `الوضع العام: ${RISK_LABEL_AR[overallRisk]}.`,
      `عدد الأحداث ضمن النطاق: ${events.length} (منها ${dangerEvents.length} حرجة/مرتفعة).`,
      `السعوديون المسجلون ضمن النطاق: ${travelers.length}، منهم ${citizensNearDanger.length} قرب مناطق الخطر و${activeCases} حالة عاجلة.`,
      disasters.length > 0
        ? `أحدث الأحداث: ${disasters.slice(0, 5).map((e) => `${TYPE_LABEL_AR[e.type]} في ${e.country} (${RISK_LABEL_AR[e.riskLevel]})`).join('؛ ')}.`
        : 'لا توجد أحداث نشطة ضمن النطاق حاليًا.',
      latestStatement ? `آخر بيان رسمي: ${latestStatement.title} — ${latestStatement.authority}.` : '',
      `حالة المنافذ: ${embassy.ports.map((p) => `${p.nameAr}: ${PORT_STATUS_AR[p.status]}`).join('؛ ')}.`,
      weather ? `الطقس: ${weather.descriptionAr}، ${weather.temperatureC}°م.` : '',
    ].filter(Boolean).join('\n'),
  }), [embassy, overallRisk, events.length, dangerEvents.length, travelers.length,
       citizensNearDanger.length, activeCases, disasters, latestStatement, weather]);

  // Compact stat bar (replaces the three large stat cards). Colour by status;
  // registered + near-danger are demo (tagged "تجريبي"), risk-zones is real.
  const compactStats: CompactStat[] = [
    {
      key: 'registered', icon: Users, value: mockStats.registered.toLocaleString('en-US'),
      label: 'مسجّلون', color: '#00E676', demo: true,
      description: 'السعوديون المسجلون ضمن نطاق السفارة — بيانات تجريبية (لا يوجد سجل تسجيل حقيقي متصل).',
    },
    {
      key: 'near-danger', icon: ShieldAlert, value: mockStats.nearDanger,
      label: 'قرب الخطر', color: mockStats.nearDanger > 0 ? '#FF6D00' : '#00E676', demo: true,
      description: `مواطنون ضمن ${NEAR_DANGER_KM} كم من حادث حرج/مرتفع — بيانات تجريبية.`,
    },
    {
      key: 'risk-zones', icon: AlertTriangle, value: riskZoneCount,
      label: 'مناطق خطر', color: riskZoneCount > 0 ? '#FF1744' : '#00E676',
      description: 'مناطق ضمن النطاق بها تنبيه حي مرتفع/حرج — مشتقة من التنبيهات الفعلية.',
    },
  ];

  return (
    <div className="app" dir="rtl">
      {/* ── Header — shared shell; a small back arrow returns to the selector. */}
      <AppHeader
        title="لوحة عمليات السفارة"
        subtitle={`${embassy.nameAr} – ${embassy.hostCountryAr}`}
        onBack={onBack}
        statusBadge={{ label: 'وصول محدود', variant: 'limited' }}
        lastUpdated={lastUpdated}
      />

      {loading && (
        <div className="loading-bar"><div className="loading-fill" /></div>
      )}

      <main className="embassy-main">
        {/* ── RIGHT (visual) — consular alerts: country-scoped Global Feed ── */}
        <div className="embassy-consular-col">
          <ConsularAlertsPanel embassy={embassy} />
        </div>

        {/* ── CENTER — host-country map + scope chips + assistant ───────── */}
        <div className="map-section embassy-map-section">
          <div className="embassy-scope-bar" dir="rtl">
            <span className="embassy-scope-chip">
              <MapPin size={10} />
              <b>الدولة المضيفة:</b> {embassy.hostCountryAr}
            </span>
            <span className="embassy-scope-chip">
              <b>الدول المجاورة:</b> {embassy.neighboringCountriesAr.join('، ')}
            </span>
            <span className="embassy-scope-chip">
              <b>نطاق السفارة:</b> {embassy.hostCountryAr} والمناطق التابعة لها
            </span>
          </div>

          <EmbassyMap
            embassy={embassy}
            events={events}
            travelers={travelers}
            selectedEvent={selectedEvent}
            onSelectEvent={setSelectedEvent}
          />

          {!loading && events.length === 0 && (
            <div className="map-empty-overlay">
              {feedError ? 'تعذر جلب البيانات من المصدر الحقيقي' : 'لا توجد تنبيهات نشطة ضمن نطاق السفارة'}
            </div>
          )}

          {selectedEvent && (
            <EventDetail
              event={selectedEvent}
              travelersAtRisk={travelers.filter((t) => t.countryCode === selectedEvent.countryCode).length}
              onClose={() => setSelectedEvent(null)}
            />
          )}

          {selectedRequest && (
            <RequestDetailCard request={selectedRequest} onClose={() => setSelectedRequest(null)} />
          )}

          <AiChatbot scope={chatbotScope} />
        </div>

        {/* ── LEFT (visual) — compact stats bar + citizen requests ─────── */}
        <div className="embassy-ops embassy-requests">
          <CompactStatsBar stats={compactStats} />
          <div className="panel embassy-card embassy-requests-card">
            <div className="panel-header" dir="rtl">
              <Inbox size={13} />
              <span>طلبات وبلاغات المواطنين</span>
              <span className="panel-badge">{citizenRequests.length}</span>
              <span className="embassy-demo-tag">تجريبي</span>
            </div>
            <div className="embassy-requests-hint">اضغط على أي طلب لعرض تفاصيله ومساره — بيانات تجريبية غير مرتبطة بمصدر حقيقي.</div>
            <div className="embassy-card-body case-detail-scrollable">
              {citizenRequests.length === 0 ? (
                <div className="widget-empty-state">
                  لا توجد طلبات أو بلاغات حالياً.
                </div>
              ) : (
                citizenRequests.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`embassy-item request-row${selectedRequest?.id === r.id ? ' selected' : ''}`}
                    onClick={() => setSelectedRequest(r)}
                  >
                    <span className="embassy-item-dot" style={{ background: PRIORITY_COLOR[r.priority] }} />
                    <span className="embassy-item-main">
                      <span className="embassy-item-title">{r.titleAr}</span>
                      <span className="embassy-item-meta">
                        {REQUEST_KIND_AR[r.kind]} · {r.departmentAr} · <Clock size={9} /> {timeAgoAr(r.submittedAt)}
                      </span>
                    </span>
                    <span className="request-row-side">
                      <span className="embassy-sev-chip" style={{ color: PRIORITY_COLOR[r.priority], borderColor: PRIORITY_COLOR[r.priority] }}>
                        {PRIORITY_AR[r.priority]}
                      </span>
                      <span className="request-stage-tag">{STAGE_AR[r.stage]}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── BOTTOM — country-scoped alert sections (reused feeds) ─────── */}
        <div className="embassy-bottom">
          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Flame size={13} />
              <span>الكوارث الطبيعية</span>
              <span className="panel-badge">{disasters.length}</span>
            </div>
            <div className="embassy-card-body">
              {disasters.length === 0 && (
                <div className="widget-empty-state">
                  {loading ? 'جارِ جلب البيانات…' : feedError ? 'تعذر جلب البيانات من المصدر' : 'لا توجد كوارث نشطة ضمن النطاق'}
                </div>
              )}
              {disasters.slice(0, 8).map((e) => (
                <button key={e.id} type="button" className="embassy-item" onClick={() => setSelectedEvent(e)}>
                  <span className="embassy-item-dot" style={{ background: RISK_COLORS[e.riskLevel] }} />
                  <span className="embassy-item-main">
                    <span className="embassy-item-title">{TYPE_LABEL_AR[e.type]} — {e.country}</span>
                    <span className="embassy-item-meta">
                      <Clock size={9} /> {timeAgoAr(e.timestamp)} · {e.source}
                    </span>
                  </span>
                  <span className="embassy-sev-chip" style={{ color: RISK_COLORS[e.riskLevel], borderColor: RISK_COLORS[e.riskLevel] }}>
                    {RISK_LABEL_AR[e.riskLevel]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <HeartPulse size={13} />
              <span>الصحة</span>
              <span className="panel-badge">{health.length}</span>
            </div>
            <div className="embassy-card-body">
              {health.length === 0 && (
                <div className="widget-empty-state">
                  {loading ? 'جارِ جلب البيانات…' : 'لا توجد تنبيهات صحية ضمن النطاق'}
                </div>
              )}
              {health.map((h) => (
                <div key={`${h.countryCode}-${h.disease}`} className="embassy-item static">
                  <span className="embassy-item-dot" style={{ background: RISK_COLORS[h.analysis.risk_level.category as RiskLevel] ?? '#888' }} />
                  <span className="embassy-item-main">
                    <span className="embassy-item-title">{h.disease}</span>
                    <span className="embassy-item-meta">احتمالية التفشي {h.analysis.outbreak_forecast.probability}%</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Siren size={13} />
              <span>التنبيهات الأمنية</span>
              <span className="panel-badge">{securityThreats.length}</span>
            </div>
            <div className="embassy-card-body">
              {securityThreats.length === 0 && (
                <div className="widget-empty-state">
                  {loading ? 'جارِ جلب البيانات…' : 'لا توجد تنبيهات أمنية ضمن النطاق'}
                </div>
              )}
              {securityThreats.map((t, i) => (
                <div key={i} className="embassy-item static">
                  <span className="embassy-item-dot" style={{ background: RISK_COLORS[t.severity as RiskLevel] ?? '#888' }} />
                  <span className="embassy-item-main">
                    <span className="embassy-item-title">{t.title}</span>
                    <span className="embassy-item-meta">{t.source} · {t.time}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Plane size={13} />
              <span>المطارات والحدود</span>
            </div>
            <div className="embassy-card-body">
              {embassy.ports.map((p) => (
                <div key={p.nameAr} className="embassy-item static compact">
                  <span className="embassy-item-title">{p.nameAr}</span>
                  <span className="embassy-sev-chip" style={{ color: PORT_STATUS_COLOR[p.status], borderColor: PORT_STATUS_COLOR[p.status] }}>
                    {PORT_STATUS_AR[p.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
