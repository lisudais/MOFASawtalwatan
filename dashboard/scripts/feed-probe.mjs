// Stage 1 verification probe for the Global Alert Feed.
//
//   npm run feed:probe            (expects `npm run dev` on :5173)
//   FEED_PROBE_ORIGIN=http://localhost:5174 npm run feed:probe
//
// Answers the only question Stage 1 needs to answer before Stages 2-6 are built:
// what does each source ACTUALLY yield right now, and which are lying about it?
//
// It exercises the real endpoints rather than importing the TS adapters, because
// this repo has no tsx/vite-node and Node cannot resolve the adapters' extension-
// less imports. Consequence: the four geophysical upstream URLs are restated
// below. They must stay in sync with src/services/{usgs,gdacs,disasters}.ts —
// the adapters themselves call those modules, not these constants.

const ORIGIN = process.env.FEED_PROBE_ORIGIN ?? 'http://localhost:5173';
// Long enough to outlast the GDELT proxy's worst-case retry chain
// (4 attempts × ~13s connect + 5/10/20s backoff). Its own timeouts bound it.
const TIMEOUT = 120000;

const GEOPHYSICAL = [
  ['USGS',  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', (d) => d.features?.length],
  ['EONET', 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30',             (d) => d.events?.length],
  ['EMSC',  'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20&minmag=4.5', (d) => d.features?.length],
  ['GDACS', 'https://api.allorigins.win/raw?url=https://www.gdacs.org/xml/rss.xml',       null], // XML
];

async function get(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, body: '', ms: Date.now() - started, error: String(err) };
  }
}

function row(name, ok, status, count, note) {
  const mark = ok ? 'ok  ' : 'FAIL';
  const st = String(status ?? '-').padEnd(4);
  const n = String(count ?? '-').padStart(5);
  console.log(`  ${mark} ${name.padEnd(22)} http=${st} n=${n}  ${note ?? ''}`);
}

console.log(`\nGlobal Alert Feed — Stage 1 probe`);
console.log(`origin: ${ORIGIN}\n`);

/* ── Geophysical: fetched directly by the browser today ─────────────────── */
console.log('GEOPHYSICAL (direct browser fetch)');
for (const [name, url, counter] of GEOPHYSICAL) {
  const r = await get(url);
  let count = null;
  let note = r.error ?? '';
  if (r.ok && counter) {
    try { count = counter(JSON.parse(r.body)); } catch { note = 'non-JSON body'; }
  } else if (r.ok) {
    count = (r.body.match(/<item>/gi) ?? []).length; // GDACS RSS
  }
  if (r.ok && count === 0) note ||= 'reachable but 0 rows';
  row(name, r.ok && count > 0, r.status, count, note);
}

/* ── Our proxies: the three feeds Stage 1 merges in ─────────────────────── */
console.log('\nPROXIES (what Stage 1 ingests)');

const sec = await get(`${ORIGIN}/api/security`);
if (!sec.ok) {
  row('SECURITY', false, sec.status, 0, sec.error ?? 'proxy failed');
} else {
  const d = JSON.parse(sec.body);
  const profiles = d.profiles ?? [];
  const threats = profiles.reduce((n, p) => n + (p.currentThreats?.length ?? 0), 0);
  const timeline = profiles.reduce((n, p) => n + (p.timeline?.length ?? 0), 0);
  row('SECURITY', threats + timeline > 0, sec.status, threats + timeline,
    `${profiles.length} profiles → ${threats} threats + ${timeline} timeline (overall/level discarded)`);
  for (const [k, v] of Object.entries(d.sources ?? {})) {
    const suspect = v.ok === true && (v.count ?? 0) === 0 ? '  ← ok:true but 0 rows' : '';
    row(`  ↳ ${k}`, v.ok === true && (v.count ?? 0) > 0, '-', v.count ?? 0,
      `${v.configured === false ? 'NOT CONFIGURED' : `ok=${v.ok}`}${suspect}`);
  }
}

const st = await get(`${ORIGIN}/api/statements`);
if (!st.ok) {
  row('STATEMENTS', false, st.status, 0, st.error ?? 'proxy failed');
} else {
  const d = JSON.parse(st.body);
  const list = d.statements ?? [];
  const authorities = {};
  for (const s of list) authorities[s.countryCode || '(none)'] = (authorities[s.countryCode || '(none)'] ?? 0) + 1;
  row('STATEMENTS', list.length > 0, st.status, list.length,
    `degraded=${d.degraded} · subject_country=null for all · authority=${JSON.stringify(authorities)}`);
  for (const [k, v] of Object.entries(d.sources ?? {})) {
    const suspect = v.ok === true && (v.count ?? 0) === 0 ? '  ← ok:true but 0 rows' : '';
    row(`  ↳ ${k}`, v.ok === true && (v.count ?? 0) > 0, '-', v.count ?? 0, `ok=${v.ok}${suspect}`);
  }
}

const gd = await get(`${ORIGIN}/api/gdelt-feed`);
if (!gd.ok) {
  row('GDELT (broad)', false, gd.status, 0, gd.error ?? 'proxy failed');
} else {
  const d = JSON.parse(gd.body);
  row('GDELT (broad)', d.ok === true, gd.status, d.articles?.length ?? 0,
    d.ok === true ? `timespan=${d.timespan} cached=${d.cached}` : (d.error ?? 'upstream ok:false'));
  if (d.ok && d.articles?.length) {
    console.log(`       sample: ${d.articles[0].title.slice(0, 70)}…`);
  }
}

console.log('\nStage 2 input (unstructured, needs classification):');
console.log('  statements.rawText + gdelt.rawText → eventType=null, country=null');
console.log('Stage 2 is NOT needed for: USGS/EMSC/EONET/GDACS (natural_disaster) or security (security).\n');
