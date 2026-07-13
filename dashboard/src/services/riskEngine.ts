import type { GeoEvent, RiskLevel, RiskAssessment, Traveler } from '../types';
import { classifyRiskByScore } from './riskClassification';

const RISK_WEIGHTS: Record<GeoEvent['type'], number> = {
  TERROR: 95,
  CONFLICT: 90,
  EARTHQUAKE: 80,
  VOLCANO: 75,
  FLOOD: 65,
  STORM: 60,
  CIVIL_UNREST: 55,
  WILDFIRE: 50,
  DISEASE: 70,
  DROUGHT: 30,
};

export function scoreEvent(event: Omit<GeoEvent, 'score' | 'riskLevel' | 'recommendedAction'>): number {
  const baseScore = RISK_WEIGHTS[event.type] ?? 50;
  return Math.min(100, Math.round(baseScore));
}

// Unified thresholds — delegates to the app-wide central classifier so a score
// maps to the SAME level here as everywhere else (see riskClassification.ts).
export function scoreToRiskLevel(score: number): RiskLevel {
  return classifyRiskByScore(score).band;
}

export function getRecommendedAction(level: RiskLevel, _type: GeoEvent['type']): string {
  const actions: Record<RiskLevel, string> = {
    CRITICAL: 'Immediate evacuation recommended. Contact Saudi Embassy now.',
    HIGH: 'Avoid affected areas. Register with embassy. Monitor closely.',
    MEDIUM: 'Exercise high caution. Stay informed of local developments.',
    LOW: 'Normal precautions apply. Stay aware of local news.',
    SAFE: 'Standard travel advisory. Enjoy your travel safely.',
  };
  return actions[level];
}

const PRIORITY: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, SAFE: 4 };

export function assessCountryRisk(
  countryCode: string,
  country: string,
  events: GeoEvent[],
  travelers: Traveler[]
): RiskAssessment {
  const countryEvents = events.filter((e) => e.countryCode === countryCode);
  const topEvent = [...countryEvents].sort(
    (a, b) => PRIORITY[a.riskLevel] - PRIORITY[b.riskLevel] || b.score - a.score
  )[0];

  const overallRisk = topEvent?.riskLevel ?? 'SAFE';
  const score = topEvent?.score ?? 0;
  const travelersAtRisk = travelers.filter((t) => t.countryCode === countryCode).length;

  return {
    country,
    countryCode,
    overallRisk,
    score,
    events: countryEvents,
    travelersAtRisk,
    recommendation: topEvent ? getRecommendedAction(overallRisk, topEvent.type) : 'No active risk detected.',
    recommendationAr: topEvent ? getRecommendedActionAr(overallRisk) : 'لا توجد مخاطر نشطة حاليًا.',
  };
}

function getRecommendedActionAr(level: RiskLevel): string {
  const actions: Record<RiskLevel, string> = {
    CRITICAL: 'يُنصح بالإخلاء الفوري. تواصل مع السفارة السعودية الآن.',
    HIGH: 'تجنب المناطق المتأثرة. سجّل لدى السفارة. راقب الوضع عن كثب.',
    MEDIUM: 'توخّ الحذر الشديد. تابع آخر التطورات المحلية.',
    LOW: 'الاحتياطات العادية كافية. تابع الأخبار المحلية.',
    SAFE: 'نصيحة سفر عادية. رحلة آمنة.',
  };
  return actions[level];
}

export function generateNotificationMessage(event: GeoEvent, traveler: Traveler): string {
  return `${traveler.nameEn}, a ${event.riskLevel} risk event has been detected in ${event.country}: "${event.title}". ${event.recommendedAction}`;
}

export function generateNotificationMessageAr(event: GeoEvent, traveler: Traveler): string {
  return `${traveler.nameAr}، تم رصد حدث بمستوى خطورة ${event.riskLevel} في ${event.country}: "${event.title}". يرجى اتباع الإجراءات الموصى بها فورًا.`;
}

export function generateAiSuggestion(event: GeoEvent, traveler: Traveler): { en: string; ar: string } {
  const en = `Based on your location in ${traveler.destination} and the current ${event.riskLevel.toLowerCase()} risk level, we recommend staying alert, avoiding the affected area, and keeping your phone charged for further updates.`;
  const ar = `بناءً على موقعك في ${traveler.destination} ومستوى الخطورة الحالي (${event.riskLevel})، ننصح بالبقاء يقظًا وتجنّب المنطقة المتأثرة والإبقاء على هاتفك مشحونًا لتلقي التحديثات.`;
  return { en, ar };
}

export function generateActionSteps(_event: GeoEvent): { en: string[]; ar: string[] } {
  const en = [
    'Stay calm and move away from the affected area if possible.',
    'Contact your emergency contact and the nearest Saudi embassy or consulate.',
    'Keep your passport and essential documents with you at all times.',
    'Follow instructions from local authorities and official channels.',
  ];
  const ar = [
    'حافظ على هدوئك وابتعد عن المنطقة المتأثرة إن أمكن.',
    'تواصل مع جهة الاتصال في حالات الطوارئ وأقرب سفارة أو قنصلية سعودية.',
    'احتفظ بجواز سفرك والوثائق الأساسية معك في جميع الأوقات.',
    'اتبع تعليمات السلطات المحلية والقنوات الرسمية.',
  ];
  return { en, ar };
}
