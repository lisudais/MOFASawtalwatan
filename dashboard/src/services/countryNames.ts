// English country name → Arabic name + ISO 3166-1 alpha-2 code.
//
// The real disaster APIs report locations in English and in varied shapes:
//   • USGS  → "25 km NNE of Santa Rosa, Peru"  (country is the last segment)
//   • EMSC  → a flynn-region string that contains the country name
//   • EONET → no country at all (only the title, often a US state)
//   • GDACS → a plain country name
// lookupCountry() resolves any of these to { ar, iso2 } so the UI shows an
// Arabic name and a real flag instead of raw English / a blank flag.

export interface CountryInfo { ar: string; iso2: string }

const MAP: Record<string, CountryInfo> = {
  'saudi arabia': { ar: 'السعودية', iso2: 'SA' }, 'united arab emirates': { ar: 'الإمارات', iso2: 'AE' },
  qatar: { ar: 'قطر', iso2: 'QA' }, kuwait: { ar: 'الكويت', iso2: 'KW' },
  bahrain: { ar: 'البحرين', iso2: 'BH' }, oman: { ar: 'عُمان', iso2: 'OM' },
  yemen: { ar: 'اليمن', iso2: 'YE' }, iraq: { ar: 'العراق', iso2: 'IQ' },
  jordan: { ar: 'الأردن', iso2: 'JO' }, lebanon: { ar: 'لبنان', iso2: 'LB' },
  syria: { ar: 'سوريا', iso2: 'SY' }, palestine: { ar: 'فلسطين', iso2: 'PS' },
  egypt: { ar: 'مصر', iso2: 'EG' }, sudan: { ar: 'السودان', iso2: 'SD' },
  'south sudan': { ar: 'جنوب السودان', iso2: 'SS' }, libya: { ar: 'ليبيا', iso2: 'LY' },
  tunisia: { ar: 'تونس', iso2: 'TN' }, algeria: { ar: 'الجزائر', iso2: 'DZ' },
  morocco: { ar: 'المغرب', iso2: 'MA' }, mauritania: { ar: 'موريتانيا', iso2: 'MR' },
  somalia: { ar: 'الصومال', iso2: 'SO' }, djibouti: { ar: 'جيبوتي', iso2: 'DJ' },
  iran: { ar: 'إيران', iso2: 'IR' }, turkey: { ar: 'تركيا', iso2: 'TR' },
  'türkiye': { ar: 'تركيا', iso2: 'TR' }, israel: { ar: 'إسرائيل', iso2: 'IL' },
  afghanistan: { ar: 'أفغانستان', iso2: 'AF' }, pakistan: { ar: 'باكستان', iso2: 'PK' },
  india: { ar: 'الهند', iso2: 'IN' }, bangladesh: { ar: 'بنغلاديش', iso2: 'BD' },
  nepal: { ar: 'نيبال', iso2: 'NP' }, 'sri lanka': { ar: 'سريلانكا', iso2: 'LK' },
  china: { ar: 'الصين', iso2: 'CN' }, taiwan: { ar: 'تايوان', iso2: 'TW' },
  georgia: { ar: 'جورجيا', iso2: 'GE' }, armenia: { ar: 'أرمينيا', iso2: 'AM' },
  azerbaijan: { ar: 'أذربيجان', iso2: 'AZ' }, kazakhstan: { ar: 'كازاخستان', iso2: 'KZ' },
  uzbekistan: { ar: 'أوزبكستان', iso2: 'UZ' }, 'kyrgyzstan': { ar: 'قيرغيزستان', iso2: 'KG' },
  tajikistan: { ar: 'طاجيكستان', iso2: 'TJ' }, turkmenistan: { ar: 'تركمانستان', iso2: 'TM' },
  japan: { ar: 'اليابان', iso2: 'JP' }, 'south korea': { ar: 'كوريا الجنوبية', iso2: 'KR' },
  'north korea': { ar: 'كوريا الشمالية', iso2: 'KP' }, mongolia: { ar: 'منغوليا', iso2: 'MN' },
  indonesia: { ar: 'إندونيسيا', iso2: 'ID' }, malaysia: { ar: 'ماليزيا', iso2: 'MY' },
  philippines: { ar: 'الفلبين', iso2: 'PH' }, vietnam: { ar: 'فيتنام', iso2: 'VN' },
  thailand: { ar: 'تايلاند', iso2: 'TH' }, myanmar: { ar: 'ميانمار', iso2: 'MM' },
  burma: { ar: 'ميانمار', iso2: 'MM' }, cambodia: { ar: 'كمبوديا', iso2: 'KH' },
  'papua new guinea': { ar: 'بابوا غينيا الجديدة', iso2: 'PG' }, papua: { ar: 'بابوا غينيا الجديدة', iso2: 'PG' },
  fiji: { ar: 'فيجي', iso2: 'FJ' }, tonga: { ar: 'تونغا', iso2: 'TO' },
  vanuatu: { ar: 'فانواتو', iso2: 'VU' }, 'solomon islands': { ar: 'جزر سليمان', iso2: 'SB' },
  'new zealand': { ar: 'نيوزيلندا', iso2: 'NZ' }, australia: { ar: 'أستراليا', iso2: 'AU' },
  russia: { ar: 'روسيا', iso2: 'RU' }, ukraine: { ar: 'أوكرانيا', iso2: 'UA' },
  'united kingdom': { ar: 'المملكة المتحدة', iso2: 'GB' }, france: { ar: 'فرنسا', iso2: 'FR' },
  germany: { ar: 'ألمانيا', iso2: 'DE' }, italy: { ar: 'إيطاليا', iso2: 'IT' },
  spain: { ar: 'إسبانيا', iso2: 'ES' }, portugal: { ar: 'البرتغال', iso2: 'PT' },
  greece: { ar: 'اليونان', iso2: 'GR' }, iceland: { ar: 'آيسلندا', iso2: 'IS' },
  norway: { ar: 'النرويج', iso2: 'NO' }, 'svalbard and jan mayen': { ar: 'سفالبارد ويان ماين', iso2: 'SJ' },
  poland: { ar: 'بولندا', iso2: 'PL' }, netherlands: { ar: 'هولندا', iso2: 'NL' },
  belgium: { ar: 'بلجيكا', iso2: 'BE' }, switzerland: { ar: 'سويسرا', iso2: 'CH' },
  austria: { ar: 'النمسا', iso2: 'AT' }, sweden: { ar: 'السويد', iso2: 'SE' },
  finland: { ar: 'فنلندا', iso2: 'FI' }, denmark: { ar: 'الدنمارك', iso2: 'DK' },
  ireland: { ar: 'أيرلندا', iso2: 'IE' }, romania: { ar: 'رومانيا', iso2: 'RO' },
  hungary: { ar: 'المجر', iso2: 'HU' }, serbia: { ar: 'صربيا', iso2: 'RS' },
  'czech republic': { ar: 'التشيك', iso2: 'CZ' }, czechia: { ar: 'التشيك', iso2: 'CZ' },
  bulgaria: { ar: 'بلغاريا', iso2: 'BG' }, croatia: { ar: 'كرواتيا', iso2: 'HR' },
  'united states': { ar: 'الولايات المتحدة', iso2: 'US' }, usa: { ar: 'الولايات المتحدة', iso2: 'US' },
  canada: { ar: 'كندا', iso2: 'CA' }, mexico: { ar: 'المكسيك', iso2: 'MX' },
  guatemala: { ar: 'غواتيمالا', iso2: 'GT' }, honduras: { ar: 'هندوراس', iso2: 'HN' },
  'el salvador': { ar: 'السلفادور', iso2: 'SV' }, nicaragua: { ar: 'نيكاراغوا', iso2: 'NI' },
  'costa rica': { ar: 'كوستاريكا', iso2: 'CR' }, panama: { ar: 'بنما', iso2: 'PA' },
  haiti: { ar: 'هايتي', iso2: 'HT' }, cuba: { ar: 'كوبا', iso2: 'CU' },
  'dominican republic': { ar: 'الدومينيكان', iso2: 'DO' }, colombia: { ar: 'كولومبيا', iso2: 'CO' },
  venezuela: { ar: 'فنزويلا', iso2: 'VE' }, ecuador: { ar: 'الإكوادور', iso2: 'EC' },
  peru: { ar: 'بيرو', iso2: 'PE' }, bolivia: { ar: 'بوليفيا', iso2: 'BO' },
  chile: { ar: 'تشيلي', iso2: 'CL' }, argentina: { ar: 'الأرجنتين', iso2: 'AR' },
  brazil: { ar: 'البرازيل', iso2: 'BR' }, paraguay: { ar: 'باراغواي', iso2: 'PY' },
  nigeria: { ar: 'نيجيريا', iso2: 'NG' }, ethiopia: { ar: 'إثيوبيا', iso2: 'ET' },
  kenya: { ar: 'كينيا', iso2: 'KE' }, tanzania: { ar: 'تنزانيا', iso2: 'TZ' },
  'south africa': { ar: 'جنوب أفريقيا', iso2: 'ZA' }, mozambique: { ar: 'موزمبيق', iso2: 'MZ' },
  madagascar: { ar: 'مدغشقر', iso2: 'MG' }, mali: { ar: 'مالي', iso2: 'ML' },
  niger: { ar: 'النيجر', iso2: 'NE' }, chad: { ar: 'تشاد', iso2: 'TD' },
  'democratic republic of the congo': { ar: 'الكونغو الديمقراطية', iso2: 'CD' },
  'central african republic': { ar: 'أفريقيا الوسطى', iso2: 'CF' },
  'burkina faso': { ar: 'بوركينا فاسو', iso2: 'BF' }, cameroon: { ar: 'الكاميرون', iso2: 'CM' },
};

