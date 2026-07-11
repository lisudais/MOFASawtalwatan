// End-to-end probe for Stages 1-5 of the Global Alert Feed.
//
//   npm run feed:e2e
//   FEED_PROBE_ORIGIN=http://localhost:5175 MAX_SIGNALS=120 npm run feed:e2e
//
// Unlike the other probes, this one does NOT re-implement anything: it loads the
// real src/services/feed/*.ts modules through Vite's SSR loader, so the scores
// printed here are produced by score.ts itself. If the formula changes, this
// output changes with it.
//
// Two shims are needed to run browser-targeted code under Node:
//   • the adapters fetch('/api/…'), which has no origin outside a browser
//   • nothing else — llm.ts talks to Ollama over an absolute URL already

import { createServer } from 'vite';

const ORIGIN = process.env.FEED_PROBE_ORIGIN ?? 'http://localhost:5173';
const MAX_SIGNALS = Number(process.env.MAX_SIGNALS ?? 120);
const INCLUDE_GDELT = process.env.INCLUDE_GDELT !== 'false';
const SUMMARY_LIMIT = Number(process.env.SUMMARY_LIMIT ?? 8);
const SUMMARIZE = process.env.SUMMARIZE !== 'false';

// Rewrite root-relative API calls onto the running dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('/api/')) return realFetch(`${ORIGIN}${input}`, init);
  return realFetch(input, init);
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { runPipeline } = await server.ssrLoadModule('/src/services/feed/pipeline.ts');

console.log(`\nGlobal Alert Feed — end-to-end (Stages 1-5)`);
console.log(`origin=${ORIGIN} maxSignals=${MAX_SIGNALS} includeGdelt=${INCLUDE_GDELT}\n`);

const t0 = Date.now();
const r = await runPipeline({ includeGdelt: INCLUDE_GDELT, maxSignals: MAX_SIGNALS, summaryLimit: SUMMARY_LIMIT, summarize: SUMMARIZE });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

/* ── Stage 1 ── */
console.log('STAGE 1 — detection');
for (const [name, s] of Object.entries(r.ingest.sourceStatus)) {
  const mark = s.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${name.padEnd(20)} n=${String(s.count).padStart(4)}  ${s.error ?? ''}`);
}
console.log(`  degraded=${r.ingest.degraded}  total=${r.ingest.signals.length}  (into Stage 2: ${Math.min(MAX_SIGNALS, r.ingest.signals.length)})`);

/* ── Stage 2 ── */
const c = r.classify.stats;
console.log('\nSTAGE 2 — classification (think:low, grammar-constrained)');
console.log(`  structured (no LLM): ${c.alreadyStructured}   classified: ${c.classified}   dropped (not a risk signal): ${c.dropped}`);
console.log(`  unmatched country: ${c.unmatched}   model-code rejected by our table: ${c.countryRejected}   low-confidence: ${c.lowConfidence}`);
console.log(`  2b country pass: ${c.countryPassResolved}/${c.countryPassAttempted} resolved`);
if (r.classify.failed.length) console.log(`  FAILED batches: ${r.classify.failed.length} — ${r.classify.failed[0].error.slice(0, 90)}`);

/* ── Stage 3 ── */
const g = r.routing.stats;
console.log('\nSTAGE 3 — routing (no AI)');
console.log(`  tier1=${g.tier1}  tier2=${g.tier2}  untiered=${g.untiered}`);
console.log(`  reasons: ${JSON.stringify(g.byReason)}`);
if (g.tier1Unreachable.length) console.log(`  NO TIER-1 SOURCE INGESTED for: ${g.tier1Unreachable.join(', ')}`);

/* ── Stage 4 ── */
const k = r.corroborate.stats;
console.log('\nSTAGE 4 — corroboration (Phase A no AI; Phase B think:medium)');
console.log(`  groups=${k.groups}  ungroupable(no country)=${k.ungroupable}`);
console.log(`  candidate pairs=${k.candidatePairs}  evaluated=${k.pairsEvaluated}  confirmed=${k.pairsConfirmed}  dropped by cap=${k.pairsDroppedByCap}  groups truncated=${k.groupsTruncated}`);
console.log(`  clusters=${k.clusters}  corroborated=${k.corroboratedClusters}`);
if (r.corroborate.failed.length) console.log(`  FAILED pairs: ${r.corroborate.failed.length} (treated as NOT same event)`);

/* ── Stage 5 ── */
const s5 = r.score.stats;
console.log('\nSTAGE 5 — scoring (deterministic, no AI)');
console.log(`  bands: ${JSON.stringify(s5.byBand)}`);
console.log(`  capped=${s5.capped}  ceiling-limited=${s5.ceilingLimited}  maxScore=${s5.maxScore}`);

console.log('\nTOP 12 SCORED CLUSTERS');
console.log('  score  type              cty  srcs                     tags');
for (const sc of r.score.scored.slice(0, 12)) {
  const b = sc.breakdown;
  console.log(
    `  ${String(sc.score).padStart(5)}  ${sc.cluster.eventType.padEnd(17)} ${String(sc.cluster.country ?? '—').padEnd(4)} ` +
    `${sc.cluster.distinctSources.join(',').padEnd(24)} ${b.tags.join('+')}`
  );
}

/* ── "why is this score X" ── */
const top = r.score.scored[0];
if (top) {
  const b = top.breakdown;
  console.log(`\nWHY IS "${top.cluster.eventType}/${top.cluster.country}" SCORED ${top.score}?`);
  console.log(`  band          ${b.band}  [${b.bandRange.lo}-${b.bandRange.hi}]`);
  console.log(`  rule          ${b.bandReason}`);
  console.log(`  severity      factor=${b.severityFactor ?? 'unknown (band midpoint used)'}`);
  console.log(`  base score    ${b.baseScore}`);
  console.log(`  bonus         +${b.corroborationBonus}${b.bonusReason ? ` (${b.bonusReason})` : ''}`);
  if (b.capApplied) console.log(`  cap           ${b.capApplied.cap} — ${b.capApplied.reason}`);
  if (b.ceilingNote) console.log(`  ceiling       ${b.ceilingNote}`);
  console.log(`  contributors  ${b.contributions.map((x) => `${x.source}(tier=${x.tier}${x.official ? ',official' : ''}${x.severityHint ? `,${x.severityHint}` : ''})`).join(' ')}`);
}

/* ── Stage 6 ── */
const s6 = r.summarize.stats;
console.log('\nSTAGE 6 — summaries (think:low, grammar-constrained + deterministically verified)');
console.log(`  ai attempted=${s6.aiAttempted}  accepted=${s6.aiAccepted}  templated=${s6.templated}`);
console.log(`  REJECTED: evidence not in source=${s6.rejectedEvidence}   introduced a new number=${s6.rejectedNumber}`);

console.log('\nTOP CARD SUMMARIES');
for (const sc of r.score.scored.slice(0, SUMMARY_LIMIT)) {
  const su = r.summarize.summaries.get(sc.cluster.id);
  if (!su) continue;
  const tag = su.aiGenerated ? 'AI' : `TPL${su.rejectedReason ? `(${su.rejectedReason})` : ''}`;
  console.log(`  [${String(sc.score).padStart(3)}] ${tag.padEnd(30)} ${su.summary}`);
}

console.log(`\ncompleted in ${secs}s\n`);
await server.close();
process.exit(0);
