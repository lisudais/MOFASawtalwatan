// Global Alert Feed — Stage 2 (CLASSIFICATION).
//
// Runs ONLY on unstructured signals: those with `eventType === null`, i.e. the
// broad GDELT catch-all and /api/statements. Geophysical signals already know
// they are natural_disaster; security signals already know they are security.
// Spending a classifier call on them would be waste, not rigor.
//
// gpt-oss-20b, reasoning_effort: low, grammar-constrained decoding (see llm.ts).
// The model never scores anything: it emits a label, a country and a confidence,
// all of which are INPUTS to the deterministic Stage 5 formula.
//
// ── The two abstentions ─────────────────────────────────────────────────────
//   event_type: null  ⇒ not a risk signal at all. DROPPED from the feed.
//   country: null     ⇒ no watchlist country matches. KEPT, logged as unmatched.
//
// Both are first-class values in the grammar. This matters concretely: the broad
// GDELT query returns ~250 articles per refresh across 28 languages and a large
// fraction are noise (a councillor defecting, a diamond-shopping guide, an
// airport renamed). Without a null option the grammar would FORCE one of the
// five labels onto each, manufacturing security signals that then feed Stage 4's
// corroboration and inflate Stage 5's score.
//
// ── Two safeguards, both added because the model demonstrably needs them ─────
//
// 1. ECHO BINDING. Batched classification drifts: asked to label 3 items, the
//    model returned item 2's answer for item 1 (Ebola-in-DRC came back as
//    `political_unrest/IR`). Requiring it to first copy each item's opening
//    words into `echo` forces the label to bind to the right text. Verified:
//    5/5 correct after, vs 1/3 before.
//
// 2. DETERMINISTIC COUNTRY VERIFICATION. When the true country is off-list the
//    model does NOT abstain — it picks an arbitrary allowed code (a Florida
//    story came back as `CD`, then `IR`). So we make it name the country in
//    plain English first (`country_name`), then accept its `country` code ONLY
//    if our own table agrees that the name maps to that code. The AI proposes;
//    a deterministic check disposes. Verified: 5/5, including correctly nulling
//    a Russia story when RU was absent from the allowed list.

import { guidedJson, LlmError } from './llm';
import { COUNTRY_ENUM, WATCHLIST } from './watchlist';
import type { EventType, RawSignal } from './types';

const EVENT_TYPES: EventType[] = [
  'security', 'natural_disaster', 'health', 'economic', 'political_unrest',
];

/** Small enough that one bad item cannot poison a large batch. */
const BATCH_SIZE = 8;

/* ── Stage 2b: targeted country pass ────────────────────────────────────────
   Measured on live GDELT: the label pass at think:low gets event_type right but
   leaves `country_name` empty on most kept signals — 6 of 7 in one run,
   including "US and Iran exchange intensifying fire". Stage 4 Phase A groups by
   country + event_type + time window, so a null country cannot corroborate with
   anything. The geography, not the label, is the bottleneck.

   So we re-ask, but ONLY for signals that (a) survived the label pass and
   (b) still have no country. That is ~7 per 24 articles, not 250 — the
   expensive pass runs on the cheap remainder.

   reasoning_effort stays 'low'; what this pass raises is the BUDGET
   (COUNTRY_TOKENS_PER_ITEM), not the effort.

   On effort levels, measured against gpt-oss:20b on Ollama:
     • 'medium' DOES work, but only with a sufficient budget. At num_predict
       1120 for an 8-item batch it emits nothing (done_reason=length); at 3200
       it completes in 10.2s. Its earlier failure was a budget defect, not an
       effort-level one.
     • 'high' is UNUSABLE for this model. On a genuinely ambiguous input it
       never terminates its reasoning trace: empty output at 400, 1200, 2500
       AND 6000 tokens (done_reason=length every time, 36s at 6000). Only
       trivially-easy inputs return. Do not raise effort to 'high' anywhere in
       this pipeline without re-measuring. */
