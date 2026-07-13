// Global Alert Feed pipeline — Stage 1 (DETECTION) types.
//
// A RawSignal is deliberately NOT a GeoEvent. GeoEvent carries `score`,
// `riskLevel` and `recommendedAction`, which would force us to invent a risk
// score during ingestion. Scoring is Stage 5 and must stay the only place a
// number is produced. Stage 1 only normalizes shape and records provenance.
//
// Scope: this module powers the Global Alert Feed only. It never mutates the
// Security / Health / Economy / Statements sections, which keep their own
// services untouched.

/** Every upstream the feed can ingest from. Distinct from GeoEvent['source']. */
export type SignalSource =
  | 'USGS' | 'EMSC' | 'EONET' | 'GDACS'   // geophysical (structured)
  | 'STATE_DEPT' | 'ACLED'                // security (structured, via /api/security)
  | 'RELIEFWEB' | 'RSS'                   // statements (semi-structured, via /api/statements)
  | 'GDELT';                              // broad catch-all (unstructured)

/** Stage 2 classification target. Constrained enum — the model may not invent values. */
export type EventType =
  | 'security'
  | 'natural_disaster'
  | 'health'
  | 'economic'
  | 'political_unrest';

/** Stage 3 routing tier. null until the signal has an eventType. */
export type Tier = 1 | 2 | null;

export interface SignalProvenance {
  /** The exact URL or proxy route this signal came through. */
  fetchedFrom: string;
  /** Real HTTP status. `ok` is derived from THIS, never from Promise settlement. */
  httpStatus: number;
  ok: boolean;
}

export interface RawSignal {
  /** Stable identity: `${source}:${sourceKey}`. Exact-match dedup only (Stage 1). */
  id: string;
  source: SignalSource;
  tier: Tier;

  /** When we ingested it. */
  ingestedAt: string;
  /** When the source says it happened / was published. */
  occurredAt: string;

  /**
   * Title + body, for Stage 2 classification and Stage 6 summarization.
   * null when the source is already fully structured (e.g. a USGS quake).
   */
  rawText: string | null;

  /** ISO 3166-1 alpha-2 of the SUBJECT country — only when the source states it. */
  country: string | null;
  /**
   * ISO2 of the body that PUBLISHED the signal. For /api/statements this is what
   * the API calls `countryCode` (e.g. 'GB' for an FCDO notice about Timor-Leste).
   * It is not the subject and must never be merged as one.
   */
  authorityCountry: string | null;

  /** null ⇒ needs Stage 2 classification. */
  eventType: EventType | null;

  /** null when the source gives no coordinates. We never fabricate a centroid. */
  coords: { lat: number; lng: number } | null;

  /**
   * Free-text place description straight from the source (e.g. USGS's
   * "12km SW of Banda Aceh, Indonesia", GDACS's title/region text) — for
   * DISPLAY location resolution only (services/feed's location resolver /
   * netlify/lib/locationCore.mjs). Distinct from `rawText` on purpose: it is
   * NEVER read by Stage 2 classification or Stage 6 summarization, so adding
   * it cannot change what those AI stages see. null when the source gives no
   * such text (e.g. /api/security, whose `rawText` already IS the place-ish
   * title and doubles as the location source instead).
   */
  placeText: string | null;

  /**
   * The original GeoEvent['type'] for geophysical signals (EARTHQUAKE, FLOOD,
   * STORM, VOLCANO, WILDFIRE, DROUGHT…). Kept so the feed card can render the
   * SAME per-type icon it always did, instead of collapsing ten types onto the
   * five coarse `eventType` buckets. null for sources that have no such type.
   */
  geoType: string | null;

  /**
   * The source's OWN severity expression, verbatim: 'M6.8', 'Level 4',
   * 'CRITICAL', 'Orange'. Intentionally a string — these are not commensurable.
   * Stage 5 normalizes them per-source in an auditable table. Never a score.
   */
  severityHint: string | null;

  url: string | null;
  /**
   * Publisher domain, when the source gives one (GDELT does). Stage 3 needs it
   * to decide whether an article came from a Tier-2 trusted outlet or from an
   * unvetted one. null for structured sources, whose tier follows from `source`.
   */
  sourceDomain: string | null;
  provenance: SignalProvenance;

  /**
   * Set by Stage 2 for signals that needed classification. The model's own
   * confidence in the eventType label — an INPUT to Stage 5's formula, never a
   * risk score. Absent on signals that arrived already structured.
   */
  classifierConfidence?: number;
}

/** Per-source health, derived from HTTP status — not from Promise.allSettled. */
export interface SourceStatus {
  ok: boolean;
  httpStatus: number | null;
  count: number;
  /** Present when the adapter failed or degraded. */
  error?: string;
  /** false when the source needs credentials that aren't configured. */
  configured?: boolean;
}

export interface IngestResult {
  signals: RawSignal[];
  sourceStatus: Record<string, SourceStatus>;
  /** true when at least one source failed. Surfaced to the UI, never swallowed. */
  degraded: boolean;
  ingestedAt: string;
}

/** Adapter contract: never throws, always reports its own status. */
export interface AdapterResult {
  signals: RawSignal[];
  status: SourceStatus;
  /** Which SignalSource keys this adapter reports on (may be >1, e.g. statements). */
  sourceKeys: SignalSource[];
}
