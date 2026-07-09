// Global Alert Feed — Stage 6 (SUMMARY).
//
// Produces the short Arabic card summary for a scored cluster, using ONLY the
// verified structured data established by Stages 1-5 plus the source's own text.
// The model never introduces a fact that is not present in its input.
//
// gpt-oss-20b, reasoning_effort: low, grammar-constrained decoding.
//
// ── Why this stage is the most dangerous one in the pipeline ────────────────
// Classification (Stage 2) can only pick from a closed enum. Corroboration
// (Stage 4) can only answer yes/no. Scoring (Stage 5) has no model at all.
// Summarization is the ONLY stage where the model emits free prose, and prose is
// where a casualty count, a date, or a place name gets invented. On a ministry
// crisis dashboard that is the one failure mode that actually matters.
//
// So the output is checked deterministically before it is accepted:
//
//   1. GROUNDING. The model must copy a verbatim `evidence` span out of one of
//      the source texts. If that span is not a real substring of the input, the
//      summary is rejected wholesale — the model was not reading its input.
//
//   2. NO NEW NUMBERS. Every numeral appearing in the summary must also appear
//      in the facts we handed it. A summary that says "14 killed" when no input
//      contains "14" is rejected. This catches the single most damaging class of
//      hallucination on this dashboard.
//
// A rejected or unavailable summary falls back to a DETERMINISTIC TEMPLATE built
// only from structured fields. The card always renders; it just says less. The
// `aiGenerated` flag records which path produced it, so the UI can label it.

import { guidedJson, LlmError } from './llm';
import { COUNTRY_BY_ISO2 } from './watchlist';
import type { ScoredCluster } from './score';
import type { EventType, RawSignal } from './types';

/** Only the top-scoring clusters get an LLM call; the rest use the template. */
export const DEFAULT_SUMMARY_LIMIT = 20;
const SUMMARY_MAX_TOKENS = 500;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    evidence: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['evidence', 'summary'],
} as const;

const EVENT_TYPE_AR: Record<EventType, string> = {
  security: 'أمني',
  natural_disaster: 'كارثة طبيعية',
  health: 'صحي',
  economic: 'اقتصادي',
  political_unrest: 'اضطراب سياسي',
};

const SYSTEM_PROMPT = [
  'You write one-sentence Arabic summaries for cards on a government crisis dashboard.',
  '',
  'For the event described below:',
  '1. `evidence`: copy, VERBATIM and in the original language, the span of the source',
  '   text that your summary is based on. It must appear character-for-character in',
  '   the source text you were given. Do NOT include the "[1]" index marker.',
  '2. `summary`: one sentence in Modern Standard Arabic, at most 20 words.',
  '',
  'HARD RULES:',
  '- Use ONLY facts present in the data below. Invent nothing.',
  '- Do NOT state any number (casualties, magnitude, dates) that does not appear',
  '  verbatim in the data below. If a count is not given, do not imply one.',
  '- Do NOT name a place that is not given below.',
  '- Do NOT assess risk, severity or likelihood. The score is computed elsewhere.',
  '- Do NOT recommend actions.',
  '- Describe only what the sources report.',
].join('\n');

export interface ClusterSummary {
  clusterId: string;
  summary: string;
  /** false when the deterministic template produced it. */
  aiGenerated: boolean;
  /** Set when an AI summary was produced and then rejected. */
  rejectedReason?: 'evidence_not_in_source' | 'introduced_new_number' | 'empty';
  evidence?: string;
}

/* ── Deterministic fallback ─────────────────────────────────────────────────
   Built only from structured fields. Says less, invents nothing. */
export function templateSummary(sc: ScoredCluster, members: RawSignal[]): string {
  const country = sc.cluster.country ? COUNTRY_BY_ISO2[sc.cluster.country]?.ar : null;
  const where = country ? ` في ${country}` : '';
  const kind = EVENT_TYPE_AR[sc.cluster.eventType];
  const sources = sc.cluster.distinctSources.join('، ');
  const sev = members.map((m) => m.severityHint).find(Boolean);
  const sevText = sev ? ` (${sev})` : '';
  const count = members.length > 1 ? ` من ${members.length} تقارير` : '';
  return `حدث ${kind}${where}${sevText}، مُبلَّغ عنه${count} عبر: ${sources}.`;
}

/* ── Deterministic verification of the model's output ───────────────────── */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** Normalizes Arabic-Indic digits so "١٤" and "14" compare equal. */
function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
}