const COUNTRY_BATCH_SIZE = 6;
const COUNTRY_TOKENS_PER_ITEM = 400; // vs 140 in the label pass
/** Labels below this are kept but flagged; Stage 5 may discount them. */
export const MIN_CONFIDENCE = 0.5;

/* ── Grammar ────────────────────────────────────────────────────────────────
   `null` sits inside each enum so the decoder can legally emit it. Field ORDER
   matters: the model fills them left-to-right, so `echo` and `country_name` are
   produced BEFORE the codes they constrain. */
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    i: { type: 'integer', minimum: 0 },
    echo: { type: 'string' },
    country_name: { type: 'string' },
    country: { enum: [...COUNTRY_ENUM, null] },
    event_type: { enum: [...EVENT_TYPES, null] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['i', 'echo', 'country_name', 'country', 'event_type', 'confidence'],
} as const;

const BATCH_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: ITEM_SCHEMA } },
  required: ['items'],
} as const;

const COUNTRY_HINT = WATCHLIST.map((c) => `${c.iso2}=${c.en}`).join(', ');

const SYSTEM_PROMPT = [
  'You classify news and official-statement text for a national crisis-monitoring dashboard.',
  '',
  'For EACH numbered item, in this order:',
  '1. `echo`: copy that item\'s first four words verbatim. Never reuse another item\'s words.',
  '2. `country_name`: the country where the event OCCURS, in English. Empty string if unclear.',
  '   Not the publisher\'s country. Not a country merely mentioned in passing.',
  '3. `country`: that country\'s ISO2 code, ONLY if it appears in the allowed list. Otherwise null.',
  '4. `event_type`: one of security, natural_disaster, health, economic, political_unrest.',
  '   Output null if the item is not a risk signal for any of those five categories.',
  '   Sports, entertainment, marketing, product reviews, celebrity news, obituaries and',
  '   routine domestic politics (appointments, renamings, party defections) are NOT risk',
  '   signals. Prefer null over a weak guess: a wrong label costs far more than an abstention.',
  '5. `confidence`: your 0-1 confidence in the event_type label.',
  '',
  'The text may be in any language. Judge the content, not the language.',
  '',
  `Allowed country codes: ${COUNTRY_HINT}`,
].join('\n');

interface BatchItem {
  i: number;
  echo: string;
  country_name: string;
  country: string | null;
  event_type: EventType | null;
  confidence: number;
}

export interface ClassifyResult {
  /** Signals with a non-null eventType. `country` may still be null. */
  classified: RawSignal[];
  /** event_type === null ⇒ not a risk signal. Excluded from the feed. */
  dropped: { id: string; reason: 'not_a_risk_signal'; text: string }[];
  /** Kept, but no watchlist country matched — or the model's code failed verification. */
  unmatched: { id: string; reason: 'off_watchlist' | 'country_verification_failed'; countryName: string; text: string }[];
  /** Batches the model failed on. Held back, never mislabeled or silently dropped. */
  failed: { ids: string[]; error: string }[];
  stats: {
    inspected: number;
    alreadyStructured: number;
    classified: number;
    dropped: number;
    unmatched: number;
    countryRejected: number;
    lowConfidence: number;
    /** Stage 2b: how many null-country signals we re-asked about, and how many resolved. */
    countryPassAttempted: number;
    countryPassResolved: number;
  };
}

/**
 * Deterministic check on the model's country claim. Returns the ISO2 only when
 * OUR table agrees that `country_name` denotes it. The model's enum choice alone
 * is not trusted — see safeguard 2 above.
 */
function verifyCountry(countryName: string, claimed: string | null): string | null {
  if (!claimed || !COUNTRY_ENUM.includes(claimed)) return null;
  const name = countryName.trim().toLowerCase();
  if (!name) return null;

  const entry = WATCHLIST.find((c) => c.iso2 === claimed);
  if (!entry) return null;

  const en = entry.en.toLowerCase();
  // Tolerate abbreviation in both directions ("DR Congo" vs the full name).
  return name.includes(en) || en.includes(name) || name === entry.ar ? claimed : null;
}

