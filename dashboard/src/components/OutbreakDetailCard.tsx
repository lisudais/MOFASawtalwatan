import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, Radio, CalendarClock } from 'lucide-react';
import {
  riskBandFor, riskScore10, RISK_BAND_SCALE, regionalActivityAr, recommendationsFor,
  FORECAST_HORIZON_AR, type ResolvedOutbreak, type OutbreakMeta,
} from '../services/forecasting/outbreakForecast';
import { explainOutbreak, reasonHeuristic, type OutbreakReason } from '../services/outbreakAi';

const NA_AR = 'البيانات غير متوفرة';
const SOURCE_AR = 'منظمة الصحة العالمية — أخبار تفشي الأمراض';
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function monthYear(d: string | null | undefined): string {
  if (!d) return NA_AR;
  const [y, m] = d.split('-');
  const mi = Number(m) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS_AR[mi]} ${y}` : (y ?? NA_AR);
}

// Compact floating outbreak card — same footprint/behaviour as the Gold card
// (.event-detail-card): position:absolute inside .map-section, floating over the
// bottom of the map, never over the left dashboard column. Portaled into
// .map-section so it floats over the map whether opened from a map marker or the
// health list. The calibrated XGBoost probability is the single source of truth;
// gpt-oss only words the "why"; the recommendation is deterministic.
export default function OutbreakDetailCard({ f, meta, onClose }:
  { f: ResolvedOutbreak; meta: OutbreakMeta | null; onClose: () => void }) {
  // ONE decimal — the exact calibrated probability, matching the list; never
  // rounded to a whole number (keeps display == raw calibrated value).
  const pct = (f.probability * 100).toFixed(1);
  const band = riskBandFor(f.probability);
  const score = riskScore10(f.probability);
  const col = band.color;
  const h = f.history;

  // Never empty: deterministic reason first, upgraded to gpt-oss wording if the
  // local model answers. The probability is never taken from the model.
  const [reason, setReason] = useState<OutbreakReason>(() => reasonHeuristic(f));
  const [details, setDetails] = useState(false);
  const key = `${f.iso2}|${f.disease}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    setReason(reasonHeuristic(f));
    setDetails(false);
    const controller = new AbortController();
    explainOutbreak(f, controller.signal).then((r) => {
      if (keyRef.current === key) setReason(r);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const lastObserved = meta?.source_data_last_observed_date ?? null;
  const regAr = regionalActivityAr(f.regional?.affected_neighbours_recent);
  const seasonAr = f.explanation_factors?.seasonal_match ? 'بارزة' : 'غير بارزة';

  const head = (
    <div className="od-head">
      <span className="od-risk-badge" style={{ background: `${col}22`, color: col, borderColor: col }}>{band.ar} · {band.en}</span>
      <h3 className="od-title">{f.disease}</h3>
      <span className="od-country">{f.countryAr} · {f.country}</span>
    </div>
  );

  const inner = details ? (
    // ── More details (epidemiological) view ──────────────────────────────────
    <>
      <button type="button" className="od-back" onClick={() => setDetails(false)}>
        <ArrowRight size={13} /> رجوع
      </button>
      {head}
      <div className="od-dsection">
        <h4 className="od-dtitle">السجل الوبائي</h4>
        <div className="od-drows">
          <div><span>آخر تفشٍ</span><b>{monthYear(h.last_outbreak_date)}</b></div>
          <div><span>الأشهر منذ آخر تفشٍ</span><b>{h.months_since_last_outbreak ?? NA_AR}</b></div>
          <div><span>إجمالي التفشيات التاريخية</span><b>{h.historical_outbreak_count ?? NA_AR}</b></div>
          <div><span>تفشيات آخر 5 سنوات</span><b>{h.outbreaks_last_5_years ?? NA_AR}</b></div>
          <div><span>متوسط الفترة بين التفشيات</span><b>{h.average_interval_months == null ? NA_AR : `${h.average_interval_months} شهرًا`}</b></div>
          <div><span>أقصى حالات تاريخية</span><b>{h.max_historical_cases ?? NA_AR}</b></div>
          <div><span>أقصى وفيات تاريخية</span><b>{h.max_historical_deaths ?? NA_AR}</b></div>
        </div>
        {h.timeline && h.timeline.length > 0 && (
          <div className="od-timeline">
            {h.timeline.map((d) => <span key={d} className="od-timeline-dot"><i /><small>{d}</small></span>)}
          </div>
        )}
      </div>
      <div className="od-dsection">
        <h4 className="od-dtitle">الوضع الإقليمي</h4>
        <div className="od-drows">
          <div><span>الدول المجاورة</span><b>{f.regional?.neighbouring_count || NA_AR}</b></div>
          <div><span>متأثرة مؤخرًا</span><b>{f.regional?.affected_neighbours_recent ?? 0}</b></div>
          <div><span>مستوى النشاط الإقليمي</span><b>{regAr}</b></div>
          {f.regional?.neighbouring_countries?.length ? (
            <div><span>الجوار</span><b>{f.regional.neighbouring_countries.join('، ')}</b></div>
          ) : null}
        </div>
      </div>
      <div className="od-dsection">
        <h4 className="od-dtitle">نطاق التوقع</h4>
        <div className="od-drows">
          <div><span>أفق التوقع</span><b>{FORECAST_HORIZON_AR}</b></div>
          <div><span>فترة التوقع</span><b>{f.forecast_period_start && f.forecast_period_end ? `${f.forecast_period_start} ← ${f.forecast_period_end}` : NA_AR}</b></div>
          <div><span>تاريخ إنشاء التوقع</span><b>{meta?.prediction_generation_date ?? NA_AR}</b></div>
          <div><span>آخر رصد للبيانات</span><b>{lastObserved ?? NA_AR}</b></div>
        </div>
      </div>
      <div className="od-foot">
        <span><Radio size={11} /> المصدر: {SOURCE_AR}</span>
      </div>
    </>
  ) : (
    // ── Main (executive) view ────────────────────────────────────────────────
    <>
      {head}
      <div className="od-main">
        <div className="od-prob" style={{ color: col }}>
          <span className="od-prob-num mono-num">{pct}%</span>
          <span className="od-prob-label">احتمال تفشٍ متوقع خلال {FORECAST_HORIZON_AR}</span>
        </div>
        <div className="od-score">
          <span className="od-score-num mono-num" style={{ color: col }}>{score}<i>/10</i></span>
          <span className="od-score-label">درجة الخطر</span>
        </div>
      </div>
      <div className="od-scale">
        <div className="od-scale-bar" dir="ltr">
          <div className="od-scale-fill" style={{ background: `linear-gradient(to right, ${RISK_BAND_SCALE.map((b) => b.color).join(', ')})` }} />
          <span className="od-scale-marker" style={{ left: `${score * 10}%`, borderColor: col }} />
        </div>
      </div>
      <div className="od-reason">
        <h4 className="od-reason-title">سبب التوقع</h4>
        <p className="od-reason-p">{reason.reason_ar}</p>
      </div>
      <div className="od-chips">
        <div className="od-chip"><span>آخر تفشٍ</span><b>{monthYear(h.last_outbreak_date)}</b></div>
        <div className="od-chip"><span>تفشيات تاريخية</span><b>{h.historical_outbreak_count ?? NA_AR}</b></div>
        <div className="od-chip"><span>نشاط إقليمي</span><b>{regAr}</b></div>
        <div className="od-chip"><span>الموسمية</span><b>{seasonAr}</b></div>
      </div>
      <div className="od-rec">
        <span className="od-rec-label">التوصيات</span>
        <ul className="od-rec-list">
          {recommendationsFor(f).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
      <div className="od-foot">
        <span><Radio size={11} /> المصدر: {SOURCE_AR}</span>
        <span><CalendarClock size={11} /> آخر رصد للبيانات: {lastObserved ?? NA_AR}</span>
        <button type="button" className="od-more" onClick={() => setDetails(true)}>المزيد من التفاصيل</button>
      </div>
    </>
  );

  const card = (
    <div className="od-card" dir="rtl" role="dialog" aria-modal="false" aria-label="تفاصيل توقع التفشي">
      <button type="button" className="od-close" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
      {inner}
    </div>
  );

  // Float over the map like the Gold card, regardless of which component opened
  // it. Falls back to inline render if the map section isn't in the DOM.
  const mount = typeof document !== 'undefined' ? document.querySelector('.map-section') : null;
  return mount ? createPortal(card, mount) : card;
}
