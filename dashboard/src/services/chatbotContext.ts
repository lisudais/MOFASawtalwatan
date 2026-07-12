// Builds the Arabic situation summary handed to the AI assistant in GLOBAL
// (no-embassy) mode — the analogue of the embassy scope's contextSummaryAr, but
// covering the whole board instead of one country.
//
// Everything here is derived from data ALREADY fetched and displayed by the
// dashboard: the Stages 1-6 feed cards (EONET, USGS, EMSC, GDACS, ACLED,
// ReliefWeb, disease.sh, economic sources — aggregated server-side), plus the
// disaster / security / health lists. No new fetch, no mock — a read-only
// projection of live state, so the summary changes whenever the data does.

import type { FeedCard } from './feed/feedCards';
import type { EventType } from './feed/types';
import { countryNameAr } from './feed/countryNames';
import type { GeoEvent } from '../types';
import type { CountrySecurityProfile } from './security';
import type { CountryHealthEntry } from './healthAnalysis';
import { TYPE_LABEL_AR } from '../constants';

export interface GlobalContextInput {
  feedCards: FeedCard[];
  events: GeoEvent[];
  securityCountries: CountrySecurityProfile[];
  healthCountries: CountryHealthEntry[];
}

const EVENT_TYPE_AR: Record<EventType, string> = {
  security: 'أمني',
  natural_disaster: 'كوارث طبيعية',
  health: 'صحي',
  economic: 'اقتصادي',
  political_unrest: 'اضطراب سياسي',
};

/**
 * Compact, grounded Arabic summary of the current global board. Returns '' when
 * there is genuinely nothing loaded yet (e.g. first paint) — the caller then
 * falls back to the no-data prompt.
 */
export function buildGlobalContextSummary(input: GlobalContextInput): string {
  const { feedCards, events, securityCountries, healthCountries } = input;
  const sections: string[] = [];

  // 1) Active alerts: total + per-category breakdown (from the pipeline cards).
  if (feedCards.length > 0) {
    const counts: Record<EventType, number> = {
      security: 0, natural_disaster: 0, health: 0, economic: 0, political_unrest: 0,
    };
    for (const c of feedCards) counts[c.eventType] += 1;
    const breakdown = (Object.keys(counts) as EventType[])
      .filter((k) => counts[k] > 0)
      .map((k) => `${EVENT_TYPE_AR[k]}: ${counts[k]}`)
      .join('، ');
    sections.push(`التنبيهات النشطة: ${feedCards.length} تنبيه (${breakdown}).`);

    // 2) Top countries by Stage 5 score, with their summary sentence.
    const ranked = feedCards
      .filter((c) => c.country)
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
    if (ranked.length > 0) {
      const lines = ranked
        .map((c) => `- ${countryNameAr(c.country)} — ${EVENT_TYPE_AR[c.eventType]} (درجة ${c.score}): ${c.summary ?? 'غير متاح'}`)
        .join('\n');
      sections.push(`أبرز الدول حسب درجة الخطورة:\n${lines}`);
    }
  }

  // 3) Active natural disasters (GeoEvent list feeding the map/disaster panel).
  if (events.length > 0) {
    const top = events
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((e) => `${TYPE_LABEL_AR[e.type]} في ${e.country}`)
      .join('؛ ');
    sections.push(`الكوارث الطبيعية النشطة: ${events.length} حدث. أبرزها: ${top}.`);
  }

  // 4) Security threats being tracked (ACLED / State-Dept driven).
  const sec = securityCountries
    .filter((s) => s.riskScore > 0)
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);
  if (sec.length > 0) {
    const list = sec
      .map((s) => `${s.country} (درجة ${s.riskScore}، ${s.activeIncidents} حادثة نشطة)`)
      .join('؛ ');
    sections.push(`التهديدات الأمنية المتابَعة: ${list}.`);
  }

  // 5) Health indicators (WHO / disease.sh driven).
  if (healthCountries.length > 0) {
    const list = healthCountries
      .slice()
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 8)
      .map((h) => `${h.country}: ${h.disease} (درجة ${h.riskScore})`)
      .join('؛ ');
    sections.push(`المؤشرات الصحية: ${list}.`);
  }

  return sections.join('\n\n');
}
