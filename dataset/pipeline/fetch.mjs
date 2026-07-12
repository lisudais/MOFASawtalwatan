// Stage 1 — fetch raw archives from official sources into dataset/cache/.
// Every source is a public, official archive (WHO / USGS / NASA / GDACS /
// NOAA NCEI / EMSC). Nothing is generated: this stage only downloads and
// stores the raw payloads verbatim, so the build stage is reproducible and
// auditable against the cached originals.
//
// Usage: node pipeline/fetch.mjs [source ...]   (default: all)

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'cache');
mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { tries = 3, timeout = 60000, headers = {} } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'mofa-dataset-builder/1.0 (research)', ...headers },
      });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

function save(name, data) {
  writeFileSync(join(CACHE, name), JSON.stringify(data), 'utf8');
  const n = Array.isArray(data) ? data.length : (data?.features?.length ?? data?.items?.length ?? 'obj');
  console.log(`[saved] ${name} (${n})`);
}
const done = (name) => existsSync(join(CACHE, name));

/* ── WHO Disease Outbreak News (official WHO archive API) ─────────────── */
async function fetchWhoDon() {
  if (done('who-don.json')) return console.log('[skip] who-don.json');
  const all = [];
  const base = 'https://www.who.int/api/news/diseaseoutbreaknews';
  for (let skip = 0; skip < 4000; skip += 100) {
    const url = `${base}?sf_culture=en&$orderby=PublicationDateAndTime%20desc&$expand=EmergencyEvent&$top=100&$skip=${skip}&$format=json`;
    let page;
    try { page = await getJson(url); } catch (e) { console.log('WHO page failed', skip, String(e)); break; }
    const items = page?.value ?? [];
    all.push(...items);
    console.log(`WHO DON: +${items.length} (total ${all.length})`);
    if (items.length < 100) break;
    await sleep(400);
  }
  if (all.length === 0) throw new Error('WHO DON: nothing fetched');
  save('who-don.json', all);
}

/* ── USGS FDSN — global earthquakes M6.0+, 1960→now ───────────────────── */
async function fetchUsgs() {
  if (done('usgs.json')) return console.log('[skip] usgs.json');
  const feats = [];
  for (let y = 1960; y <= 2026; y += 4) {
    const end = Math.min(y + 4, 2027);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${y}-01-01&endtime=${end}-01-01&minmagnitude=6.0&orderby=time-asc&limit=20000`;
    const page = await getJson(url, { timeout: 120000 });
    feats.push(...(page?.features ?? []));
    console.log(`USGS ${y}-${end}: total ${feats.length}`);
    await sleep(500);
  }
  save('usgs.json', feats);
}

/* ── NASA EONET v3 — wildfires / storms / volcanoes / floods / drought ── */
async function fetchEonet() {
  if (done('eonet.json')) return console.log('[skip] eonet.json');
  const all = [];
  for (const status of ['closed', 'open']) {
    const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=${status}&limit=10000`;
    const page = await getJson(url, { timeout: 120000 });
    all.push(...(page?.events ?? []));
    console.log(`EONET ${status}: total ${all.length}`);
  }
  save('eonet.json', all);
}

/* ── GDACS — floods / cyclones / droughts / volcanoes / wildfires ─────── */
async function fetchGdacs() {
  if (done('gdacs.json')) return console.log('[skip] gdacs.json');
  const all = [];
  // The documented search endpoint answers per event-type + date window.
  for (const type of ['FL', 'TC', 'DR', 'VO', 'WF', 'EQ']) {
    for (let y = 2005; y <= 2026; y += 2) {
      const to = Math.min(y + 2, 2027);
      const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=${y}-01-01&toDate=${to}-01-01&alertlevel=&eventlist=${type}&country=`;
      try {
        const page = await getJson(url, { timeout: 90000 });
        const feats = page?.features ?? [];
        for (const f of feats) f.__qtype = type;
        all.push(...feats);
        console.log(`GDACS ${type} ${y}-${to}: +${feats.length} (total ${all.length})`);
      } catch (e) {
        console.log(`GDACS ${type} ${y}: failed ${String(e).slice(0, 80)}`);
      }
      await sleep(400);
    }
  }
  if (all.length === 0) throw new Error('GDACS: nothing fetched');
  save('gdacs.json', all);
}

/* ── NOAA NCEI "hazel" — tsunamis, volcano events, significant quakes ─── */
async function fetchNcei(kind) {
  const file = `ncei-${kind.replace(/\//g, '-')}.json`;
  if (done(file)) return console.log(`[skip] ${file}`);
  const all = [];
  for (let page = 1; page < 200; page++) {
    const url = `https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/${kind}?itemsPerPage=200&page=${page}`;
    const data = await getJson(url, { timeout: 90000 });
    const items = data?.items ?? [];
    all.push(...items);
    console.log(`NCEI ${kind} p${page}: total ${all.length}/${data?.totalItems}`);
    if (page >= (data?.totalPages ?? 1)) break;
    await sleep(300);
  }
  save(file, all);
}

/* ── EMSC FDSN — corroboration only (recent M6.0+) ────────────────────── */
async function fetchEmsc() {
  if (done('emsc.json')) return console.log('[skip] emsc.json');
  const all = [];
  for (let y = 2005; y <= 2026; y += 3) {
    const end = Math.min(y + 3, 2027);
    const url = `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&start=${y}-01-01&end=${end}-01-01&minmag=6.0&limit=15000&orderby=time-asc`;
    try {
      const page = await getJson(url, { timeout: 120000 });
      all.push(...(page?.features ?? []));
      console.log(`EMSC ${y}-${end}: total ${all.length}`);
    } catch (e) {
      console.log(`EMSC ${y}: failed ${String(e).slice(0, 80)}`);
    }
    await sleep(500);
  }
  save('emsc.json', all);
}

const SOURCES = {
  who: fetchWhoDon,
  usgs: fetchUsgs,
  eonet: fetchEonet,
  gdacs: fetchGdacs,
  'ncei-tsunamis': () => fetchNcei('tsunamis/events'),
  'ncei-volcanoes': () => fetchNcei('volcanoes'),
  'ncei-earthquakes': () => fetchNcei('earthquakes'),
  emsc: fetchEmsc,
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SOURCES);
for (const name of names) {
  console.log(`\n===== ${name} =====`);
  try { await SOURCES[name](); } catch (e) { console.error(`FAILED ${name}:`, String(e)); }
}
console.log('\nfetch done');