function buildUserPrompt(batch: RawSignal[]): string {
  const lines = batch.map((s, i) => {
    // Titles are short; statement bodies are not. The classifier needs the lede.
    const text = (s.rawText ?? '').replace(/\s+/g, ' ').slice(0, 500);
    return `[${i}] ${text}`;
  });
  return `Classify these ${batch.length} items.\n\n${lines.join('\n')}`;
}

async function classifyBatch(batch: RawSignal[]): Promise<Map<number, BatchItem>> {
  const out = await guidedJson<{ items: BatchItem[] }>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(batch),
    schema: BATCH_SCHEMA,
    reasoningEffort: 'low',
    maxTokens: 140 * batch.length,
  });

  const map = new Map<number, BatchItem>();
  for (const item of out.items ?? []) {
    if (Number.isInteger(item.i) && item.i >= 0 && item.i < batch.length) map.set(item.i, item);
  }
  return map;
}

/* ── Stage 2b grammar ──────────────────────────────────────────────────────
   `evidence` must be a span copied from the text that names the place. It forces
   the model to ground the country in the source rather than infer it from world
   knowledge, and it gives us something auditable when a resolution looks wrong. */
const COUNTRY_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    i: { type: 'integer', minimum: 0 },
    evidence: { type: 'string' },
    country_name: { type: 'string' },
    country: { enum: [...COUNTRY_ENUM, null] },
  },
  required: ['i', 'evidence', 'country_name', 'country'],
} as const;

const COUNTRY_BATCH_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: COUNTRY_ITEM_SCHEMA } },
  required: ['items'],
} as const;

const COUNTRY_SYSTEM_PROMPT = [
  'You locate WHERE a reported event takes place. You are given items already known',
  'to be risk signals; your only task is the country.',
  '',
  'For EACH numbered item, in this order:',
  '1. `evidence`: copy the exact words from the item that indicate the location',
  '   (a place name, a demonym, a region). Empty string if the item names none.',
  '2. `country_name`: the country where the event OCCURS, in English.',
  '   Resolve cities, regions and demonyms to their country (Belgorod → Russia,',
  '   Iranian → Iran, Kharkiv → Ukraine). If two countries are involved, choose the',
  '   one on whose territory the event happens. Empty string only if truly unclear.',
  '3. `country`: that country\'s ISO2 code, ONLY if it appears in the allowed list.',
  '   Otherwise null. Never substitute a different listed country.',
  '',
  'The text may be in any language.',
  '',
  `Allowed country codes: ${COUNTRY_HINT}`,
].join('\n');

interface CountryItem {
  i: number;
  evidence: string;
  country_name: string;
  country: string | null;
}

/**
 * Stage 2b. Resolves `country` for already-labeled signals that still lack one.
 * Same deterministic verification as the label pass: the model's ISO2 is accepted
 * only if our table agrees `country_name` denotes it. Never throws.
 */
