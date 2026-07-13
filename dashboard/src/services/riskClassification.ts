// ─────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for severity classification across the ENTIRE app.
//
// Before this module, at least four different threshold sets turned the same
// 0-100 score into a band/colour/label (riskEngine 20/40/65/85, the feed
// 30/55/75, security 40/60/80, health 25/50/75). The same event therefore read
// "منخفض/أخضر" in one place and "متوسط/أصفر" in another. Every severity display
// now goes through the functions here — no local thresholds anywhere else.
//
// Unified bands (inclusive, 0-100):
//   0–25   منخفض  green   (#00E676)
//   26–50  متوسط  yellow  (#FFD600)
//   51–75  مرتفع  orange  (#FF6D00)
//   76–100 حرج    red     (#FF1744)
//
// NOTE ON "غير مؤكد": that badge is a SEPARATE dimension (source corroboration:
// single-source vs multi-source), NOT a severity level. It is intentionally not
// modelled here. Severity answers "how dangerous"; corroboration answers "how
// confirmed". A scored event is always classified by the bands above; the
// corroboration tag never substitutes for a severity level.
// ─────────────────────────────────────────────────────────────────────────

import type { RiskLevel } from '../types';

export type SeverityBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskClassification {
  band: SeverityBand;
  labelAr: string;
  color: string;
  /** Inclusive lower bound of this band on the 0-100 scale. */
  minScore: number;
}

// High → low so the first `score >= minScore` match wins.
const BANDS: readonly RiskClassification[] = [
  { band: 'CRITICAL', labelAr: 'حرج',   color: '#FF1744', minScore: 76 },
  { band: 'HIGH',     labelAr: 'مرتفع', color: '#FF6D00', minScore: 51 },
  { band: 'MEDIUM',   labelAr: 'متوسط', color: '#FFD600', minScore: 26 },
  { band: 'LOW',      labelAr: 'منخفض', color: '#00E676', minScore: 0  },
];

// "No active risk" sentinel — only reachable via the categorical path, never
// from a real positive score. Distinct blue so it never reads as green "low".
const SAFE_CLASS: RiskClassification = { band: 'LOW', labelAr: 'آمن', color: '#2979FF', minScore: 0 };

/**
 * THE canonical numeric → severity mapping. Give it a 0-100 score, get the one
 * classification the whole app agrees on. Out-of-range/NaN scores are clamped.
 */
export function classifyRiskByScore(score: number): RiskClassification {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  for (const band of BANDS) {
    if (s >= band.minScore) return band;
  }
  return BANDS[BANDS.length - 1];
}

const LEVEL_MAP: Record<RiskLevel, RiskClassification> = {
  CRITICAL: BANDS[0],
  HIGH: BANDS[1],
  MEDIUM: BANDS[2],
  LOW: BANDS[3],
  SAFE: SAFE_CLASS,
};

/**
 * Classify a categorical RiskLevel — returns the SAME colour/label the score
 * path would for that band, so numeric and categorical displays never diverge.
 */
export function classifyRiskByLevel(level: RiskLevel): RiskClassification {
  return LEVEL_MAP[level] ?? BANDS[BANDS.length - 1];
}

/** score → band ('LOW'|'MEDIUM'|'HIGH'|'CRITICAL'). */
export const scoreToBand = (score: number): SeverityBand => classifyRiskByScore(score).band;
/** score → hex colour (used by the feed, security bars, detail panels…). */
export const severityColor = (score: number): string => classifyRiskByScore(score).color;
/** score → Arabic label (منخفض/متوسط/مرتفع/حرج). */
export const severityLabelAr = (score: number): string => classifyRiskByScore(score).labelAr;
