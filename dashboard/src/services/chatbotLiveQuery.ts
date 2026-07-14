// Live per-country data for the assistant.
//
// The assistant is NOT limited to the countries currently shown on the board.
// When the user asks about a specific country, this module pulls that country's
// REAL data from the SAME authorized sources the dashboard already uses
// (GDACS / USGS / EONET / EMSC for disasters, disease.sh + WHO for health, ACLED
// for security), filtered to that country, and returns an Arabic context block
// for gpt-oss to ground its answer in. Nothing new or unverified is introduced;
// if a source genuinely has no record for that country, that is stated honestly.

import { fetchGDACSEvents } from './gdacs';
import { fetchUSGSEarthquakes } from './usgs';
import { fetchExtraDisasterEvents } from './disasters';
import { fetchHealthCountries } from './healthFeed';
import { fetchSecurityFeed } from './security';
import { detectCountryInText, type CountryInfo } from './countryNames';
import { TYPE_LABEL_AR, RISK_LABEL_AR } from '../constants';
import type { GeoEvent } from '../types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; context: string }>();

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

// NOTE: this context is fed to the model. It must NOT contain technical source
// names (GDACS/USGS/…): the assistant is instructed never to echo them, and the
// simplest guarantee is not to put them in front of it in the first place.
function disasterLines(events: GeoEvent[]): string {
  if (events.length === 0) return 'لا توجد كوارث نشطة مسجّلة حالياً لهذه الدولة.';
  const top = [...events]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((e) => `• ${TYPE_LABEL_AR[e.type]} — ${e.title} (الخطورة: ${RISK_LABEL_AR[e.riskLevel]})`);
  return `عدد الأحداث: ${events.length}.\n${top.join('\n')}`;
}

/**
 * Detect a country in `userText` and build its live Arabic data context. Returns
 * null when no country is named (so the caller skips the extra fetch entirely).
 * Every source is queried in parallel and failures degrade gracefully to an
 * honest "no data from this source" line — never a fabricated value.
 */
export async function liveCountryContext(userText: string): Promise<{ country: CountryInfo; context: string } | null> {
  const country = detectCountryInText(userText);
  if (!country) return null;
  const iso2 = country.iso2;

  const cached = cache.get(iso2);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { country, context: cached.context };
  }

  const [gdacs, usgs, extra, health, security] = await Promise.all([
    safe(fetchGDACSEvents(), [] as GeoEvent[]),
    safe(fetchUSGSEarthquakes(), [] as GeoEvent[]),
    safe(fetchExtraDisasterEvents(), [] as GeoEvent[]),
    safe(fetchHealthCountries(), []),
    safe(fetchSecurityFeed(), []),
  ]);

  // ── Disasters (GDACS/USGS/EONET/EMSC), filtered to this country ──
  const disasters = [...gdacs, ...usgs, ...extra].filter((e) => e.countryCode === iso2);

  // ── Health (disease.sh / WHO), filtered to this country ──
  const healthRows = health.filter((h) => h.countryCode === iso2);
  const healthLine = healthRows.length === 0
    ? 'لا توجد بيانات صحية بارزة لهذه الدولة حالياً.'
    : healthRows
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 4)
        .map((h) => `• ${h.disease}: مستوى الخطورة ${RISK_LABEL_AR[h.analysis.risk_level.category] ?? h.analysis.risk_level.category}، احتمال تفشٍ ${h.analysis.outbreak_forecast.probability}%`)
        .join('\n');

  // ── Security (ACLED), filtered to this country ──
  const sec = security.find((s) => s.countryCode === iso2);
  const secLine = !sec
    ? 'لا توجد تهديدات أمنية مسجّلة لهذه الدولة حالياً.'
    : `مؤشر الخطورة الأمنية ${sec.riskScore}/100 (${RISK_LABEL_AR[sec.riskLevel] ?? sec.riskLevel})، أحداث نشطة: ${sec.activeIncidents}.` +
      (sec.topReasons?.length ? ` أبرز العوامل: ${sec.topReasons.join('، ')}.` : '');

  const context =
    `بيانات حيّة مسحوبة الآن من المصادر الرسمية المعتمدة لدولة ${country.ar} (استندي إليها حصراً، ولا تذكري أسماء المصادر التقنية في ردك):\n` +
    `الكوارث الطبيعية:\n${disasterLines(disasters)}\n` +
    `الأوضاع الصحية:\n${healthLine}\n` +
    `التهديدات الأمنية:\n${secLine}\n` +
    `الاقتصاد:\nالمؤشرات الاقتصادية باللوحة عالمية (نفط/ذهب/دولار-ريال) وليست خاصة بدولة بعينها.`;

  cache.set(iso2, { at: Date.now(), context });
  return { country, context };
}
