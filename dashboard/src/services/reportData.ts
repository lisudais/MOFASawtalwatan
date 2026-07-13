// Report data gatherer — folds the dashboard's CURRENT on-screen state into a
// compact, per-section raw-data block. No fetch, no API: every figure here is
// already displayed somewhere on the board when the user clicks "تصدير التقرير".
//
// Each section yields:
//   • `data`     — the raw figures handed to gpt-oss as {raw_section_data}
//   • `fallback` — a deterministic Arabic sentence used verbatim if the local
//                  model (Ollama) is unreachable, so the report always renders.
//
// The prose itself is written by gpt-oss (see reportSummary.ts); this module
// only assembles the facts and never phrases the final report text.

import type { GeoEvent, RiskLevel } from '../types';
import {
  computeRegionalForecast, HEALTH_REGION_LABEL_AR,
  type CountryHealthEntry, type Trend,
} from './healthAnalysis';
import type { CountrySecurityProfile } from './security';
import type { EconomicIndicator } from './economy';
import { getSaudisAbroadData } from './mockData';
import { countryNameAr } from './feed/countryNames';
import { TYPE_LABEL_AR } from '../constants';

const RISK_LABEL_AR: Record<RiskLevel, string> = {
  CRITICAL: 'حرج', HIGH: 'مرتفع', MEDIUM: 'متوسط', LOW: 'منخفض', SAFE: 'آمن',
};
const TREND_AR: Record<Trend, string> = { RISING: 'صاعد', FALLING: 'هابط', STABLE: 'مستقر' };
const SEV_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const en = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** Everything the report reads — a snapshot of the live dashboard state. */
export interface ReportInputs {
  events: GeoEvent[];
  healthCountries: CountryHealthEntry[];
  securityCountries: CountrySecurityProfile[];
  economyIndicators: EconomicIndicator[];
}

export interface SectionRaw {
  key: string;
  title: string;
  /** Raw figures block → gpt-oss {raw_section_data}. */
  data: string;
  /** Deterministic paragraph used if the local model can't be reached. */
  fallback: string;
}

/* ── 1. الصحة ─────────────────────────────────────────────────────────── */
function healthSection(h: CountryHealthEntry[]): SectionRaw {
  const title = 'الصحة';
  if (h.length === 0) {
    return { key: 'health', title, data: 'لا توجد بيانات صحية متاحة حاليًا.',
      fallback: 'لا ترصد المصادر الصحية أي دولة متأثرة ضمن نطاق المتابعة حتى تاريخ هذا التقرير.' };
  }
  const top3 = [...h].sort((a, b) => b.riskScore - a.riskScore).slice(0, 3);
  const rf = computeRegionalForecast(h);
  const topList = top3.map((c) => `${c.country} (${c.disease}) بدرجة خطورة ${c.riskScore}`).join('، ');
  const data = [
    `عدد الدول المتأثرة حاليًا: ${h.length}.`,
    `أعلى 3 دول خطورة: ${topList}.`,
    `التوقع الإقليمي العام: أعلى منطقة هي ${HEALTH_REGION_LABEL_AR[rf.topRegion]} باحتمال تفشٍّ متوسط ${rf.topRegionProbability}% واتجاه ${TREND_AR[rf.topRegionTrend]}.`,
  ].join('\n');
  const fallback = `تُظهر المؤشرات الصحية ${h.length} دولة متأثرة، في مقدمتها ${top3[0].country} بدرجة خطورة ${top3[0].riskScore}، مع تركّز التوقعات الإقليمية في منطقة ${HEALTH_REGION_LABEL_AR[rf.topRegion]} باحتمال تفشٍّ يقارب ${rf.topRegionProbability}% واتجاه ${TREND_AR[rf.topRegionTrend]}.`;
  return { key: 'health', title, data, fallback };
}

