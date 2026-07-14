// Comprehensive per-country Saudi presence (MOCK). Depends only on the pure,
// dependency-free unified distribution source so it can still be imported
// anywhere; countries in that source use its EXACT per-country total.
//
// Estimated Saudi RESIDENTS per country, keyed by ISO2, so NO country detail
// panel ever shows "غير متوفر". Known sizeable communities get realistic
// magnitudes; every OTHER country resolves to a small, STABLE estimate via
// `fallbackResidents`, so the table need not enumerate all 195 by hand yet still
// covers every possible ISO2 code. Illustrative demo figures, NOT official
// statistics. The largest entries mirror SAUDIS_ABROAD_TOP_RAW in mockData.ts.

import { saudiCountForCountry } from './saudiDistribution';

const SAUDI_RESIDENTS: Record<string, number> = {
  // ── Gulf & Arab world (largest communities) ──
  AE: 612340, EG: 458220, BH: 287450, KW: 165000, QA: 148000, JO: 132000,
  OM: 74000, LB: 58000, IQ: 41000, YE: 39000, SD: 47000, SY: 26000, MA: 22000,
  TN: 15500, LY: 12000, DZ: 9800, PS: 9000, MR: 3500, SO: 4800, DJ: 2200, KM: 900,
  // ── North America & Western Europe ──
  US: 341890, GB: 198760, CA: 61000, DE: 42000, FR: 34000, IT: 12500, ES: 9800,
  NL: 8600, CH: 7400, SE: 6100, IE: 5200, BE: 4200, AT: 3100, NO: 2600, DK: 2400,
  PT: 1900, GR: 2100, FI: 1100, PL: 1300, LU: 300, MT: 250, CY: 900,
  // ── Asia ──
  TR: 156330, MY: 96500, ID: 52000, PK: 44000, IN: 31000, TH: 21000, CN: 18500,
  BD: 12000, PH: 9800, SG: 8700, JP: 7600, IR: 7200, KR: 6200, MV: 6100, AF: 3800,
  LK: 3400, GE: 3100, VN: 2400, KZ: 2200, AZ: 1900, UZ: 1400, BN: 1200, MM: 900,
  NP: 900, KH: 800, AM: 700, KG: 350, TM: 400, TJ: 300, MN: 250, LA: 200,
  // ── Africa ──
  NG: 8900, ZA: 7800, KE: 6400, ET: 5200, GH: 3100, TZ: 2600, SN: 2400, UG: 1800,
  CI: 1500, CM: 1400, CD: 1200, ML: 1100, RW: 900, MU: 900, AO: 700, TD: 700,
  ZW: 600, BF: 600, ZM: 400, MG: 400, GA: 300, CG: 350, GN: 800, NE: 900, BJ: 500,
  MZ: 500, TG: 400, NA: 300, BW: 350, ER: 300, SS: 250, LR: 250, SL: 300, GM: 350,
  MW: 300, SC: 200, BI: 200, GW: 120, GQ: 110, CF: 90, CV: 90, LS: 90, SZ: 80, ST: 40,
  // ── Latin America & Caribbean ──
  BR: 6200, MX: 4100, AR: 2400, CO: 1600, CL: 1400, PE: 900, VE: 700, DO: 700,
  PA: 600, EC: 500, CR: 400, GT: 300, TT: 300, JM: 250, UY: 250, BO: 200, CU: 200,
  PY: 150, HN: 150, BS: 150, SV: 120, NI: 90, HT: 90, BB: 90, BZ: 60,
  // ── Oceania ──
  AU: 38000, NZ: 4200, FJ: 300, PG: 150, SB: 40, VU: 30, WS: 25, TO: 20,
  // ── Eastern Europe & rest ──
  RU: 5400, UA: 1900, RO: 800, CZ: 900, HU: 700, BG: 500, RS: 600, BY: 400,
  HR: 400, SK: 350, AL: 300, SI: 250, ME: 120, MK: 200, BA: 250, MD: 150,
  LT: 200, LV: 180, EE: 150, IS: 90, XK: 100,
};

