// Pure Arabic flight-status summariser for the AI assistant's system prompt.
// Dependency-free (type-only Flight import) so it can be unit-checked in
// isolation; the shared React hook lives in flightStatus.ts and re-exports this.
//
// Grounded only: OpenSky provides live aircraft POSITIONS, not official
// delay / airspace-closure data — so the summary reports counts and never
// fabricates delays.

import type { Flight } from './opensky';

export interface FlightSummaryOpts {
  /** Restrict to a country by its live-feed English name (Flight.originCountry). */
  countryEn?: string;
  /** Arabic country name — used only for the summary's wording. */
  countryAr?: string;
  /** Geographic box: flights physically inside it count as in-scope airspace. */
  bounds?: { latMin: number; latMax: number; lngMin: number; lngMax: number };
}

function inBounds(lat: number, lng: number, b: NonNullable<FlightSummaryOpts['bounds']>): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

function topOrigins(flights: Flight[], n: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of flights) {
    const name = (f.originCountry ?? '').trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/**
 * Compact Arabic flight-status summary, built from the SAME live data the map
 * layer draws. For an embassy session, pass the host country (name + bounds) to
 * scope it to that country's airspace. Returns '' when nothing is loaded yet.
 */
export function buildFlightStatusSummary(flights: Flight[], opts: FlightSummaryOpts = {}): string {
  if (!flights || flights.length === 0) return '';

  const scopeLabel = opts.countryAr ? ` ضمن نطاق ${opts.countryAr}` : '';
  let list = flights;
  if (opts.countryEn || opts.bounds) {
    const cEn = opts.countryEn?.toLowerCase();
    list = flights.filter((f) =>
      (cEn ? (f.originCountry ?? '').toLowerCase() === cEn : false) ||
      (opts.bounds ? inBounds(f.latitude, f.longitude, opts.bounds) : false)
    );
  }

  const header = `حالة حركة الطيران${scopeLabel} (بيانات حيّة من شبكة OpenSky، تُحدَّث كل 15 ثانية):`;
  if (list.length === 0) {
    return `${header}\nلا توجد رحلات نشطة مرصودة حاليًا${scopeLabel}.`;
  }

  const airborne = list.filter((f) => f.baroAltitude != null && f.baroAltitude > 0).length;
  const origins = topOrigins(list, 5);
  return [
    header,
    `عدد الرحلات المرصودة حاليًا: ${list.length}${airborne ? `، منها ${airborne} في الجو` : ''}.`,
    origins.length ? `أبرز دول منشأ الرحلات: ${origins.map(([name, c]) => `${name} (${c})`).join('، ')}.` : '',
    'ملاحظة: هذا المصدر يرصد مواقع الطائرات اللحظية فقط، ولا يتضمن بيانات رسمية عن التأخيرات أو إغلاق المجال الجوي — لا تُقدّر أرقامًا غير مذكورة.',
  ].filter(Boolean).join('\n');
}
