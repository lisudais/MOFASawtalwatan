// Display-only Arabic country names for the Global Alert Feed.
//
// WHY THIS IS SEPARATE FROM watchlist.ts
// `WATCHLIST` is not a display table — it IS Stage 2's constrained classifier
// enum. Adding a country to it changes what the model is allowed to emit and
// what Stage 4 can group on. So countries that appear on cards but are NOT
// classification targets live here instead.
//
// They arrive from `usgs.ts`'s `guessCountryCode`, which can emit 16 ISO2 codes
// outside the watchlist (JP CL NZ GR IT NP PE EC PG CN US TW FJ TO SB VU).
// Those signals are real earthquakes and belong on the feed; they simply can
// never be classification targets or corroboration groups.
//
// Anything unknown falls back to the raw ISO2 rather than a guess.

import { COUNTRY_BY_ISO2 } from './watchlist';

/** Countries reachable via USGS's place-name heuristic but outside the watchlist. */
const EXTRA_COUNTRY_AR: Record<string, string> = {
  JP: 'اليابان',
  CL: 'تشيلي',
  NZ: 'نيوزيلندا',
  GR: 'اليونان',
  IT: 'إيطاليا',
  NP: 'نيبال',
  PE: 'بيرو',
  EC: 'الإكوادور',
  PG: 'بابوا غينيا الجديدة',
  CN: 'الصين',
  US: 'الولايات المتحدة',
  TW: 'تايوان',
  FJ: 'فيجي',
  TO: 'تونغا',
  SB: 'جزر سليمان',
  VU: 'فانواتو',
};

/**
 * Arabic display name for a card. Watchlist countries win (they carry the
 * canonical translation used everywhere else); then the extras above; then the
 * bare code, which is honest about what we know rather than inventing a name.
 */
export function countryNameAr(iso2: string | null): string {
  if (!iso2) return 'موقع غير محدد';
  return COUNTRY_BY_ISO2[iso2]?.ar ?? EXTRA_COUNTRY_AR[iso2] ?? iso2;
}

/** Every ISO2 we can render a name for. Used by the coverage check in tests/probes. */
export function knownCountryCodes(): string[] {
  return [...Object.keys(COUNTRY_BY_ISO2), ...Object.keys(EXTRA_COUNTRY_AR)];
}
