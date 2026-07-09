// Global Alert Feed — Stage 4 (CORROBORATION). Two phases.
//
//   Phase A — NO AI. Cheap deterministic candidate generation: group signals by
//             country + event_type + a 24-48h window, then pair within groups.
//   Phase B — AI, grammar-constrained. Asks "same underlying event?" for each
//             Phase-A candidate pair. NEVER all-vs-all.
//
// The model decides only whether two signals describe one event. It does not
// score, rank, or weigh sources. The clusters it helps form are inputs to Stage
// 5's deterministic corroboration bonus.
//
// ── Why the pair budget matters ─────────────────────────────────────────────
// Pairing is O(n²) inside a group. A single busy country/event-type bucket
// (e.g. UA/security) can hold dozens of signals, and 30 signals is 435 pairs —
// each one an LLM call. So groups are capped and pairs are PRIORITIZED:
// cross-source pairs first, because only those can produce the independent
// corroboration Stage 5 rewards. Same-source pairs merely deduplicate.
//
// Anything dropped by a cap is COUNTED, never silently discarded.

import { guidedJson, LlmError } from './llm';
import type { EventType, RawSignal } from './types';

/** Signals more than this far apart cannot describe the same event. */
const WINDOW_HOURS = 48;
/** Beyond this, a group is truncated (most recent kept) and the loss is reported. */
const MAX_GROUP_SIZE = 12;
/** Hard ceiling on LLM pair calls per corroboration run. */
const MAX_PAIRS = 120;
const PAIR_MAX_TOKENS = 1200;

/* ── Why 'medium' and not the specified 'high' ───────────────────────────────
   The spec calls for reasoning_effort: high on Phase B. Measured against
   gpt-oss:20b via Ollama, `high` is UNUSABLE for this task:

     hard pair, think=high,   num_predict=400   → EMPTY (done_reason=length)
     hard pair, think=high,   num_predict=1200  → EMPTY (done_reason=length)
     hard pair, think=high,   num_predict=2500  → EMPTY (done_reason=length)
     hard pair, think=high,   num_predict=6000  → EMPTY (done_reason=length, 36s)
     hard pair, think=medium, num_predict=1200  → {"same_event":true,"confidence":0.95}  2.4s
     hard pair, think=low,    num_predict=400   → {"same_event":true,"confidence":0.9}   1.0s

   The reasoning trace scales with input difficulty and never terminates on an
   ambiguous pair — and ambiguous pairs are exactly the ones Phase B exists to
   adjudicate. An easy pair (a strike vs. an earthquake) returns fine at `high`,
   which makes the failure mode especially treacherous: it silently swallows the
   hard cases while looking healthy on the easy ones.

   `medium` answers both the hard and the easy pair correctly and fast, so Phase
   B runs at 'medium'. Revisit if the model or server changes. */
const PAIR_EFFORT = 'medium' as const;