// US state / territory names that appear in EONET titles → United States.
const US_STATES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'south carolina', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'hawaii', 'puerto rico',
]);
const US_INFO: CountryInfo = { ar: 'الولايات المتحدة', iso2: 'US' };

function hasWord(haystack: string, needle: string): boolean {
  return new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(haystack);
}

// Detect a country named ANYWHERE in a free-text message (Arabic or English) —
// used by the assistant to recognise "ماذا عن الأرجنتين؟" and pull that country's
// live data, even when it isn't on screen. Arabic names are matched with/without
// the leading "ال"; English via whole-word. Returns the first (longest-name)
// match so "جنوب السودان" wins over "السودان". null when no country is named.
const AR_INDEX: { ar: string; bare: string; info: CountryInfo }[] = (() => {
  const seen = new Set<string>();
  const out: { ar: string; bare: string; info: CountryInfo }[] = [];
  for (const key in MAP) {
    const info = MAP[key];
    if (seen.has(info.ar)) continue;
    seen.add(info.ar);
    out.push({ ar: info.ar, bare: info.ar.replace(/^ال/, ''), info });
  }
  // Longest Arabic name first so multi-word names match before their substrings.
  return out.sort((a, b) => b.ar.length - a.ar.length);
})();

export function detectCountryInText(text?: string): CountryInfo | null {
  if (!text) return null;
  // Arabic: substring match on the full name or the article-stripped form.
  for (const { ar, bare, info } of AR_INDEX) {
    if (text.includes(ar) || (bare.length >= 3 && text.includes(bare))) return info;
  }
  // English: whole-word match against the map keys (longest key first).
  const s = text.toLowerCase();
  const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);
  for (const st of US_STATES) if (hasWord(s, st)) return US_INFO;
  for (const key of keys) if (hasWord(s, key)) return MAP[key];
  return null;
}

