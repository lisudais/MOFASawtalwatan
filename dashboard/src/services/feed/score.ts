// Global Alert Feed — Stage 5 (SCORING). DETERMINISTIC. NO AI. EVER.
//
// This is the only place in the pipeline that produces a risk number. It is a
// pure function of facts established by Stages 1-4:
//
//   • which tier the contributing sources belong to      (Stage 3)
//   • whether an official statement is among them        (Stage 1 source identity)
//   • how many DISTINCT sources confirmed the same event (Stage 4)
//   • the sources' own severity expressions              (Stage 1 severityHint)
//
// The LLM's `classifierConfidence` and Phase-B `confidence` are NOT inputs to
// the score. They are metadata. A model's self-reported certainty must never
// move a risk number on a government dashboard.
//
// Every score ships with a ScoreBreakdown explaining itself, so the UI can
// answer "why is this 87?" by citing rules and sources, not vibes.
//
// ── Bands (from the spec) ───────────────────────────────────────────────────
//   Tier1 + official statement           →  80-100   (scaled by severity)
//   Tier1, no official confirmation      →  50-70
//   Tier2 only, no Tier1                 →  30-50
//   Single uncorroborated source         →  hard cap 30, tagged "unconfirmed"
//   +10-15 corroboration bonus when >= 2 independent sources confirm
//
// The single-source cap does NOT apply to `tier1_official_confirmed`. An official
// government/UN determination is the authoritative record of its own event and
// needs no second outlet to be believed. Taken literally, the two spec rules
// contradict — a Tier-1 official statement is inherently a single source — and
// the literal reading pinned every cluster in the pipeline at exactly 30. Every
// other band keeps the cap, including `tier1_unconfirmed`: a lone ACLED incident
// with no official statement behind it remains a single unconfirmed assertion.
//
// ── Known ceilings, by construction, not by accident ────────────────────────
//   • health / economic clusters can never reach Tier 1: Stage 1 ingests none
//     of their Tier-1 sources (WHO, disease.sh, ECDC / World Bank, IMF, AV).
//     Their maximum is therefore the Tier-2 band. See routing.TIER1_NOT_INGESTED.
//   • GDELT articles from outlets other than BBC route to tier:null (Reuters,
//     AP and Bloomberg are not indexed by GDELT), so they land in the untiered
//     band and are capped at 30.
//   Both ceilings are reported in the breakdown as `ceilingNote`, so a low score
//   caused by a missing integration is never mistaken for a low-risk event.

import type { Cluster } from './corroborate';
import type { EventType, RawSignal, SignalSource } from './types';
import { TIER1_NOT_INGESTED } from './routing';

/* ── Band definitions ─────────────────────────────────────────────────────── */
export type Band =
  | 'tier1_official_confirmed'
  | 'tier1_unconfirmed'
  | 'tier2_only'
  | 'untiered';

const BANDS: Record<Band, { lo: number; hi: number }> = {
  tier1_official_confirmed: { lo: 80, hi: 100 },
  tier1_unconfirmed: { lo: 50, hi: 70 },
  tier2_only: { lo: 30, hi: 50 },
  // Not in the spec's four rules, but required: a signal that is neither Tier 1
  // nor Tier 2 still has to score something. It sits below the Tier-2 floor and
  // is capped at 30 regardless.
  untiered: { lo: 10, hi: 30 },
};

/** Hard ceiling for anything a single source asserts alone. */
const UNCORROBORATED_CAP = 30;

/** Corroboration bonus: 10 for the second source, +2.5 each after, max 15. */
const BONUS_BASE = 10;
const BONUS_PER_EXTRA = 2.5;
const BONUS_MAX = 15;

/**
 * Sources whose output IS an official statement or an official determination.
 * ACLED is deliberately excluded: it is a curated event dataset, authoritative
 * for "an incident occurred", but it is not a government/UN statement.
 */
const OFFICIAL_STATEMENT_SOURCES: SignalSource[] = ['STATE_DEPT', 'RELIEFWEB', 'RSS'];

/* ── Severity normalization ───────────────────────────────────────────────────
   `severityHint` is a verbatim string because 'M6.8', 'Level 4' and 'CRITICAL'
   are not commensurable. Here — and only here — each is mapped to a 0-1 factor
   that positions the score inside its band. The table is exhaustive and
   auditable; an unrecognized hint yields null, which means "no severity
   information", NOT "low severity". */

/** USGS/EMSC magnitudes. M4.5 is the ingestion floor; M8.0+ saturates. */
function magnitudeFactor(mag: number): number {
  const clamped = Math.min(Math.max(mag, 4.5), 8.0);
  return (clamped - 4.5) / (8.0 - 4.5);
}

