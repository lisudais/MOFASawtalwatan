import type { Traveler, SaudisAbroadData } from '../types';
import { SAUDIS_ABROAD_COLORS, SAUDIS_ABROAD_OTHER_COLOR } from '../constants';

export const MOCK_TRAVELERS: Traveler[] = [
  {
    id: 'trav-1',
    nameAr: 'محمد العتيبي',
    nameEn: 'Mohammed Al-Otaibi',
    passportNumber: 'A12345678',
    destination: 'Beirut, Lebanon',
    countryCode: 'LB',
    lat: 33.8938,
    lng: 35.5018,
    arrivalDate: new Date(Date.now() - 2 * 86400000),
    departureDate: new Date(Date.now() + 5 * 86400000),
    phone: '+966501234567',
    status: 'ALERTED',
    alerts: ['mock-1'],
  },
  {
    id: 'trav-2',
    nameAr: 'سارة القحطاني',
    nameEn: 'Sarah Al-Qahtani',
    passportNumber: 'B98765432',
    destination: 'Karachi, Pakistan',
    countryCode: 'PK',
    lat: 24.8607,
    lng: 67.0011,
    arrivalDate: new Date(Date.now() - 1 * 86400000),
    departureDate: new Date(Date.now() + 8 * 86400000),
    phone: '+966559876543',
    status: 'ACTIVE',
    alerts: ['mock-3'],
  },
  {
    id: 'trav-3',
    nameAr: 'فهد الحربي',
    nameEn: 'Fahad Al-Harbi',
    passportNumber: 'C55566677',
    destination: 'Kinshasa, DRC',
    countryCode: 'CD',
    lat: -4.4419,
    lng: 15.2663,
    arrivalDate: new Date(Date.now() - 3 * 86400000),
    departureDate: new Date(Date.now() + 3 * 86400000),
    phone: '+966512345678',
    status: 'SAFE',
    alerts: [],
  },
  {
    id: 'trav-4',
    nameAr: 'نورة الدوسري',
    nameEn: 'Noura Al-Dosari',
    passportNumber: 'D11122233',
    destination: 'Mogadishu, Somalia',
    countryCode: 'SO',
    lat: 2.0469,
    lng: 45.3182,
    arrivalDate: new Date(Date.now() - 6 * 86400000),
    departureDate: new Date(Date.now() + 1 * 86400000),
    phone: '+966598765432',
    status: 'ACTIVE',
    alerts: [],
  },
];

// Illustrative mock figures for the "Saudis Abroad" national overview — not real
// government statistics, just plausible round numbers for the demo dashboard.
const SAUDIS_ABROAD_TOTAL = 2_847_650;
const SAUDIS_ABROAD_TOP_RAW: { country: string; countryCode: string; count: number }[] = [
  { country: 'الإمارات', countryCode: 'AE', count: 612_340 },
  { country: 'مصر', countryCode: 'EG', count: 458_220 },
  { country: 'الولايات المتحدة', countryCode: 'US', count: 341_890 },
  { country: 'البحرين', countryCode: 'BH', count: 287_450 },
  { country: 'المملكة المتحدة', countryCode: 'GB', count: 198_760 },
  { country: 'تركيا', countryCode: 'TR', count: 156_330 },
];

export function getSaudisAbroadData(): SaudisAbroadData {
  const topSum = SAUDIS_ABROAD_TOP_RAW.reduce((s, c) => s + c.count, 0);
  const otherCount = SAUDIS_ABROAD_TOTAL - topSum;

  const countries = SAUDIS_ABROAD_TOP_RAW.map((c, i) => ({
    ...c,
    percentage: Math.round((c.count / SAUDIS_ABROAD_TOTAL) * 1000) / 10,
    color: SAUDIS_ABROAD_COLORS[i % SAUDIS_ABROAD_COLORS.length],
  }));

  return {
    total: SAUDIS_ABROAD_TOTAL,
    countries,
    otherCount,
    otherPercentage: Math.round((otherCount / SAUDIS_ABROAD_TOTAL) * 1000) / 10,
    otherColor: SAUDIS_ABROAD_OTHER_COLOR,
  };
}

// Comprehensive per-country Saudi presence lives in its own dependency-free
// module; re-exported here so existing imports (`from '../services/mockData'`)
// keep working unchanged.
export { saudiResidents, getSaudiPresence, type SaudiPresence } from './saudiPresence';
