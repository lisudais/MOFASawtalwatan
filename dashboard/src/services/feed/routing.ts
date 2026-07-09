// Global Alert Feed — Stage 3 (ROUTING). NO AI. Static config only.
//
// Assigns each classified signal a tier:
//   Tier 1 — official / structural sources. The authoritative backbone.
//   Tier 2 — trusted media. Corroborating, not authoritative.
//   null   — neither. Stage 5 caps these at 30 and tags them "unconfirmed".
//
// The tier is a pure function of (eventType, source, sourceDomain). No model is
// consulted and no heuristic is applied to the article text: a source either is
// on the list for that event type or it is not.
//
// ── A gap this config makes visible ─────────────────────────────────────────
// The routing table below is the one you specified. But three of its five
// event types have Tier-1 sources that the Stage 1 pipeline DOES NOT INGEST:
//
//   health         Tier1 [WHO, disease.sh, ECDC]                 — none ingested
//   economic       Tier1 [World Bank, IMF, central banks, AV]    — none ingested
//   political_unrest Tier1 [ReliefWeb, UN news, gov statements]  — partially (RSS/ReliefWeb)
//
// WHO and disease.sh are fetched by the Health card; World Bank and Alpha
// Vantage by the Economy card. Neither feeds the Global Alert Feed. So today a
// health or economic signal can only ever reach Tier 2 (if it comes from a
// trusted outlet) or null — never Tier 1, and therefore never the 80-100 band
// in Stage 5. `TIER1_NOT_INGESTED` records that explicitly so the ceiling is a
// declared limitation rather than a silent scoring bias.

import type { EventType, RawSignal, SignalSource, Tier } from './types';

/** Tier-1 sources per event type, expressed as SignalSources we actually ingest. */
export const TIER1_SOURCES: Record<EventType, SignalSource[]> = {
  // ACLED (conflict events), U.S. State Dept advisories, UN OCHA via ReliefWeb,
  // FCDO + UN News via the RSS adapter.
  security: ['ACLED', 'STATE_DEPT', 'RELIEFWEB', 'RSS'],
  natural_disaster: ['USGS', 'EMSC', 'GDACS', 'EONET'],
  health: [], // WHO / disease.sh / ECDC — see TIER1_NOT_INGESTED
  economic: [], // World Bank / IMF / central banks / AlphaVantage — see below
  political_unrest: ['RELIEFWEB', 'RSS'], // UN news + government statements
};

/**
 * Tier-1 sources named in the routing spec that Stage 1 does not ingest.
 * Kept as data, not a comment, so a UI or a report can state the ceiling.
 */
export const TIER1_NOT_INGESTED: Record<EventType, string[]> = {
  security: [],
  natural_disaster: [],
  health: ['WHO', 'disease.sh', 'ECDC'],
  economic: ['World Bank', 'IMF', 'central banks', 'AlphaVantage'],
  political_unrest: [],
};

interface Outlet {
  name: string;
  domains: string[];
}

/** Tier-2 trusted media per event type. Matched against `signal.sourceDomain`. */
export const TIER2_OUTLETS: Record<EventType, Outlet[]> = {
  security: [
    { name: 'Reuters', domains: ['reuters.com'] },
    { name: 'AP', domains: ['apnews.com', 'ap.org'] },
    { name: 'BBC', domains: ['bbc.com', 'bbc.co.uk'] },
  ],
  natural_disaster: [
    // Spec: "humanitarian impact only". We cannot verify that from a domain, so
    // these corroborate the EVENT; Stage 5 must not treat them as severity data.
    { name: 'Reuters', domains: ['reuters.com'] },
    { name: 'AP', domains: ['apnews.com', 'ap.org'] },
  ],
  health: [
    { name: 'Reuters Health', domains: ['reuters.com'] },
    { name: 'AP Health', domains: ['apnews.com', 'ap.org'] },
  ],
  economic: [
    { name: 'Bloomberg', domains: ['bloomberg.com'] },
    { name: 'Reuters Business', domains: ['reuters.com'] },
  ],
  political_unrest: [
    { name: 'Reuters', domains: ['reuters.com'] },
    { name: 'AP', domains: ['apnews.com', 'ap.org'] },
    { name: 'BBC', domains: ['bbc.com', 'bbc.co.uk'] },
  ],
};

export type RoutingReason =
  | 'tier1_source'
  | 'tier2_outlet'
  | 'untrusted_outlet'
  | 'no_domain'
  | 'unclassified';

export interface RoutingDecision {
  tier: Tier;
  /** Which Tier-2 outlet matched, when tier === 2. */
  outlet: string | null;
  reason: RoutingReason;
}

/** Normalizes `www.reuters.com` / `uk.reuters.com` → matches on `reuters.com`. */
function domainMatches(domain: string, candidates: string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return candidates.some((c) => d === c || d.endsWith(`.${c}`));
}

/**
 * Pure. Given a classified signal, decide its tier. Signals whose eventType is
 * still null were never classified and cannot be routed.
 */
export function routeSignal(signal: RawSignal): RoutingDecision {
  if (signal.eventType === null) {
    return { tier: null, outlet: null, reason: 'unclassified' };
  }

  if (TIER1_SOURCES[signal.eventType].includes(signal.source)) {
    return { tier: 1, outlet: null, reason: 'tier1_source' };
  }

  // Only GDELT carries a publisher domain; everything else is a named source
  // that already failed the Tier-1 test above.
  if (!signal.sourceDomain) {
    return { tier: null, outlet: null, reason: 'no_domain' };
  }

  for (const outlet of TIER2_OUTLETS[signal.eventType]) {
    if (domainMatches(signal.sourceDomain, outlet.domains)) {
      return { tier: 2, outlet: outlet.name, reason: 'tier2_outlet' };
    }
  }

  return { tier: null, outlet: null, reason: 'untrusted_outlet' };
}

export interface RoutingResult {
  routed: RawSignal[];
  /** Per-signal decision, keyed by signal id — the audit trail Stage 5 cites. */
  decisions: Map<string, RoutingDecision>;
  stats: {
    tier1: number;
    tier2: number;
    untiered: number;
    byReason: Record<RoutingReason, number>;
    /** Event types whose Tier-1 sources are not ingested at all. */
    tier1Unreachable: EventType[];
  };
}

/** Stamps `tier` onto every signal. Deterministic, total, no I/O. */
export function applyRouting(signals: RawSignal[]): RoutingResult {
  const decisions = new Map<string, RoutingDecision>();
  const byReason: Record<RoutingReason, number> = {
    tier1_source: 0, tier2_outlet: 0, untrusted_outlet: 0, no_domain: 0, unclassified: 0,
  };

  const routed = signals.map((s) => {
    const decision = routeSignal(s);
    decisions.set(s.id, decision);
    byReason[decision.reason]++;
    return { ...s, tier: decision.tier };
  });

  const tier1Unreachable = (Object.keys(TIER1_NOT_INGESTED) as EventType[])
    .filter((t) => TIER1_SOURCES[t].length === 0);

  return {
    routed,
    decisions,
    stats: {
      tier1: routed.filter((s) => s.tier === 1).length,
      tier2: routed.filter((s) => s.tier === 2).length,
      untiered: routed.filter((s) => s.tier === null).length,
      byReason,
      tier1Unreachable,
    },
  };
}