const GDACS_ALERT_FACTOR: Record<string, number> = { green: 0.2, orange: 0.6, red: 1.0 };
const SEVERITY_WORD_FACTOR: Record<string, number> = {
  low: 0.2, medium: 0.5, high: 0.75, critical: 1.0,
};

/** Returns 0-1, or null when the source gave us no usable severity. */
export function severityFactor(hint: string | null): number | null {
  if (!hint) return null;
  const h = hint.trim().toLowerCase();

  const mag = h.match(/^m\s?(\d+(?:\.\d+)?)$/);
  if (mag) return magnitudeFactor(parseFloat(mag[1]));

  if (h in GDACS_ALERT_FACTOR) return GDACS_ALERT_FACTOR[h];
  if (h in SEVERITY_WORD_FACTOR) return SEVERITY_WORD_FACTOR[h];

  const level = h.match(/^level\s*([1-4])$/);
  if (level) return (parseInt(level[1], 10) - 1) / 3;

  return null;
}

/**
 * A cluster's severity factor is the MAXIMUM across its members: if one source
 * says M7.2 and another gives no magnitude, the event is an M7.2 event. Null
 * when no member carried usable severity — the score then sits at the band's
 * midpoint, which is an explicit "unknown", not a guess in either direction.
 */
function clusterSeverityFactor(members: RawSignal[]): number | null {
  const factors = members.map((m) => severityFactor(m.severityHint)).filter((f): f is number => f !== null);
  return factors.length > 0 ? Math.max(...factors) : null;
}

/* ── Breakdown ────────────────────────────────────────────────────────────── */
export interface ScoreContribution {
  source: SignalSource;
  tier: 1 | 2 | null;
  official: boolean;
  severityHint: string | null;
}

export interface ScoreBreakdown {
  band: Band;
  bandRange: { lo: number; hi: number };
  /** Human-readable rule that selected the band. */
  bandReason: string;
  severityFactor: number | null;
  /** Score after positioning within the band, before bonus and caps. */
  baseScore: number;
  corroborationBonus: number;
  bonusReason: string | null;
  /** Set when a hard cap changed the score. */
  capApplied: { cap: number; reason: string } | null;
  /** Set when a missing integration — not the evidence — limits this score. */
  ceilingNote: string | null;
  contributions: ScoreContribution[];
  tags: ('unconfirmed' | 'corroborated' | 'official')[];
}

export interface ScoredCluster {
  cluster: Cluster;
  score: number;
  breakdown: ScoreBreakdown;
}

/** Why a given event type can't reach Tier 1 today, or null if it can. */
function ceilingNoteFor(eventType: EventType, band: Band): string | null {
  const missing = TIER1_NOT_INGESTED[eventType];
  if (missing.length > 0 && band !== 'tier1_official_confirmed' && band !== 'tier1_unconfirmed') {
    return `ceiling: no Tier-1 source for '${eventType}' is ingested (${missing.join(', ')}), so this cluster cannot exceed the Tier-2 band regardless of evidence`;
  }
  if (band === 'untiered') {
    return 'ceiling: no contributing source is Tier-1 or an indexed Tier-2 outlet; capped at 30 as a single uncorroborated report';
  }
  return null;
}

function selectBand(members: RawSignal[]): { band: Band; reason: string; hasOfficial: boolean } {
  const hasTier1 = members.some((m) => m.tier === 1);
  const hasTier2 = members.some((m) => m.tier === 2);
  const hasOfficial = members.some((m) => OFFICIAL_STATEMENT_SOURCES.includes(m.source));

  if (hasTier1 && hasOfficial) {
    return { band: 'tier1_official_confirmed', reason: 'Tier-1 source confirmed by an official statement', hasOfficial };
  }
  if (hasTier1) {
    return { band: 'tier1_unconfirmed', reason: 'Tier-1 source, not confirmed by any official statement', hasOfficial };
  }
  if (hasTier2) {
    return { band: 'tier2_only', reason: 'trusted media only, no Tier-1 source', hasOfficial };
  }
  return { band: 'untiered', reason: 'no Tier-1 or Tier-2 source among contributors', hasOfficial };
}

function corroborationBonus(distinctSources: number): { bonus: number; reason: string | null } {
  if (distinctSources < 2) return { bonus: 0, reason: null };
  const raw = BONUS_BASE + (distinctSources - 2) * BONUS_PER_EXTRA;
  const bonus = Math.min(raw, BONUS_MAX);
  return { bonus, reason: `${distinctSources} independent sources confirmed the same event (+${bonus})` };
}