// Resolve a raw source location string to { ar, iso2 }, or null if unknown.
export function lookupCountry(raw?: string): CountryInfo | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();

  if (MAP[s]) return MAP[s];

  const seg = s.split(',').pop()?.trim();
  if (seg && MAP[seg]) return MAP[seg];

  // US states first (avoids e.g. "Indiana" matching "India").
  for (const st of US_STATES) if (hasWord(s, st)) return US_INFO;

  for (const key in MAP) if (hasWord(s, key)) return MAP[key];

  return null;
}

// ── Sub-national region (state / province) extraction ──────────────────────
// Disaster sources report a country, but their raw title/description usually
// also names the state or province (EONET wildfires → "…, California"; USGS
// quakes already carry a locality in `city`). We surface that extra level so
// two events in the same country are told apart ("الولايات المتحدة - كاليفورنيا"
// vs "…- أوريغون") instead of every row reading just "الولايات المتحدة".
//
// Canadian provinces + Australian states are included alongside the US states
// because those are the other high-volume wildfire countries. Detection is by
// whole-word match; translation is best-effort — a region we recognise but have
// no Arabic for is shown in English rather than dropped (never "غير محدد").
const OTHER_REGIONS: readonly string[] = [
  // Canadian provinces & territories
  'british columbia', 'alberta', 'saskatchewan', 'manitoba', 'ontario', 'quebec',
  'nova scotia', 'new brunswick', 'newfoundland and labrador', 'prince edward island',
  'yukon', 'nunavut', 'northwest territories',
  // Australian states & territories
  'new south wales', 'victoria', 'queensland', 'south australia', 'western australia',
  'tasmania', 'northern territory', 'australian capital territory',
];