/** Stable 32-bit FNV-1a hash of a country code — drives all per-country ratios
 *  so a country's figures never flicker between renders. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Stable small estimate (8–80) for any ISO2 not in SAUDI_RESIDENTS. Never
 * zero-by-accident — a small figure is always better than the error-looking
 * "غير متوفر".
 */
function fallbackResidents(iso2: string): number {
  return 8 + (hash32(iso2) % 73); // 8..80
}

/**
 * Estimated Saudi residents for ANY country code. Always a positive number.
 * Countries present in the unified distribution source use its EXACT per-country
 * total, so this figure agrees with the map points and consulate counters; any
 * other country falls back to the local table, then a small stable estimate.
 */
export function saudiResidents(countryCode: string): number {
  const code = (countryCode ?? '').toUpperCase();
  const unified = saudiCountForCountry(code);
  if (unified > 0) return unified;
  return SAUDI_RESIDENTS[code] ?? fallbackResidents(code || 'XX');
}

export interface SaudiPresence {
  residents: number;
  visitors: number;
  visaHolders: number;
}

/** Unified severity band (same values as riskClassification.classifyRiskByScore). */
export type PresenceRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Per-band cap for the headline "visa holders" figure. Saudis avoid dangerous
// countries, so the more severe the country's risk, the FEWER present:
//   CRITICAL → tens..~100 · HIGH → hundreds · MEDIUM → thousands ·
//   LOW/none → the full known community (can be tens/hundreds of thousands).
// Deterministic per country (hash) so a country's figure is stable per band.
function visaCapForRisk(band: PresenceRisk | undefined, h: number): number | null {
  switch (band) {
    case 'CRITICAL': return 30 + (h % 71);         // 30..100
    case 'HIGH':     return 150 + (h % 750);       // 150..899
    case 'MEDIUM':   return 1200 + (h % 6800);     // 1200..7999
    default:         return null;                  // LOW / unknown → no cap (full community)
  }
}

/**
 * Mock Saudi presence for ANY country — never "unavailable", and with a REALISTIC
 * relationship between the three figures:
 *
 *   • residents   — the base (largest standing community for big-diaspora states)
 *   • visitors    — a country-specific fraction of residents (tourism- vs
 *                   work-heavy states differ), deterministic per country
 *   • visaHolders — the BROADEST category: everyone who has entered or may enter,
 *                   so it is ALWAYS ≥ residents + visitors (that sum plus a margin)
 *
 * All ratios are derived deterministically from the country code, so the numbers
 * are stable and self-consistent. Illustrative demo data, not official statistics.
 */
export function getSaudiPresence(countryCode: string, riskBand?: PresenceRisk): SaudiPresence {
  const code = (countryCode ?? '').toUpperCase() || 'XX';
  const fullResidents = saudiResidents(code);
  const h = hash32(code);

  // Full-community figures (as before) — used directly for LOW/unknown risk.
  const visitorRatio = 0.35 + (h % 56) / 100;            // 35%–90% of residents
  const fullVisitors = Math.round(fullResidents * visitorRatio);
  const surplus = 0.05 + ((h >>> 8) % 26) / 100;         // 5%–30% margin
  const fullVisa = Math.round((fullResidents + fullVisitors) * (1 + surplus));

  // Risk-aware: cap the headline visa-holders figure for higher-risk countries,
  // then scale residents/visitors by the SAME factor so the three stay coherent
  // (visa holders always the largest). Never scales UP a small community.
  const cap = visaCapForRisk(riskBand, h);
  const visaHolders = cap == null ? fullVisa : Math.min(fullVisa, cap);
  const factor = fullVisa > 0 ? visaHolders / fullVisa : 1;
  const residents = Math.max(1, Math.round(fullResidents * factor));
  const visitors = Math.max(0, Math.round(fullVisitors * factor));

  return { residents, visitors, visaHolders };
}
