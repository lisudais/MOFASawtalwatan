// Global Alert Feed — the constrained country enum for Stage 2 classification.
//
// Mirrors the WATCHLIST in netlify/lib/securityCore.mjs (45 entries). It is
// duplicated rather than imported because that module is backend-only and is
// out of scope to modify; if the backend list changes, regenerate this file.
//
// The model may ONLY emit one of these ISO2 codes or null. It never free-
// generates a country name — an unmatched article is logged as "unmatched" and
// its country stays null, per the Stage 2 contract.

export interface WatchCountry {
  iso2: string;
  en: string;
  ar: string;
}

export const WATCHLIST: WatchCountry[] = [
  { iso2: 'YE', en: 'Yemen', ar: 'اليمن' },
  { iso2: 'SY', en: 'Syria', ar: 'سوريا' },
  { iso2: 'IQ', en: 'Iraq', ar: 'العراق' },
  { iso2: 'IR', en: 'Iran', ar: 'إيران' },
  { iso2: 'LB', en: 'Lebanon', ar: 'لبنان' },
  { iso2: 'JO', en: 'Jordan', ar: 'الأردن' },
  { iso2: 'KW', en: 'Kuwait', ar: 'الكويت' },
  { iso2: 'OM', en: 'Oman', ar: 'عُمان' },
  { iso2: 'QA', en: 'Qatar', ar: 'قطر' },
  { iso2: 'BH', en: 'Bahrain', ar: 'البحرين' },
  { iso2: 'AE', en: 'United Arab Emirates', ar: 'الإمارات' },
  { iso2: 'EG', en: 'Egypt', ar: 'مصر' },
  { iso2: 'SD', en: 'Sudan', ar: 'السودان' },
  { iso2: 'SS', en: 'South Sudan', ar: 'جنوب السودان' },
  { iso2: 'LY', en: 'Libya', ar: 'ليبيا' },
  { iso2: 'TN', en: 'Tunisia', ar: 'تونس' },
  { iso2: 'DZ', en: 'Algeria', ar: 'الجزائر' },
  { iso2: 'MA', en: 'Morocco', ar: 'المغرب' },
  { iso2: 'MR', en: 'Mauritania', ar: 'موريتانيا' },
  { iso2: 'SO', en: 'Somalia', ar: 'الصومال' },
  { iso2: 'DJ', en: 'Djibouti', ar: 'جيبوتي' },
  { iso2: 'TR', en: 'Turkey', ar: 'تركيا' },
  { iso2: 'IL', en: 'Israel', ar: 'إسرائيل' },
  { iso2: 'AF', en: 'Afghanistan', ar: 'أفغانستان' },
  { iso2: 'PK', en: 'Pakistan', ar: 'باكستان' },
  { iso2: 'IN', en: 'India', ar: 'الهند' },
  { iso2: 'BD', en: 'Bangladesh', ar: 'بنغلاديش' },
  { iso2: 'NG', en: 'Nigeria', ar: 'نيجيريا' },
  { iso2: 'ML', en: 'Mali', ar: 'مالي' },
  { iso2: 'NE', en: 'Niger', ar: 'النيجر' },
  { iso2: 'BF', en: 'Burkina Faso', ar: 'بوركينا فاسو' },
  { iso2: 'TD', en: 'Chad', ar: 'تشاد' },
  { iso2: 'ET', en: 'Ethiopia', ar: 'إثيوبيا' },
  { iso2: 'CD', en: 'Democratic Republic of the Congo', ar: 'الكونغو الديمقراطية' },
  { iso2: 'CF', en: 'Central African Republic', ar: 'أفريقيا الوسطى' },
  { iso2: 'UA', en: 'Ukraine', ar: 'أوكرانيا' },
  { iso2: 'RU', en: 'Russia', ar: 'روسيا' },
  { iso2: 'VE', en: 'Venezuela', ar: 'فنزويلا' },
  { iso2: 'HT', en: 'Haiti', ar: 'هايتي' },
  { iso2: 'MM', en: 'Burma', ar: 'ميانمار' },
  { iso2: 'KP', en: 'North Korea', ar: 'كوريا الشمالية' },
  { iso2: 'CO', en: 'Colombia', ar: 'كولومبيا' },
  { iso2: 'MX', en: 'Mexico', ar: 'المكسيك' },
  { iso2: 'PH', en: 'Philippines', ar: 'الفلبين' },
  { iso2: 'ID', en: 'Indonesia', ar: 'إندونيسيا' },
];

/** Allowed values for the classifier's `country` field. Null is also permitted. */
export const COUNTRY_ENUM: string[] = WATCHLIST.map((c) => c.iso2);

export const COUNTRY_BY_ISO2: Record<string, WatchCountry> = Object.fromEntries(
  WATCHLIST.map((c) => [c.iso2, c])
);

/** Compact `IQ=Iraq` list for the prompt, so the model can map names to codes. */
export const COUNTRY_HINT = WATCHLIST.map((c) => `${c.iso2}=${c.en}`).join(", ");

/* ── Resolving a watchlist country from a place-name string ──────────────────
   Used for EMSC, whose `flynn_region` is a Flinn-Engdahl seismic region name
   ("WESTERN IRAN", "SULAWESI, INDONESIA", "PHILIPPINE ISLANDS REGION"). No
   geocoding, no coordinates, no new dependency — the country was already in the
   payload, we were simply discarding it.

   Same null-if-unsure principle as Stage 2: a string that does not clearly name
   a watchlist country resolves to null. "MOLUCCA SEA", "TONGA" and "BALLENY
   ISLANDS REGION" are correct nulls, not failures. */

/** Names Flinn-Engdahl uses that differ from the watchlist's English name. */
const ALIASES: Record<string, string> = {
  'PHILIPPINE ISLANDS': 'PH',
  MYANMAR: 'MM',          // the watchlist calls it 'Burma'
  TURKIYE: 'TR',
  'DEMOCRATIC REPUBLIC OF THE CONGO': 'CD',
  DRC: 'CD',
  UAE: 'AE',
};

/**
 * Word-boundary matching, longest name first. Both properties are load-bearing:
 *   • boundaries stop "INDIAN OCEAN" matching India, and "ROMANIA" matching Oman.
 *   • longest-first stops "SOUTH SUDAN" being read as Sudan.
 *   • "NIGER" cannot match "NIGERIA": the boundary after NIGER fails.
 * Bare "CONGO" is deliberately NOT an alias — it is ambiguous between the DRC
 * and the Republic of the Congo, so it resolves to null rather than guessing.
 */
const NAME_TO_ISO2: [string, string][] = [
  ...WATCHLIST.map((c) => [c.en.toUpperCase(), c.iso2] as [string, string]),
  ...Object.entries(ALIASES),
].sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns an ISO2 watchlist code, or null when the string names no watchlist country. */
export function resolveWatchCountry(placeName: string | null | undefined): string | null {
  if (!placeName) return null;
  const text = placeName.toUpperCase();

  for (const [name, iso2] of NAME_TO_ISO2) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text)) return iso2;
  }
  return null;
}