// Longest first so multi-word regions ("new south wales") win over any substring.
const REGION_KEYS: readonly string[] = [...US_STATES, ...OTHER_REGIONS].sort(
  (a, b) => b.length - a.length,
);

// Arabic display names. Any REGION_KEYS entry missing here falls back to the
// title-cased English name (see lookupRegion) — intentionally, not an omission.
const REGION_AR: Record<string, string> = {
  alabama: 'ألاباما', alaska: 'ألاسكا', arizona: 'أريزونا', arkansas: 'أركنساس',
  california: 'كاليفورنيا', colorado: 'كولورادو', connecticut: 'كونيتيكت', delaware: 'ديلاوير',
  florida: 'فلوريدا', idaho: 'أيداهو', illinois: 'إلينوي', indiana: 'إنديانا', iowa: 'آيوا',
  kansas: 'كانساس', kentucky: 'كنتاكي', louisiana: 'لويزيانا', maine: 'مين', maryland: 'ماريلاند',
  massachusetts: 'ماساتشوستس', michigan: 'ميشيغان', minnesota: 'مينيسوتا', mississippi: 'ميسيسيبي',
  missouri: 'ميزوري', montana: 'مونتانا', nebraska: 'نبراسكا', nevada: 'نيفادا',
  'new hampshire': 'نيوهامبشير', 'new jersey': 'نيوجيرسي', 'new mexico': 'نيومكسيكو',
  'new york': 'نيويورك', 'north carolina': 'نورث كارولينا', 'north dakota': 'نورث داكوتا',
  ohio: 'أوهايو', oklahoma: 'أوكلاهوما', oregon: 'أوريغون', pennsylvania: 'بنسلفانيا',
  'south carolina': 'ساوث كارولينا', tennessee: 'تينيسي', texas: 'تكساس', utah: 'يوتا',
  vermont: 'فيرمونت', virginia: 'فرجينيا', washington: 'واشنطن', 'west virginia': 'ويست فرجينيا',
  wisconsin: 'ويسكونسن', wyoming: 'وايومنغ', hawaii: 'هاواي', 'puerto rico': 'بورتوريكو',
  'british columbia': 'كولومبيا البريطانية', alberta: 'ألبرتا', saskatchewan: 'ساسكاتشوان',
  manitoba: 'مانيتوبا', ontario: 'أونتاريو', quebec: 'كيبيك', 'nova scotia': 'نوفا سكوشا',
  'new brunswick': 'نيو برونزويك', 'newfoundland and labrador': 'نيوفاوندلاند ولابرادور',
  'new south wales': 'نيو ساوث ويلز', victoria: 'فيكتوريا', queensland: 'كوينزلاند',
  'south australia': 'جنوب أستراليا', 'western australia': 'غرب أستراليا', tasmania: 'تسمانيا',
  'northern territory': 'الإقليم الشمالي',
};

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Pull a state/province display name out of a raw source string (title and/or
 * description), or null if none is recognised. Arabic when we have it, English
 * otherwise — never a placeholder.
 */
export function lookupRegion(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const key of REGION_KEYS) {
    if (hasWord(s, key)) return REGION_AR[key] ?? titleCase(key);
  }
  return null;
}
