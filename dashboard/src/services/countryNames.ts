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