function numbersIn(text: string): string[] {
  return normalizeDigits(text).match(/\d+(?:[.,]\d+)?/g) ?? [];
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The evidence must genuinely occur in the source text. A model that cannot
 * quote its input is not reading it, and its prose cannot be trusted.
 *
 * Two benign formatting artifacts are tolerated, both observed live and neither
 * a fabrication:
 *   • the model copies the "[2] " index marker we printed in the prompt
 *   • on a multi-report cluster it quotes several source lines at once
 *
 * So evidence is split per line, the index marker is stripped, and EVERY
 * remaining line must be a real span of SOME source text. Quoting two sources is
 * allowed; inventing one line among four is not — that still fails.
 *
 * Exported so the guard can be tested directly: it is the load-bearing
 * anti-fabrication check, not an implementation detail.
 */
export function evidenceIsGrounded(evidence: string, sourceTexts: string[]): boolean {
  const haystacks = sourceTexts.map(normalizeWhitespace);

  const lines = evidence
    .split('\n')
    .map((l) => normalizeWhitespace(l.replace(/^\s*\[\d+\]\s*/, '')))
    .filter((l) => l.length > 0);

  if (lines.length === 0) return false;
  // Too short to be a meaningful quote — and trivially a substring of anything.
  if (lines.every((l) => l.length < 4)) return false;

  return lines.every((line) => haystacks.some((t) => t.includes(line)));
}

/**
 * Every numeral in the summary must appear in the facts. Catches invented
 * casualty counts, magnitudes and dates — the most damaging hallucination here.
 * Returns the offending numeral, or null when the summary invents none.
 * Exported for direct testing, as above.
 */
export function introducesNewNumber(summary: string, factsBlob: string): string | null {
  const allowed = new Set(numbersIn(factsBlob));
  for (const n of numbersIn(summary)) {
    if (!allowed.has(n)) return n;
  }
  return null;
}

/* ── Prompt construction ───────────────────────────────────────────────────
   Only verified structured data + the sources' own text. The score, band and
   tags are deliberately WITHHELD: the model is told not to assess risk, and it
   cannot leak a number it never saw. */
function buildFacts(sc: ScoredCluster, members: RawSignal[]): { prompt: string; blob: string; sourceTexts: string[] } {
  const country = sc.cluster.country ? COUNTRY_BY_ISO2[sc.cluster.country] : null;
  const sourceTexts = members.map((m) => m.rawText).filter((t): t is string => !!t);

  const lines = [
    `Event type: ${sc.cluster.eventType}`,
    `Country: ${country ? `${country.en} (${country.iso2})` : 'not determined'}`,
    `Reported by: ${sc.cluster.distinctSources.join(', ')}`,
    `Number of reports: ${members.length}`,
  ];

  // `severityHint` is deliberately NOT passed. Handing the model "HIGH" made it
  // write "تصنيف الحدث كحادث أمان عالي" — reporting the severity, but blurring the
  // line: severity belongs to Stage 5's number, never to Stage 6's prose. The
  // model now cannot mention a severity it was never shown.
  const earliest = members
    .map((m) => m.occurredAt)
    .sort()[0];
  if (earliest) lines.push(`First reported: ${earliest.slice(0, 10)}`);

  const texts = sourceTexts.length
    ? sourceTexts.map((t, i) => `[${i + 1}] ${normalizeWhitespace(t).slice(0, 400)}`).join('\n')
    : '(the sources provided no text — summarize from the structured fields only)';

  const prompt = `DATA\n${lines.join('\n')}\n\nSOURCE TEXT\n${texts}`;
  return { prompt, blob: `${lines.join('\n')}\n${texts}`, sourceTexts };
}

/** Summarizes one cluster. Never throws; falls back to the template. */
export async function summarizeCluster(sc: ScoredCluster, members: RawSignal[]): Promise<ClusterSummary> {
  const fallback = (reason?: ClusterSummary['rejectedReason']): ClusterSummary => ({
    clusterId: sc.cluster.id,
    summary: templateSummary(sc, members),
    aiGenerated: false,
    rejectedReason: reason,
  });

  const { prompt, blob, sourceTexts } = buildFacts(sc, members);

  // With no source text there is nothing to ground against, so an AI sentence
  // could only be embellishment of the structured fields. Use the template.
  if (sourceTexts.length === 0) return fallback();

  let out: { evidence: string; summary: string };
  try {
    out = await guidedJson<{ evidence: string; summary: string }>({
      system: SYSTEM_PROMPT,
      user: prompt,
      schema: SUMMARY_SCHEMA,
      reasoningEffort: 'low',
      maxTokens: SUMMARY_MAX_TOKENS,
    });
  } catch (err) {
    void (err instanceof LlmError);
    return fallback();
  }

  const summary = (out.summary ?? '').trim();
  if (!summary) return fallback('empty');

  if (!evidenceIsGrounded(out.evidence ?? '', sourceTexts)) {
    return fallback('evidence_not_in_source');
  }

  const invented = introducesNewNumber(summary, blob);
  if (invented !== null) {
    return fallback('introduced_new_number');
  }

  return { clusterId: sc.cluster.id, summary, aiGenerated: true, evidence: out.evidence };
}

export interface SummarizeResult {
  summaries: Map<string, ClusterSummary>;
  stats: {
    clusters: number;
    aiAttempted: number;
    aiAccepted: number;
    rejectedEvidence: number;
    rejectedNumber: number;
    templated: number;
  };
}

/**
 * Summarizes the top `limit` clusters by score with the model; everything below
 * gets the deterministic template. Summarizing ~100 clusters per refresh would
 * cost more LLM time than the rest of the pipeline combined, and the cards below
 * the fold are not read.
 */
export async function summarizeClusters(
  scored: ScoredCluster[],
  signals: RawSignal[],
  limit: number = DEFAULT_SUMMARY_LIMIT
): Promise<SummarizeResult> {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const membersOf = (sc: ScoredCluster) =>
    sc.cluster.signalIds.map((id) => byId.get(id)).filter((s): s is RawSignal => !!s);

  const summaries = new Map<string, ClusterSummary>();
  let aiAttempted = 0, aiAccepted = 0, rejectedEvidence = 0, rejectedNumber = 0, templated = 0;

  for (let i = 0; i < scored.length; i++) {
    const sc = scored[i];
    const members = membersOf(sc);

    if (i >= limit) {
      summaries.set(sc.cluster.id, { clusterId: sc.cluster.id, summary: templateSummary(sc, members), aiGenerated: false });
      templated++;
      continue;
    }

    aiAttempted++;
    const result = await summarizeCluster(sc, members);
    summaries.set(sc.cluster.id, result);

    if (result.aiGenerated) aiAccepted++;
    else {
      templated++;
      if (result.rejectedReason === 'evidence_not_in_source') rejectedEvidence++;
      if (result.rejectedReason === 'introduced_new_number') rejectedNumber++;
    }
  }

  return {
    summaries,
    stats: { clusters: scored.length, aiAttempted, aiAccepted, rejectedEvidence, rejectedNumber, templated },
  };
}