/* ── 2. الكوارث الطبيعية ──────────────────────────────────────────────── */
function disastersSection(events: GeoEvent[]): SectionRaw {
  const title = 'الكوارث الطبيعية';
  if (events.length === 0) {
    return { key: 'disasters', title, data: 'لا توجد أحداث طبيعية نشطة حاليًا.',
      fallback: 'لا تُرصد أي كوارث طبيعية نشطة ضمن المصادر الحقيقية حتى تاريخ هذا التقرير.' };
  }
  const byType = new Map<GeoEvent['type'], number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  const dist = [...byType.entries()].sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${TYPE_LABEL_AR[t]} ${n}`).join('، ');
  const top3 = [...events].sort((a, b) => b.score - a.score).slice(0, 3)
    .map((e) => `${TYPE_LABEL_AR[e.type]} في ${e.country} (${RISK_LABEL_AR[e.riskLevel]})`).join('؛ ');
  const data = [
    `إجمالي الأحداث النشطة: ${events.length}.`,
    `التوزيع حسب النوع: ${dist}.`,
    `أخطر 3 أحداث حاليًا: ${top3}.`,
  ].join('\n');
  const fallback = `يُرصد ${events.length} حدثًا طبيعيًا نشطًا موزّعة على (${dist})، وأبرزها ${top3}.`;
  return { key: 'disasters', title, data, fallback };
}

/* ── 3. التهديدات الأمنية ─────────────────────────────────────────────── */
function securitySection(sec: CountrySecurityProfile[]): SectionRaw {
  const title = 'التهديدات الأمنية';
  if (sec.length === 0) {
    return { key: 'security', title, data: 'لا توجد تهديدات أمنية نشطة حاليًا.',
      fallback: 'لا تُظهر المصادر الأمنية أي نشاط مرتفع ضمن نطاق المتابعة حتى تاريخ هذا التقرير.' };
  }
  const sorted = [...sec].sort((a, b) => b.riskScore - a.riskScore);
  const totalIncidents = sec.reduce((s, c) => s + c.activeIncidents, 0);
  const topCountries = sorted.slice(0, 3).map((c) => `${c.country} (${c.riskScore})`).join('، ');
  const threats = sec.flatMap((c) => c.currentThreats.map((t) => ({ ...t, country: c.country })));
  const topThreat = threats.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))[0];
  const data = [
    `عدد الدول ذات النشاط الأمني: ${sec.length}.`,
    `إجمالي الحوادث النشطة: ${totalIncidents}.`,
    `أعلى الدول تصنيفًا بالخطورة: ${topCountries}.`,
    topThreat ? `أبرز حدث أمني حالي: ${topThreat.title} في ${topThreat.country} (المصدر: ${topThreat.source}).`
              : 'لا يوجد حدث أمني بارز ضمن القائمة.',
  ].join('\n');
  const fallback = `تُرصد أنشطة أمنية في ${sec.length} دولة بإجمالي ${totalIncidents} حادثًا نشطًا، وأعلاها تصنيفًا ${sorted[0].country} (${sorted[0].riskScore})`
    + (topThreat ? `، وأبرز حدث حالي هو ${topThreat.title} في ${topThreat.country}.` : '.');
  return { key: 'security', title, data, fallback };
}

/* ── 4. الدول الأكثر خطورة (تجميعي) ───────────────────────────────────── */
function topCountriesSection(inp: ReportInputs): SectionRaw {
  const title = 'الدول الأكثر خطورة (تجميعي)';
  // Highest single risk score per ISO2 across the three per-country sources.
  // Economy indicators are GLOBAL commodities (oil/gold/gas), not tied to a
  // country, so they don't contribute a per-country score — noted in the block.
  const best = new Map<string, number>();
  const bump = (code: string | undefined, s: number) => {
    if (!code) return;
    if (s > (best.get(code) ?? -1)) best.set(code, s);
  };
  for (const e of inp.events) bump(e.countryCode, e.score);
  for (const c of inp.securityCountries) bump(c.countryCode, c.riskScore);
  for (const h of inp.healthCountries) bump(h.countryCode, h.riskScore);

  if (best.size === 0) {
    return { key: 'top-countries', title, data: 'لا توجد دول ذات خطورة نشطة حاليًا.',
      fallback: 'لا توجد دول مصنّفة ذات خطورة نشطة عبر مصادر الصحة والكوارث والأمن حتى تاريخ هذا التقرير.' };
  }
  const registered = new Map(getSaudisAbroadData().countries.map((c) => [c.countryCode, c.count]));
  const top5 = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lines = top5.map(([code, score], i) => {
    const reg = registered.get(code);
    return `${i + 1}. ${countryNameAr(code)} — درجة الخطورة ${score} — السعوديون المسجلون: ${reg != null ? en(reg) : 'غير متوفر'}`;
  }).join('\n');
  const data = `أعلى الدول خطورة تجميعيًا (أعلى درجة عبر الصحة والكوارث والأمن؛ المؤشرات الاقتصادية عالمية غير مرتبطة بدولة بعينها):\n${lines}`;
  const [tc, ts] = top5[0];
  const topReg = registered.get(tc);
  const fallback = `تتصدّر ${countryNameAr(tc)} قائمة الدول الأكثر خطورة تجميعيًا بدرجة ${ts}`
    + (topReg != null ? ` ويقيم بها نحو ${en(topReg)} سعودي مسجّل` : '')
    + `، تليها ${top5.slice(1).map(([c]) => countryNameAr(c)).join('، ')}.`;
  return { key: 'top-countries', title, data, fallback };
}

/* ── 5. التغيرات الاقتصادية ───────────────────────────────────────────── */
function economySection(inds: EconomicIndicator[]): SectionRaw {
  const title = 'التغيرات الاقتصادية';
  if (inds.length === 0) {
    return { key: 'economy', title, data: 'لا توجد مؤشرات اقتصادية متاحة حاليًا.',
      fallback: 'تعذّر توفّر بيانات المؤشرات الاقتصادية (النفط والذهب والغاز) من المصدر الحقيقي حتى تاريخ هذا التقرير.' };
  }
  const list = inds.map((i) => `${i.nameAr}: ${en(i.value)} ${i.unit} (${signed(i.changePercent)}%)`).join('؛ ');
  const notable = [...inds].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))[0];
  const data = [
    `المؤشرات الحالية: ${list}.`,
    `أبرز تغيّر: ${notable.nameAr} بنسبة ${signed(notable.changePercent)}%.`,
  ].join('\n');
  const fallback = `تشير المؤشرات الاقتصادية إلى ${list}، وأبرز تغيّر هو ${notable.nameAr} بنسبة ${signed(notable.changePercent)}%.`;
  return { key: 'economy', title, data, fallback };
}

/** The five sections in the report's canonical order. */
export function buildReportSections(inp: ReportInputs): SectionRaw[] {
  return [
    healthSection(inp.healthCountries),
    disastersSection(inp.events),
    securitySection(inp.securityCountries),
    topCountriesSection(inp),
    economySection(inp.economyIndicators),
  ];
}
