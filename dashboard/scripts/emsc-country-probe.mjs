// Verifies resolveWatchCountry() against the LIVE EMSC feed plus adversarial
// name collisions. Loads the real watchlist.ts via Vite's SSR loader, so this
// probe cannot drift from the implementation.
//
//   npm run feed:emsc

import { createServer } from 'vite';

const EMSC_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20&minmag=4.5';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { resolveWatchCountry } = await server.ssrLoadModule('/src/services/feed/watchlist.ts');

console.log('\nEMSC flynn_region → watchlist ISO2\n');

const res = await fetch(EMSC_URL, { signal: AbortSignal.timeout(40000) });
const data = await res.json();

let resolved = 0;
const nulls = [];
for (const f of data.features) {
  const region = f.properties.flynn_region;
  const iso2 = resolveWatchCountry(region);
  if (iso2) {
    resolved++;
    console.log(`  ${iso2}    "${region}"`);
  } else {
    nulls.push(region);
  }
}
console.log(`\n  resolved ${resolved}/${data.features.length}`);
console.log(`  null (expected — off-watchlist / oceanic):`);
for (const n of nulls) console.log(`       ${n}`);

/* ── Adversarial cases: the collisions the matcher must NOT make ─────────── */
console.log('\nADVERSARIAL NAME COLLISIONS');
const cases = [
  ['NIGERIA',                       'NG', 'must not read as Niger (NE)'],
  ['SOUTHERN NIGER',                'NE', 'must not read as Nigeria (NG)'],
  ['SOUTH SUDAN',                   'SS', 'must not read as Sudan (SD)'],
  ['NORTHERN SUDAN',                'SD', 'plain Sudan still resolves'],
  ['INDIAN OCEAN',                  null, 'must not read as India (IN)'],
  ['ROMANIA',                       null, 'must not read as Oman (OM)'],
  ['PHILIPPINE ISLANDS REGION',     'PH', 'alias'],
  ['MYANMAR-INDIA BORDER REGION',   'MM', 'alias; longest-first picks Myanmar'],
  ['CONGO',                         null, 'ambiguous DRC vs Rep. of Congo → null'],
  ['DEMOCRATIC REPUBLIC OF THE CONGO', 'CD', 'unambiguous'],
  ['MOLUCCA SEA',                   null, 'oceanic'],
  ['WESTERN IRAN',                  'IR', 'baseline'],
  ['NEAR EAST COAST OF HONSHU, JAPAN', null, 'Japan is off-watchlist'],
  ['CENTRAL TURKEY',                'TR', 'baseline'],
  ['CHAGOS ARCHIPELAGO REGION',     null, 'must not read as Chad (TD)'],
];

let pass = 0;
for (const [input, expected, why] of cases) {
  const got = resolveWatchCountry(input);
  const ok = got === expected;
  if (ok) pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(got).padEnd(5)} expected=${String(expected).padEnd(5)} "${input}"  — ${why}`);
}
console.log(`\n  ${pass}/${cases.length} adversarial cases pass\n`);

await server.close();
process.exit(pass === cases.length ? 0 : 1);