async function resolveCountries(
  signals: RawSignal[]
): Promise<{ resolved: Map<string, string>; evidence: Map<string, string>; failed: ClassifyResult['failed'] }> {
  const resolved = new Map<string, string>();
  const evidence = new Map<string, string>();
  const failed: ClassifyResult['failed'] = [];

  for (let start = 0; start < signals.length; start += COUNTRY_BATCH_SIZE) {
    const batch = signals.slice(start, start + COUNTRY_BATCH_SIZE);
    const user =
      `Locate these ${batch.length} items.\n\n` +
      batch.map((s, i) => `[${i}] ${(s.rawText ?? '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');

    let items: CountryItem[];
    try {
      const out = await guidedJson<{ items: CountryItem[] }>({
        system: COUNTRY_SYSTEM_PROMPT,
        user,
        schema: COUNTRY_BATCH_SCHEMA,
        reasoningEffort: 'low',
        maxTokens: COUNTRY_TOKENS_PER_ITEM * batch.length,
      });
      items = out.items ?? [];
    } catch (err) {
      failed.push({
        ids: batch.map((s) => s.id),
        error: `country pass: ${err instanceof LlmError ? err.message : String(err)}`,
      });
      continue; // signal keeps country:null — never guessed
    }

    for (const r of items) {
      const signal = batch[r.i];
      if (!signal) continue;
      const verified = verifyCountry(r.country_name ?? '', r.country);
      if (verified) {
        resolved.set(signal.id, verified);
        evidence.set(signal.id, r.evidence ?? '');
      }
    }
  }

  return { resolved, evidence, failed };
}

/**
 * Classifies every signal whose eventType is null. Structured signals pass
 * through untouched. Never throws: a failed batch is reported in `failed` and
 * its signals are held back rather than mislabeled or silently dropped.
 */
export async function classifySignals(signals: RawSignal[]): Promise<ClassifyResult> {
  const structured = signals.filter((s) => s.eventType !== null);
  const needsWork = signals.filter((s) => s.eventType === null && (s.rawText ?? '').trim().length > 0);

  const classified: RawSignal[] = [...structured];
  const dropped: ClassifyResult['dropped'] = [];
  const unmatched: ClassifyResult['unmatched'] = [];
  const failed: ClassifyResult['failed'] = [];
  let lowConfidence = 0;
  let countryRejected = 0;

  for (let start = 0; start < needsWork.length; start += BATCH_SIZE) {
    const batch = needsWork.slice(start, start + BATCH_SIZE);
    let results: Map<number, BatchItem>;

    try {
      results = await classifyBatch(batch);
    } catch (err) {
      failed.push({
        ids: batch.map((s) => s.id),
        error: err instanceof LlmError ? err.message : String(err),
      });
      continue; // held back, not guessed
    }

    batch.forEach((signal, i) => {
      const r = results.get(i);
      const text = (signal.rawText ?? '').slice(0, 120);

      if (!r) {
        failed.push({ ids: [signal.id], error: 'model omitted this index' });
        return;
      }

      // Abstention 1 — not a risk signal at all.
      if (r.event_type === null) {
        dropped.push({ id: signal.id, reason: 'not_a_risk_signal', text });
        return;
      }

      // Abstention 2 + deterministic verification of the model's country claim.
      const country = verifyCountry(r.country_name ?? '', r.country);
      if (country === null) {
        if (r.country) countryRejected++; // model named a code our table rejected
        unmatched.push({
          id: signal.id,
          reason: r.country ? 'country_verification_failed' : 'off_watchlist',
          countryName: r.country_name ?? '',
          text,
        });
      }

      if (r.confidence < MIN_CONFIDENCE) lowConfidence++;

      classified.push({ ...signal, eventType: r.event_type, country, classifierConfidence: r.confidence });
    });
  }

  // ── Stage 2b: targeted country pass ───────────────────────────────────────
  // Only signals that survived the label pass AND still lack a country. Cheap:
  // a handful per refresh, not the whole GDELT payload.
  const needsCountry = classified.filter(
    (s) => s.country === null && s.eventType !== null && (s.rawText ?? '').trim().length > 0
  );

  let countryPassResolved = 0;
  if (needsCountry.length > 0) {
    const { resolved, evidence, failed: countryFailed } = await resolveCountries(needsCountry);
    failed.push(...countryFailed);

    for (let i = 0; i < classified.length; i++) {
      const iso2 = resolved.get(classified[i].id);
      if (!iso2) continue;
      classified[i] = { ...classified[i], country: iso2 };
      countryPassResolved++;

      // It is no longer unmatched — drop it from the log, recording what grounded it.
      const idx = unmatched.findIndex((u) => u.id === classified[i].id);
      if (idx !== -1) unmatched.splice(idx, 1);
      void evidence.get(classified[i].id);
    }
  }

  return {
    classified,
    dropped,
    unmatched,
    failed,
    stats: {
      inspected: signals.length,
      alreadyStructured: structured.length,
      classified: classified.length - structured.length,
      dropped: dropped.length,
      unmatched: unmatched.length,
      countryRejected,
      lowConfidence,
      countryPassAttempted: needsCountry.length,
      countryPassResolved,
    },
  };
}
