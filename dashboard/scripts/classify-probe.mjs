// Stage 2 verification probe: real GDELT articles → gpt-oss-20b → labels.
//
//   npm run feed:classify                          (expects dev server on :5173)
//   FEED_PROBE_ORIGIN=http://localhost:5175 npm run feed:classify
//
// Mirrors src/services/feed/classify.ts exactly: same schema, same prompt shape,
// same echo-binding and deterministic country verification. It exists because
// Node cannot import the TS module (no tsx/vite-node in this repo).

const ORIGIN = process.env.FEED_PROBE_ORIGIN ?? 'http://localhost:5173';
const OLLAMA = process.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.VITE_LLM_MODEL ?? 'gpt-oss:20b';
const LIMIT = Number(process.env.CLASSIFY_LIMIT ?? 24);
const BATCH = 8;

const WATCHLIST = [
  ['YE','Yemen'],['SY','Syria'],['IQ','Iraq'],['IR','Iran'],['LB','Lebanon'],['JO','Jordan'],
  ['KW','Kuwait'],['OM','Oman'],['QA','Qatar'],['BH','Bahrain'],['AE','United Arab Emirates'],
  ['EG','Egypt'],['SD','Sudan'],['SS','South Sudan'],['LY','Libya'],['TN','Tunisia'],['DZ','Algeria'],
  ['MA','Morocco'],['MR','Mauritania'],['SO','Somalia'],['DJ','Djibouti'],['TR','Turkey'],['IL','Israel'],
  ['AF','Afghanistan'],['PK','Pakistan'],['IN','India'],['BD','Bangladesh'],['NG','Nigeria'],['ML','Mali'],
  ['NE','Niger'],['BF','Burkina Faso'],['TD','Chad'],['ET','Ethiopia'],
  ['CD','Democratic Republic of the Congo'],['CF','Central African Republic'],['UA','Ukraine'],['RU','Russia'],
  ['VE','Venezuela'],['HT','Haiti'],['MM','Burma'],['KP','North Korea'],['CO','Colombia'],['MX','Mexico'],
  ['PH','Philippines'],['ID','Indonesia'],
];
const CODES = WATCHLIST.map(([c]) => c);
const EVENT_TYPES = ['security','natural_disaster','health','economic','political_unrest'];

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    i: { type: 'integer', minimum: 0 },
    echo: { type: 'string' },
    country_name: { type: 'string' },
    country: { enum: [...CODES, null] },
    event_type: { enum: [...EVENT_TYPES, null] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['i','echo','country_name','country','event_type','confidence'],
};
const SCHEMA = { type:'object', properties:{ items:{ type:'array', items: ITEM_SCHEMA } }, required:['items'] };

const SYSTEM = [
  'You classify news and official-statement text for a national crisis-monitoring dashboard.',
  '',
  'For EACH numbered item, in this order:',
  "1. `echo`: copy that item's first four words verbatim. Never reuse another item's words.",
  '2. `country_name`: the country where the event OCCURS, in English. Empty string if unclear.',
  "   Not the publisher's country. Not a country merely mentioned in passing.",
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
  `Allowed country codes: ${WATCHLIST.map(([c,n]) => `${c}=${n}`).join(', ')}`,
].join('\n');

function verifyCountry(name, claimed) {
  if (!claimed || !CODES.includes(claimed)) return null;
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return null;
  const en = (WATCHLIST.find(([c]) => c === claimed) ?? [])[1]?.toLowerCase();
  if (!en) return null;
  return n.includes(en) || en.includes(n) ? claimed : null;
}

