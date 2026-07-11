import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Building2, ShieldAlert, Users, Siren, MapPin, Clock,
  Flame, HeartPulse, ListChecks, FileText, Megaphone, ArrowUpRight,
  Plane, Anchor, Landmark, CloudSun, Phone, Mail, Radio, CheckCircle2,
} from 'lucide-react';
import EmbassyMap from './EmbassyMap';
import EventDetail from '../EventDetail';
import AiChatbot from '../AiChatbot';
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
  getCurrentAccess, PORT_STATUS_AR, PORT_STATUS_COLOR,
  type EmbassyConfig,
} from '../../services/embassies';
import {
  fetchEmbassyWeather, DEMO_EMBASSY_TASKS, TASK_TYPE_AR, TASK_STATUS_AR,
  type EmbassyWeather,
} from '../../services/embassyOps';
import { RISK_COLORS, TYPE_LABEL_AR } from '../../constants';
import type { GeoEvent, RiskLevel, Traveler } from '../../types';

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

const PORT_TYPE_ICON = { AIRPORT: Plane, SEAPORT: Anchor, LAND_BORDER: Landmark } as const;

// Embassy-scoped operations sub-dashboard. Same design system as the main
// dashboard (panels, badges, markers, RTL), narrower data scope: every list
// below is filtered through the embassy configuration BEFORE rendering.
export default function EmbassyDashboard({ embassy, onBack }: EmbassyDashboardProps) {
  const access = getCurrentAccess();

  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [health, setHealth] = useState<CountryHealthEntry[]>([]);
  const [security, setSecurity] = useState<CountrySecurityProfile[]>([]);
  const [statements, setStatements] = useState<OfficialStatement[]>([]);
  const [weather, setWeather] = useState<EmbassyWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<GeoEvent | null>(null);
  const [showCitizensNearDanger, setShowCitizensNearDanger] = useState(false);
  const [actionSent, setActionSent] = useState<string | null>(null);

  // Scope filter applied at the DATA layer: global feeds are reduced to the
  // embassy's coverage before anything reaches component state below.
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

  const riskColor = RISK_COLORS[overallRisk];

  function fireAction(label: string) {
    setActionSent(label);
    setTimeout(() => setActionSent(null), 2500);
  }

  return (
    <div className="app" dir="rtl">
      {/* ── Header — same shell as the main dashboard ─────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-block">
            <img src="/mofa-logo.svg" alt="MOFA" height={36} />
          </div>
          <button type="button" className="embassy-back-btn" onClick={onBack}>
            <ArrowRight size={13} />
            العودة إلى اللوحة الرئيسية
          </button>
        </div>
        <div className="header-center">
          <div className="system-title-block">
            <span className="system-name-ar">لوحة عمليات السفارة</span>
            <span className="system-name-en">{embassy.nameAr} – {embassy.hostCountryAr}</span>
          </div>
          <div className="system-badge">
            <span className="embassy-scope-badge" title="صلاحيات هذه اللوحة محدودة بنطاق السفارة">
              <ShieldAlert size={10} />
              وصول محدود
            </span>
          </div>
        </div>
        <div className="header-right">
          {lastUpdated && (
            <span className="header-updated">آخر تحديث {lastUpdated.toLocaleTimeString('ar-SA')}</span>
          )}
        </div>
      </header>

      {loading && (
        <div className="loading-bar"><div className="loading-fill" /></div>
      )}

      <main className="embassy-main">
        {/* ── Left sidebar — embassy-relevant categories only ──────────── */}
        <div className="embassy-sidebar">
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
              {disasters.slice(0, 10).map((e) => (
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
              <ListChecks size={13} />
              <span>مهام السفارة</span>
              <span className="panel-badge">{DEMO_EMBASSY_TASKS.length}</span>
            </div>
            <div className="embassy-card-body">
              {DEMO_EMBASSY_TASKS.map((task) => (
                <div key={task.id} className="embassy-task">
                  <div className="embassy-task-top">
                    <span className="embassy-task-type">{TASK_TYPE_AR[task.type]}</span>
                    <span className={`embassy-task-status s-${task.status.toLowerCase()}`}>{TASK_STATUS_AR[task.status]}</span>
                  </div>
                  <div className="embassy-item-title">{task.titleAr}</div>
                  <div className="score-bar"><div className="score-fill" style={{ width: `${task.progressPct}%`, background: 'var(--saudi-gold)' }} /></div>
                  <div className="embassy-item-meta">{task.updatedAgoAr}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center — scope chips + host-country map ───────────────────── */}
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

          <AiChatbot scope={chatbotScope} />
        </div>

        {/* ── Right operations panel ────────────────────────────────────── */}
        <div className="embassy-ops">
          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Radio size={13} />
              <span>الوضع العام</span>
            </div>
            <div className="embassy-ops-risk" style={{ borderColor: riskColor }}>
              <span className="embassy-ops-risk-label" style={{ color: riskColor }}>{RISK_LABEL_AR[overallRisk]}</span>
              <span className="embassy-item-meta">مستوى الخطر الحالي ضمن نطاق السفارة</span>
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Users size={13} />
              <span>السعوديون المسجلون</span>
            </div>
            <div className="embassy-ops-stat">
              <span className="embassy-ops-num mono-num">{travelers.length}</span>
              {lastUpdated && <span className="embassy-item-meta">آخر تحديث {lastUpdated.toLocaleTimeString('ar-SA')}</span>}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Siren size={13} />
              <span>الحالات العاجلة</span>
            </div>
            <div className="embassy-ops-stat">
              <span className="embassy-ops-num mono-num" style={{ color: activeCases > 0 ? 'var(--danger-critical)' : undefined }}>
                {activeCases}
              </span>
              <span className="embassy-item-meta">حالة نشطة قيد المتابعة</span>
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <ShieldAlert size={13} />
              <span>المواطنون قرب الخطر</span>
              <span className="panel-badge">{citizensNearDanger.length}</span>
            </div>
            <button
              type="button"
              className="embassy-ops-stat clickable"
              onClick={() => setShowCitizensNearDanger((v) => !v)}
              aria-expanded={showCitizensNearDanger}
            >
              <span className="embassy-ops-num mono-num" style={{ color: citizensNearDanger.length > 0 ? 'var(--danger-medium)' : undefined }}>
                {citizensNearDanger.length}
              </span>
              <span className="embassy-item-meta">ضمن {NEAR_DANGER_KM} كم من حادث نشط — اضغط للعرض</span>
            </button>
            {showCitizensNearDanger && (
              <div className="embassy-card-body">
                {citizensNearDanger.length === 0 && (
                  <div className="widget-empty-state">لا يوجد مواطنون قرب مناطق الخطر حاليًا</div>
                )}
                {/* Authorized fields only — no passport numbers or phone numbers */}
                {citizensNearDanger.map((t: Traveler) => (
                  <div key={t.id} className="embassy-item static">
                    <span className="embassy-item-dot" style={{ background: 'var(--danger-medium)' }} />
                    <span className="embassy-item-main">
                      <span className="embassy-item-title">{t.nameAr}</span>
                      <span className="embassy-item-meta">{t.destination} · {t.status === 'ALERTED' ? 'تم تنبيهه' : t.status === 'EVACUATED' ? 'تم إجلاؤه' : 'نشط'}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <FileText size={13} />
              <span>آخر بيان رسمي</span>
            </div>
            <div className="embassy-card-body">
              {latestStatement ? (
                <div className="embassy-item static">
                  <span className="embassy-item-main">
                    <span className="embassy-item-title">{latestStatement.title}</span>
                    <span className="embassy-item-meta">{latestStatement.authority} · {timeAgoAr(latestStatement.publishedAt)}</span>
                  </span>
                </div>
              ) : (
                <div className="widget-empty-state">
                  {loading ? 'جارِ جلب البيانات…' : 'لا توجد بيانات رسمية ضمن النطاق'}
                </div>
              )}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Plane size={13} />
              <span>حالة المطارات والحدود</span>
            </div>
            <div className="embassy-card-body">
              {embassy.ports.map((p) => {
                const Icon = PORT_TYPE_ICON[p.type];
                return (
                  <div key={p.nameAr} className="embassy-item static">
                    <Icon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span className="embassy-item-main">
                      <span className="embassy-item-title">{p.nameAr}</span>
                    </span>
                    <span className="embassy-sev-chip" style={{ color: PORT_STATUS_COLOR[p.status], borderColor: PORT_STATUS_COLOR[p.status] }}>
                      {PORT_STATUS_AR[p.status]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Field actions — permission-gated at the access layer */}
          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Megaphone size={13} />
              <span>إجراءات ميدانية</span>
            </div>
            <div className="embassy-actions">
              {access.canSubmitFieldReport && (
                <button type="button" className="embassy-action-btn" onClick={() => fireAction('تم إرسال التقرير الميداني')}>
                  <FileText size={12} /> تقرير ميداني
                </button>
              )}
              {access.canCreateFollowUpTask && (
                <button type="button" className="embassy-action-btn" onClick={() => fireAction('تم إنشاء مهمة متابعة')}>
                  <ListChecks size={12} /> مهمة متابعة
                </button>
              )}
              {access.canRequestEscalation && (
                <button type="button" className="embassy-action-btn" onClick={() => fireAction('تم إرسال طلب التصعيد لمركز القيادة')}>
                  <ArrowUpRight size={12} /> طلب تصعيد
                </button>
              )}
              {access.canDraftCitizenAlert && (
                <button type="button" className="embassy-action-btn" onClick={() => fireAction('تم حفظ مسودة تنبيه المواطنين')}>
                  <Megaphone size={12} /> مسودة تنبيه
                </button>
              )}
              {actionSent && (
                <div className="embassy-action-sent"><CheckCircle2 size={11} /> {actionSent}</div>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom strip ─────────────────────────────────────────────── */}
        <div className="embassy-bottom">
          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Clock size={13} />
              <span>آخر المستجدات المحلية</span>
            </div>
            <div className="embassy-card-body horizontal">
              {disasters.length === 0 && (
                <div className="widget-empty-state">لا توجد مستجدات محلية حاليًا</div>
              )}
              {disasters.slice(0, 6).map((e) => (
                <button key={e.id} type="button" className="embassy-timeline-item" onClick={() => setSelectedEvent(e)}>
                  <span className="embassy-sev-chip" style={{ color: RISK_COLORS[e.riskLevel], borderColor: RISK_COLORS[e.riskLevel] }}>
                    {RISK_LABEL_AR[e.riskLevel]}
                  </span>
                  <span className="embassy-item-title">{TYPE_LABEL_AR[e.type]} — {e.country}</span>
                  <span className="embassy-item-meta">{timeAgoAr(e.timestamp)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Building2 size={13} />
              <span>المطارات والمنافذ الرئيسية</span>
            </div>
            <div className="embassy-card-body">
              {embassy.ports.slice(0, 4).map((p) => (
                <div key={p.nameAr} className="embassy-item static compact">
                  <span className="embassy-item-title">{p.nameAr}</span>
                  <span className="embassy-sev-chip" style={{ color: PORT_STATUS_COLOR[p.status], borderColor: PORT_STATUS_COLOR[p.status] }}>
                    {PORT_STATUS_AR[p.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <CloudSun size={13} />
              <span>الطقس الحالي</span>
            </div>
            <div className="embassy-card-body">
              {weather ? (
                <div className="embassy-weather">
                  <span className="embassy-ops-num mono-num">{weather.temperatureC}°</span>
                  <span className="embassy-item-main">
                    <span className="embassy-item-title">{weather.descriptionAr} — {embassy.cityAr}</span>
                    <span className="embassy-item-meta">
                      رياح {weather.windKmh} كم/س{weather.humidityPct != null ? ` · رطوبة ${weather.humidityPct}%` : ''}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="widget-empty-state">{loading ? 'جارِ جلب الطقس…' : 'بيانات الطقس غير متاحة'}</div>
              )}
            </div>
          </div>

          <div className="panel embassy-card">
            <div className="panel-header" dir="rtl">
              <Phone size={13} />
              <span>التواصل في حالات الطوارئ</span>
            </div>
            <div className="embassy-card-body">
              <div className="embassy-item static compact">
                <Phone size={11} style={{ color: 'var(--text-muted)' }} />
                <span className="embassy-item-title">هاتف الطوارئ: {embassy.contacts.emergencyPhone ?? 'غير متاح'}</span>
              </div>
              <div className="embassy-item static compact">
                <Phone size={11} style={{ color: 'var(--text-muted)' }} />
                <span className="embassy-item-title">هاتف السفارة: {embassy.contacts.phone ?? 'غير متاح'}</span>
              </div>
              <div className="embassy-item static compact">
                <Mail size={11} style={{ color: 'var(--text-muted)' }} />
                <span className="embassy-item-title">البريد الرسمي: {embassy.contacts.email ?? 'غير متاح'}</span>
              </div>
              <div className="embassy-item static compact">
                <Clock size={11} style={{ color: 'var(--text-muted)' }} />
                <span className="embassy-item-title">ساعات العمل: {embassy.contacts.workingHoursAr ?? 'غير متاح'}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
