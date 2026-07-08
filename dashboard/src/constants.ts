import {
  Activity, CloudRain, Wind, Mountain, Crosshair, AlertOctagon, Flame, Shield, Sun,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import type { RiskLevel, GeoEvent, CategoryInsight } from './types';

export const RISK_COLORS: Record<RiskLevel, string> = {
  CRITICAL: '#FF1744',
  HIGH:     '#FF6D00',
  MEDIUM:   '#FFD600',
  LOW:      '#00E676',
  SAFE:     '#2979FF',
};

export const RISK_LABEL_AR: Record<RiskLevel, string> = {
  CRITICAL: 'خطر بالغ',
  HIGH:     'خطر مرتفع',
  MEDIUM:   'خطر متوسط',
  LOW:      'خطر منخفض',
  SAFE:     'آمن',
};

export const TYPE_ICON: Record<GeoEvent['type'], React.ElementType> = {
  EARTHQUAKE:   Activity,
  FLOOD:        CloudRain,
  STORM:        Wind,
  VOLCANO:      Mountain,
  CONFLICT:     Crosshair,
  TERROR:       AlertOctagon,
  CIVIL_UNREST: Flame,
  DISEASE:      Shield,
  DROUGHT:      Sun,
  WILDFIRE:     Flame,
};

export const DISASTER_TYPES: GeoEvent['type'][] = [
  'EARTHQUAKE', 'FLOOD', 'STORM', 'VOLCANO', 'WILDFIRE', 'DROUGHT',
];

export const TYPE_LABEL_AR: Record<GeoEvent['type'], string> = {
  EARTHQUAKE:   'زلازل',
  FLOOD:        'فيضانات',
  STORM:        'عواصف',
  VOLCANO:      'براكين',
  WILDFIRE:     'حرائق',
  DROUGHT:      'جفاف',
  CONFLICT:     'نزاعات',
  TERROR:       'إرهاب',
  CIVIL_UNREST: 'اضطرابات',
  DISEASE:      'أمراض',
};

export const HEALTH_SOURCE_LINKS = [
  { name: 'WHO', url: 'https://who.int' },
  { name: 'CDC', url: 'https://cdc.gov' },
  { name: 'ECDC', url: 'https://ecdc.europa.eu' },
  { name: 'Africa CDC', url: 'https://africacdc.org' },
  { name: 'ProMED', url: 'https://promedmail.org' },
  { name: 'HealthMap', url: 'https://healthmap.org' },
  { name: 'JHU CSSE', url: 'https://coronavirus.jhu.edu' },
];

export const NEWS_SOURCE_LINKS = [
  { name: 'Reuters', url: 'https://reuters.com' },
  { name: 'AP', url: 'https://apnews.com' },
  { name: 'AFP', url: 'https://afp.com' },
  { name: 'BBC', url: 'https://bbc.com/news' },
  { name: 'The Guardian', url: 'https://theguardian.com' },
  { name: 'NYT', url: 'https://nytimes.com' },
  { name: 'WSJ', url: 'https://wsj.com' },
  { name: 'Al Jazeera', url: 'https://aljazeera.com' },
];

// Sequential single-hue ramp (magnitude bars: health top-countries, disaster counts-by-type).
// Validated with the dataviz skill's validate_palette.js against the dark chart surface
// (lightness band + chroma floor + contrast all PASS; adjacent-step CVD closeness is
// expected/accepted for a sequential ramp, mitigated by the direct value label on each bar).
export const SEQUENTIAL_GOLD = ['#B08A2E', '#9C7A28', '#8F6D1A'];

// Fixed 2-color categorical pair for the economy price-trend chart (Gold vs Oil).
// Validated: lightness band, chroma floor, CVD separation (ΔE ~107) and contrast all PASS.
export const CHART_SERIES_COLORS = {
  gold: '#B08A2E',
  oil: '#3987E5',
};

// Fixed 6-color categorical set for the disaster-type donut/legend (identity, not severity —
// kept distinct from RISK_COLORS so a status color never doubles as a category color).
// Reused directly from the dataviz skill's own validated dark-mode categorical reference
// (references/palette.md), re-run through validate_palette.js for this exact 6-slot subset:
// all PASS except one adjacent-pair CVD warning in the accepted 8-12 floor band, mitigated
// by the always-on direct labels/legend on both the donut and the sparklines.
export const CATEGORY_COLORS: Record<string, string> = {
  EARTHQUAKE: '#3987e5',
  FLOOD:      '#199e70',
  STORM:      '#c98500',
  VOLCANO:    '#008300',
  WILDFIRE:   '#9085e9',
  DROUGHT:    '#e66767',
};

export const TREND_ICON: Record<CategoryInsight['trend'], React.ElementType> = {
  RISING: TrendingUp,
  STABLE: Minus,
  FALLING: TrendingDown,
};

export const TREND_COLOR: Record<CategoryInsight['trend'], string> = {
  RISING: 'var(--danger-high)',
  STABLE: 'var(--text-secondary)',
  FALLING: 'var(--danger-low)',
};

export const TREND_LABEL_AR: Record<CategoryInsight['trend'], string> = {
  RISING: 'متصاعد',
  STABLE: 'مستقر',
  FALLING: 'منخفض',
};

// Muted/desaturated "official government" categorical set for the Saudis Abroad
// section — deliberately low-chroma (unlike CATEGORY_COLORS above), per an explicit
// request to avoid vivid/neon color. Run through validate_palette.js: lightness band
// and CVD separation both PASS; chroma floor intentionally fails (that's what "muted"
// means) and one contrast value sits at 2.9 (just under the 3:1 floor) — both are
// mitigated the way the skill prescribes for this case: every segment always ships
// with a direct text label (country name + count + %), never color alone.
export const SAUDIS_ABROAD_COLORS = ['#1C8049', '#3D6690', '#A88A3E', '#52708A', '#8A7550', '#4A8078'];
export const SAUDIS_ABROAD_OTHER_COLOR = 'var(--text-muted)';

// 4-step segmented bar for the Health box's risk_level indicator — gray→yellow→
// orange→red as requested (note: LOW is gray here, not green like RISK_COLORS,
// since this bar is a distinct "how far along the scale" visual, not the general
// event-severity badge used elsewhere).
export const RISK_LEVEL_BAR_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const RISK_LEVEL_BAR_COLORS: Record<(typeof RISK_LEVEL_BAR_ORDER)[number], string> = {
  LOW: 'var(--text-muted)',
  MEDIUM: 'var(--danger-medium)',
  HIGH: 'var(--danger-high)',
  CRITICAL: 'var(--danger-critical)',
};