const PAIR_SCHEMA = {
  type: 'object',
  properties: {
    same_event: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['same_event', 'confidence'],
} as const;

const PAIR_SYSTEM = [
  'You decide whether two news/report snippets describe THE SAME underlying real-world event.',
  '',
  'Same event means: the same incident, in the same place, at the same time.',
  'Two different strikes on the same day in the same country are DIFFERENT events.',
  'A report and a follow-up about the same incident are the SAME event.',
  'Two earthquakes of different magnitudes are DIFFERENT events, even if minutes apart.',
  'General commentary about an ongoing situation is NOT the same event as a specific incident.',
  '',
  'The snippets may be in different languages. Judge the underlying event, not the wording.',
  'When genuinely unsure, answer false. A false merge is far more damaging than a missed one:',
  'it fabricates corroboration where none exists.',
].join('\n');

export interface Cluster {
  id: string;
  country: string | null;
  eventType: EventType;
  signalIds: string[];
  /** Distinct SignalSources across members — what Stage 5's bonus keys on. */
  distinctSources: string[];
  /** Highest (numerically lowest) tier present: 1 beats 2 beats null. */
  bestTier: 1 | 2 | null;
  /** true when members come from >= 2 distinct sources confirmed as the same event. */
  corroborated: boolean;
  /** Why this is a singleton, when it is. */
  singletonReason?: 'no_country' | 'no_candidates' | 'no_confirmed_pair';
}

export interface CorroborateResult {
  clusters: Cluster[];
  stats: {
    signals: number;
    groups: number;
    /** Signals that could not be grouped because Stage 2 left country null. */
    ungroupable: number;
    candidatePairs: number;
    pairsEvaluated: number;
    pairsConfirmed: number;
    pairsDroppedByCap: number;
    groupsTruncated: number;
    clusters: number;
    corroboratedClusters: number;
  };
  failed: { pair: [string, string]; error: string }[];
}

function hoursApart(a: RawSignal, b: RawSignal): number {
  return Math.abs(Date.parse(a.occurredAt) - Date.parse(b.occurredAt)) / 3_600_000;
}

/** Phase A. Deterministic. Groups by country + eventType, then pairs within window. */
function buildCandidatePairs(signals: RawSignal[]): {
  pairs: [RawSignal, RawSignal][];
  groups: Map<string, RawSignal[]>;
  ungroupable: RawSignal[];
  droppedByCap: number;
  groupsTruncated: number;
} {
  const groups = new Map<string, RawSignal[]>();
  const ungroupable: RawSignal[] = [];

  for (const s of signals) {
    // A null country cannot be grouped: it would collide with every other
    // unlocated signal of the same type. Stage 2b exists to shrink this set.
    if (s.country === null || s.eventType === null) {
      ungroupable.push(s);
      continue;
    }
    const key = `${s.country}|${s.eventType}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const pairs: [RawSignal, RawSignal][] = [];
  let droppedByCap = 0;
  let groupsTruncated = 0;

  for (const [, members] of groups) {
    let group = members;
    if (group.length > MAX_GROUP_SIZE) {
      groupsTruncated++;
      droppedByCap += group.length - MAX_GROUP_SIZE;
      group = [...group]
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
        .slice(0, MAX_GROUP_SIZE);
    }

    const crossSource: [RawSignal, RawSignal][] = [];
    const sameSource: [RawSignal, RawSignal][] = [];

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (hoursApart(group[i], group[j]) > WINDOW_HOURS) continue;
        // Cross-source first: only those can yield independent corroboration.
        (group[i].source !== group[j].source ? crossSource : sameSource).push([group[i], group[j]]);
      }
    }
    pairs.push(...crossSource, ...sameSource);
  }

  if (pairs.length > MAX_PAIRS) {
    droppedByCap += pairs.length - MAX_PAIRS;
    return { pairs: pairs.slice(0, MAX_PAIRS), groups, ungroupable, droppedByCap, groupsTruncated };
  }
  return { pairs, groups, ungroupable, droppedByCap, groupsTruncated };
}

function describe(s: RawSignal): string {
  const when = new Date(s.occurredAt).toISOString().slice(0, 16).replace('T', ' ');
  const sev = s.severityHint ? ` severity=${s.severityHint}` : '';
  return `source=${s.source} time=${when}${sev}\n${(s.rawText ?? '(no text)').replace(/\s+/g, ' ').slice(0, 400)}`;
}

/** Phase B. One grammar-constrained call per candidate pair. */
async function isSameEvent(a: RawSignal, b: RawSignal): Promise<{ same: boolean; confidence: number }> {
  const out = await guidedJson<{ same_event: boolean; confidence: number }>({
    system: PAIR_SYSTEM,
    user: `Snippet A:\n${describe(a)}\n\nSnippet B:\n${describe(b)}\n\nSame underlying event?`,
    schema: PAIR_SCHEMA,
    reasoningEffort: PAIR_EFFORT,
    maxTokens: PAIR_MAX_TOKENS,
  });
  return { same: out.same_event === true, confidence: out.confidence };
}

/** Union-find over confirmed pairs. */
function makeUnionFind(ids: string[]) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) { const next = parent.get(x)!; parent.set(x, root); x = next; }
    return root;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union };
}

function bestTierOf(members: RawSignal[]): 1 | 2 | null {
  if (members.some((s) => s.tier === 1)) return 1;
  if (members.some((s) => s.tier === 2)) return 2;
  return null;
}

export interface CorroborateOptions {
  /**
   * When false, Phase B (the LLM pairwise judgement) is skipped entirely and no
   * pair is confirmed — every signal becomes its own cluster. Used by the fast
   * streaming tier, which must paint in seconds and cannot wait on ~70 LLM calls.
   *
   * This is CONSERVATIVE by construction: with no confirmed pairs there is no
   * corroboration, so Stage 5 caps those clusters rather than inflating them.
   * A fast card can only ever under-state its score, never over-state it.
   */
  usePhaseB?: boolean;
}

/**
 * Runs both phases. Never throws: a failed pair is recorded and treated as
 * NOT the same event — the conservative direction, since a false merge
 * fabricates corroboration that Stage 5 would reward.
 */
export async function corroborateSignals(
  signals: RawSignal[],
  { usePhaseB = true }: CorroborateOptions = {}
): Promise<CorroborateResult> {
  const { pairs, groups, ungroupable, droppedByCap, groupsTruncated } = buildCandidatePairs(signals);

  const failed: CorroborateResult['failed'] = [];
  const confirmed: [string, string][] = [];

  if (usePhaseB) {
    for (const [a, b] of pairs) {
      try {
        const { same } = await isSameEvent(a, b);
        if (same) confirmed.push([a.id, b.id]);
      } catch (err) {
        failed.push({
          pair: [a.id, b.id],
          error: err instanceof LlmError ? err.message : String(err),
        });
        // treated as NOT the same event
      }
    }
  }

  const groupable = signals.filter((s) => !ungroupable.includes(s));
  const { find, union } = makeUnionFind(groupable.map((s) => s.id));
  for (const [a, b] of confirmed) union(a, b);

  const byRoot = new Map<string, RawSignal[]>();
  for (const s of groupable) {
    const root = find(s.id);
    const list = byRoot.get(root);
    if (list) list.push(s);
    else byRoot.set(root, [s]);
  }

  const clusters: Cluster[] = [];

  for (const [root, members] of byRoot) {
    const distinctSources = [...new Set(members.map((s) => s.source))];
    clusters.push({
      id: `cluster:${root}`,
      country: members[0].country,
      eventType: members[0].eventType as EventType,
      signalIds: members.map((s) => s.id),
      distinctSources,
      bestTier: bestTierOf(members),
      // Independent corroboration requires >= 2 DISTINCT sources agreeing.
      // Two signals from the same source are a duplicate, not a confirmation.
      corroborated: distinctSources.length >= 2,
      singletonReason: members.length === 1 ? 'no_confirmed_pair' : undefined,
    });
  }

  // Ungroupable signals still reach the feed — as singletons. Stage 5 caps them.
  for (const s of ungroupable) {
    if (s.eventType === null) continue;
    clusters.push({
      id: `cluster:${s.id}`,
      country: s.country,
      eventType: s.eventType,
      signalIds: [s.id],
      distinctSources: [s.source],
      bestTier: s.tier,
      corroborated: false,
      singletonReason: 'no_country',
    });
  }

  return {
    clusters,
    stats: {
      signals: signals.length,
      groups: groups.size,
      ungroupable: ungroupable.length,
      candidatePairs: pairs.length + droppedByCap,
      pairsEvaluated: usePhaseB ? pairs.length : 0,
      pairsConfirmed: confirmed.length,
      pairsDroppedByCap: droppedByCap,
      groupsTruncated,
      clusters: clusters.length,
      corroboratedClusters: clusters.filter((c) => c.corroborated).length,
    },
    failed,
  };
}