/**
 * Scores one cluster. Pure, total, no I/O, no model. Given the same inputs it
 * returns the same number forever — which is what makes the breakdown a real
 * audit trail rather than a post-hoc rationalization.
 */
export function scoreCluster(cluster: Cluster, signalsById: Map<string, RawSignal>): ScoredCluster {
  const members = cluster.signalIds
    .map((id) => signalsById.get(id))
    .filter((s): s is RawSignal => s !== undefined);

  const { band, reason: bandReason } = selectBand(members);
  const { lo, hi } = BANDS[band];

  // Position within the band by severity. No severity information ⇒ midpoint,
  // an explicit "unknown" rather than an optimistic or pessimistic guess.
  const factor = clusterSeverityFactor(members);
  const baseScore = lo + (factor ?? 0.5) * (hi - lo);

  const distinctSources = new Set(members.map((m) => m.source)).size;
  const { bonus, reason: bonusReason } = corroborationBonus(distinctSources);

  let score = baseScore + bonus;

  // A single source is normally an assertion, not a confirmation — EXCEPT when
  // that source is an official government/UN determination at Tier 1. A State
  // Dept advisory or a UN statement IS the authoritative record of the event; it
  // does not need a second outlet to be true. Without this exemption the spec's
  // two rules contradict each other (a Tier-1 official statement is, by nature,
  // a single source), and every cluster in the pipeline pinned at exactly 30.
  //
  // The 'unconfirmed' tag still attaches below, so a lone advisory reads
  // "87 · unconfirmed+official" — uncapped, but never silently passed off as
  // corroborated.
  //
  // `tier1_unconfirmed` stays capped on purpose: a lone ACLED incident with no
  // official statement behind it is still a single unconfirmed assertion.
  let capApplied: ScoreBreakdown['capApplied'] = null;
  const capExempt = band === 'tier1_official_confirmed';

  if (distinctSources < 2 && !capExempt) {
    if (score > UNCORROBORATED_CAP) {
      capApplied = { cap: UNCORROBORATED_CAP, reason: 'single uncorroborated source' };
      score = UNCORROBORATED_CAP;
    }
  } else if (distinctSources >= 2 && band === 'untiered' && score > UNCORROBORATED_CAP) {
    // Corroborated, but by sources we do not trust at either tier.
    capApplied = { cap: UNCORROBORATED_CAP, reason: 'corroborated only by untiered sources' };
    score = UNCORROBORATED_CAP;
  }

  score = Math.round(Math.min(Math.max(score, 0), 100));

  const tags: ScoreBreakdown['tags'] = [];
  if (distinctSources < 2) tags.push('unconfirmed');
  else tags.push('corroborated');
  if (members.some((m) => OFFICIAL_STATEMENT_SOURCES.includes(m.source))) tags.push('official');

  return {
    cluster,
    score,
    breakdown: {
      band,
      bandRange: { lo, hi },
      bandReason,
      severityFactor: factor,
      baseScore: Math.round(baseScore * 10) / 10,
      corroborationBonus: bonus,
      bonusReason,
      capApplied,
      ceilingNote: ceilingNoteFor(cluster.eventType, band),
      contributions: members.map((m) => ({
        source: m.source,
        tier: m.tier,
        official: OFFICIAL_STATEMENT_SOURCES.includes(m.source),
        severityHint: m.severityHint,
      })),
      tags,
    },
  };
}

export interface ScoreResult {
  scored: ScoredCluster[];
  stats: {
    clusters: number;
    byBand: Record<Band, number>;
    capped: number;
    ceilingLimited: number;
    maxScore: number;
  };
}

/** Scores every cluster and ranks highest-risk first. */
export function scoreClusters(clusters: Cluster[], signals: RawSignal[]): ScoreResult {
  const signalsById = new Map(signals.map((s) => [s.id, s]));
  const scored = clusters
    .map((c) => scoreCluster(c, signalsById))
    .sort((a, b) => b.score - a.score);

  const byBand: Record<Band, number> = {
    tier1_official_confirmed: 0, tier1_unconfirmed: 0, tier2_only: 0, untiered: 0,
  };
  for (const s of scored) byBand[s.breakdown.band]++;

  return {
    scored,
    stats: {
      clusters: scored.length,
      byBand,
      capped: scored.filter((s) => s.breakdown.capApplied !== null).length,
      ceilingLimited: scored.filter((s) => s.breakdown.ceilingNote !== null).length,
      maxScore: scored.length > 0 ? scored[0].score : 0,
    },
  };
}
