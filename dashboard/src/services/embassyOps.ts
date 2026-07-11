// Embassy operational data helpers.
//
// - Weather: REAL, keyless Open-Meteo API (no mock).
// - Tasks: demo placeholders, exported from ONE clearly-marked constant so
//   they stay isolated from production APIs and are trivial to replace with
//   the real case-management backend later.

import type { EmbassyConfig } from './embassies';

/* ─── Weather (real — Open-Meteo, keyless) ───────────────────────────── */

export interface EmbassyWeather {
  temperatureC: number;
  windKmh: number;
  humidityPct: number | null;
  descriptionAr: string;
  fetchedAt: Date;
}

// WMO weather codes → short Arabic description.
const WMO_AR: Record<number, string> = {
  0: 'صافٍ', 1: 'صافٍ غالبًا', 2: 'غائم جزئيًا', 3: 'غائم',
  45: 'ضباب', 48: 'ضباب متجمد',
  51: 'رذاذ خفيف', 53: 'رذاذ', 55: 'رذاذ كثيف',
  61: 'مطر خفيف', 63: 'مطر', 65: 'مطر غزير',
  71: 'ثلوج خفيفة', 73: 'ثلوج', 75: 'ثلوج كثيفة',
  80: 'زخات مطر', 81: 'زخات مطر', 82: 'زخات غزيرة',
  95: 'عاصفة رعدية', 96: 'عاصفة رعدية مع برد', 99: 'عاصفة رعدية شديدة',
};

export async function fetchEmbassyWeather(embassy: EmbassyConfig): Promise<EmbassyWeather | null> {
  try {
    const { lat, lng } = embassy.coordinates;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code';
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data?.current;
    if (!cur || !Number.isFinite(cur.temperature_2m)) return null;
    return {
      temperatureC: Math.round(cur.temperature_2m),
      windKmh: Math.round(cur.wind_speed_10m ?? 0),
      humidityPct: Number.isFinite(cur.relative_humidity_2m) ? cur.relative_humidity_2m : null,
      descriptionAr: WMO_AR[cur.weather_code as number] ?? 'غير متاح',
      fetchedAt: new Date(),
    };
  } catch {
    return null;
  }
}

/* ─── Embassy tasks (demo — isolated from production APIs) ───────────── */

export type EmbassyTaskType =
  | 'CITIZEN_ASSISTANCE' | 'PENDING_REPORT' | 'UNRESOLVED_INCIDENT'
  | 'FIELD_VISIT' | 'DOCUMENTATION' | 'ESCALATION';
export type EmbassyTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'ESCALATED';

export interface EmbassyTask {
  id: string;
  type: EmbassyTaskType;
  titleAr: string;
  status: EmbassyTaskStatus;
  progressPct: number;
  updatedAgoAr: string;
}

export const TASK_TYPE_AR: Record<EmbassyTaskType, string> = {
  CITIZEN_ASSISTANCE: 'مساعدة مواطن',
  PENDING_REPORT: 'تقرير معلّق',
  UNRESOLVED_INCIDENT: 'حادثة غير مغلقة',
  FIELD_VISIT: 'زيارة ميدانية',
  DOCUMENTATION: 'طلب وثائق',
  ESCALATION: 'طلب تصعيد',
};

export const TASK_STATUS_AR: Record<EmbassyTaskStatus, string> = {
  OPEN: 'مفتوحة',
  IN_PROGRESS: 'قيد المعالجة',
  ESCALATED: 'مصعّدة',
};

/** DEMO DATA — replace with the embassy case-management API when available.
 *  Kept as one constant so no other module can mistake it for live data. */
export const DEMO_EMBASSY_TASKS: EmbassyTask[] = [
  { id: 't1', type: 'CITIZEN_ASSISTANCE', titleAr: 'متابعة حالة مواطن فقد جواز سفره', status: 'IN_PROGRESS', progressPct: 60, updatedAgoAr: 'منذ ساعتين' },
  { id: 't2', type: 'PENDING_REPORT', titleAr: 'تقرير ميداني عن أوضاع المنطقة الساحلية', status: 'OPEN', progressPct: 20, updatedAgoAr: 'منذ 5 ساعات' },
  { id: 't3', type: 'FIELD_VISIT', titleAr: 'زيارة تفقدية لتجمع الطلبة السعوديين', status: 'OPEN', progressPct: 0, updatedAgoAr: 'منذ يوم' },
  { id: 't4', type: 'ESCALATION', titleAr: 'تصعيد حالة طبية حرجة إلى مركز القيادة', status: 'ESCALATED', progressPct: 85, updatedAgoAr: 'منذ 40 دقيقة' },
];