async function classify(batch) {
  const user = `Classify these ${batch.length} items.\n\n` +
    batch.map((t, i) => `[${i}] ${t.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      model: MODEL, stream: false, format: SCHEMA, think: 'low',
      options: { temperature: 0, num_predict: 140 * batch.length },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const d = await res.json();
  if (!d?.message?.content) throw new Error(`no constrained content (done_reason=${d?.done_reason})`);
  return JSON.parse(d.message.content).items ?? [];
}

console.log(`\nStage 2 probe — ${MODEL} @ ${OLLAMA}  (think:low, schema-constrained)\n`);

const gd = await fetch(`${ORIGIN}/api/gdelt-feed`, { signal: AbortSignal.timeout(150000) });
const feed = await gd.json();
if (!feed.ok) {
  console.error(`GDELT unavailable: ${feed.error}`);
  process.exit(1);
}
const titles = feed.articles.slice(0, LIMIT).map((a) => a.title);
console.log(`classifying ${titles.length} real GDELT articles (cached=${feed.cached})\n`);

const kept = [], dropped = [], unmatched = [];
let rejected = 0, t0 = Date.now();

for (let s = 0; s < titles.length; s += BATCH) {
  const batch = titles.slice(s, s + BATCH);
  let items;
  try { items = await classify(batch); }
  catch (e) { console.log(`  batch ${s / BATCH}: FAILED — ${e.message}`); continue; }

  batch.forEach((text, i) => {
    const r = items.find((x) => x.i === i);
    if (!r) return;
    if (r.event_type === null) { dropped.push(text); return; }
    const country = verifyCountry(r.country_name, r.country);
    if (!country) { if (r.country) rejected++; unmatched.push([text, r.country_name, r.country]); }
    kept.push([r.event_type, country ?? '—', r.confidence, text]);
  });
}

/* ── Stage 2b: targeted country pass, ONLY on kept signals lacking a country ── */
const COUNTRY_SCHEMA = {
  type:'object',
  properties:{ items:{ type:'array', items:{
    type:'object',
    properties:{ i:{type:'integer',minimum:0}, evidence:{type:'string'}, country_name:{type:'string'}, country:{enum:[...CODES,null]} },
    required:['i','evidence','country_name','country'],
  }}},
  required:['items'],
};
const COUNTRY_SYSTEM = [
  'You locate WHERE a reported event takes place. You are given items already known',
  'to be risk signals; your only task is the country.',
  '',
  'For EACH numbered item, in this order:',
  '1. `evidence`: copy the exact words from the item that indicate the location',
  '   (a place name, a demonym, a region). Empty string if the item names none.',
  '2. `country_name`: the country where the event OCCURS, in English.',
  '   Resolve cities, regions and demonyms to their country (Belgorod -> Russia,',
  '   Iranian -> Iran, Kharkiv -> Ukraine). If two countries are involved, choose the',
  '   one on whose territory the event happens. Empty string only if truly unclear.',
  "3. `country`: that country's ISO2 code, ONLY if it appears in the allowed list.",
  '   Otherwise null. Never substitute a different listed country.',
  '',
  'The text may be in any language.',
  '',
  `Allowed country codes: ${WATCHLIST.map(([c,n]) => `${c}=${n}`).join(', ')}`,
].join('\n');

async function locate(batch) {
  const user = `Locate these ${batch.length} items.\n\n` +
    batch.map((t,i) => `[${i}] ${t.replace(/\s+/g,' ').slice(0,500)}`).join('\n');
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method:'POST', headers:{'Content-Type':'application/json'}, signal: AbortSignal.timeout(300000),
    body: JSON.stringify({ model: MODEL, stream:false, format: COUNTRY_SCHEMA, think:'low',
      options:{ temperature:0, num_predict: 400 * batch.length },
      messages:[{role:'system',content:COUNTRY_SYSTEM},{role:'user',content:user}] }),
  });
  if(!res.ok) throw new Error(`ollama ${res.status}`);
  const d = await res.json();
  if(!d?.message?.content) throw new Error(`no constrained content (done_reason=${d?.done_reason})`);
  return JSON.parse(d.message.content).items ?? [];
}

const nullCountry = kept.filter(([,c]) => c === '—');
console.log(`
── Stage 2b country pass: ${nullCountry.length} of ${kept.length} kept signals lack a country ──`);
let resolvedCount = 0;
const t1 = Date.now();
for (let s2 = 0; s2 < nullCountry.length; s2 += 6) {
  const grp = nullCountry.slice(s2, s2 + 6);
  let items;
  try { items = await locate(grp.map((k) => k[3])); }
  catch (e) { console.log(`  batch FAILED — ${e.message}`); continue; }
  grp.forEach((k, i) => {
    const r = items.find((x) => x.i === i);
    if (!r) return;
    const v = verifyCountry(r.country_name, r.country);
    const mark = v ? `RESOLVED -> ${v}` : `still null (named="${r.country_name}")`;
    if (v) { resolvedCount++; k[1] = v; }
    console.log(`  ${mark.padEnd(34)} ev="${(r.evidence||'').slice(0,26)}" :: ${k[3].slice(0,44)}`);
  });
}
console.log(`
country pass: ${resolvedCount}/${nullCountry.length} resolved in ${((Date.now()-t1)/1000).toFixed(1)}s`);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('KEPT (risk signals):');
for (const [type, c, conf, text] of kept) {
  console.log(`  ${type.padEnd(17)} ${String(c).padEnd(4)} conf=${conf}  ${text.slice(0, 58)}`);
}
console.log(`\nDROPPED (event_type=null, not a risk signal): ${dropped.length}`);
for (const t of dropped.slice(0, 6)) console.log(`  · ${t.slice(0, 70)}`);
console.log(`\nUNMATCHED country (kept, logged): ${unmatched.length}  (of which model-code rejected by our table: ${rejected})`);
for (const [t, name, claimed] of unmatched.slice(0, 6)) {
  console.log(`  · named="${name}" claimed=${claimed} :: ${t.slice(0, 50)}`);
}
console.log(`\n${titles.length} articles → ${kept.length} kept, ${dropped.length} dropped in ${secs}s\n`);
