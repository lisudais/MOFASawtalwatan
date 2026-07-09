// Stage 1 adapter — geophysical sources (USGS, EMSC, EONET, GDACS).
//
// Reuses the EXISTING fetchers verbatim (usgs.ts / disasters.ts / gdacs.ts) so
// the Natural Disasters card, which shares them via naturalDisasters.ts, is not
// touched and no upstream is fetched twice per source.
//
// Those fetchers return GeoEvent, which already carries a `score`/`riskLevel`
// produced by riskEngine.ts. We DISCARD both: Stage 5 is the only place a risk
// score may be produced. What we keep is the source's own severity expression,
// recovered as a verbatim string in `severityHint`.

import { fetchUSGSEarthquakes } from '../../usgs';
import { fetchGDACSEvents } from '../../gdacs';
import { fetchExtraDisasterEvents } from '../../disasters';
import type { GeoEvent } from '../../../types';
import { resolveWatchCountry } from '../watchlist';
import type { AdapterResult, RawSignal, SignalSource } from '../types';

// GeoEvent['source'] → SignalSource. The GeoEvent union also contains
// RELIEFWEB / ACLED / MOCK, which these three fetchers never emit.
const SOURCE_MAP: Partial<Record<GeoEvent['source'], SignalSource>> = {
  USGS: 'USGS',
  EMSC: 'EMSC',
  EONET: 'EONET',
  GDACS: 'GDACS',
};

// The magnitude/category the source itself stated, recovered from the title the
// fetcher built (e.g. "M6.8 Earthquake — Java"). Returns null rather than
// guessing — a null severityHint is a legitimate Stage 5 input.
function severityHintFrom(event: GeoEvent): string | null {
  const mag = event.title.match(/\bM\s?(\d+(?:\.\d+)?)/i);
  if (mag) return `M${mag[1]}`;
  const alert = event.description.match(/\b(red|orange|green)\s+alert\b/i);
  if (alert) return alert[1].toLowerCase();
  return null;
}

function hasCoords(event: GeoEvent): boolean {
  return (
    Number.isFinite(event.lat) && Number.isFinite(event.lng) &&
    (event.lat !== 0 || event.lng !== 0)
  );
}

/**
 * EMSC never populates `countryCode`, but `disasters.ts` puts its `flynn_region`
 * into `country` — "WESTERN IRAN", "SULAWESI, INDONESIA". That string names the
 * country outright, so we resolve it against the watchlist instead of leaving
 * every EMSC quake ungroupable (53 of 120 signals in the last e2e run).
 *
 * Confined to EMSC on purpose. GDACS already supplies a real country name and
 * USGS has its own `guessCountryCode`; neither is touched here. EONET stays null
 * by decision — its events are 28/30 US wildfires, and the US is off-watchlist,
 * so resolving them would yield nothing.
 */
function resolveCountryCode(event: GeoEvent): string | null {
  if (event.countryCode) return event.countryCode;
  if (event.source === 'EMSC') return resolveWatchCountry(event.country);
  return null;
}

function toSignal(event: GeoEvent, fetchedFrom: string): RawSignal | null {
  const source = SOURCE_MAP[event.source];
  if (!source) return null;

  return {
    id: `${source}:${event.id}`,
    source,
    tier: null, // Stage 3 assigns
    ingestedAt: new Date().toISOString(),
    occurredAt: event.timestamp.toISOString(),
    // Structured already — Stage 2 must not spend a classifier call on these.
    rawText: null,
    country: resolveCountryCode(event),
    authorityCountry: null,
    eventType: 'natural_disaster', // known from the source, no AI needed
    coords: hasCoords(event) ? { lat: event.lat, lng: event.lng } : null,
    geoType: event.type, // restores the card's original per-type icon
    severityHint: severityHintFrom(event),
    url: null,
    sourceDomain: null,
    provenance: { fetchedFrom, httpStatus: 200, ok: true },
  };
}

/**
 * Each underlying fetcher already swallows its own errors and returns [] (see
 * the data-source audit). We therefore cannot observe their HTTP status from
 * here, and an empty array is ambiguous: "source down" vs "genuinely nothing".
 * We report that ambiguity explicitly rather than claiming ok:true.
 */
async function runOne(
  label: string,
  fetchedFrom: string,
  fetcher: () => Promise<GeoEvent[]>
): Promise<AdapterResult> {
  try {
    const events = await fetcher();
    const signals = events.map((e) => toSignal(e, fetchedFrom)).filter((s): s is RawSignal => s !== null);
    return {
      signals,
      sourceKeys: [label as SignalSource],
      status: {
        ok: signals.length > 0,
        httpStatus: null, // not observable through the existing fetchers
        count: signals.length,
        error: signals.length === 0
          ? 'returned no events — cannot distinguish upstream failure from empty result (fetcher swallows status)'
          : undefined,
      },
    };
  } catch (err) {
    return {
      signals: [],
      sourceKeys: [label as SignalSource],
      status: { ok: false, httpStatus: null, count: 0, error: String(err) },
    };
  }
}

export async function ingestGeophysical(): Promise<AdapterResult[]> {
  // fetchExtraDisasterEvents bundles EONET + EMSC, so its signals are split by
  // event.source after the fact rather than by fetcher.
  const [usgs, gdacs, extra] = await Promise.all([
    runOne('USGS', 'earthquake.usgs.gov (via services/usgs.ts)', fetchUSGSEarthquakes),
    runOne('GDACS', 'gdacs.org via api.allorigins.win (via services/gdacs.ts)', fetchGDACSEvents),
    runOne('EONET+EMSC', 'eonet.gsfc.nasa.gov + seismicportal.eu (via services/disasters.ts)', fetchExtraDisasterEvents),
  ]);

  const eonet = extra.signals.filter((s) => s.source === 'EONET');
  const emsc = extra.signals.filter((s) => s.source === 'EMSC');

  const splitStatus = (count: number, err?: string) => ({
    ok: count > 0,
    httpStatus: null,
    count,
    error: count === 0 ? (err ?? 'returned no events — upstream failure indistinguishable from empty') : undefined,
  });

  return [
    usgs,
    gdacs,
    { signals: eonet, sourceKeys: ['EONET'], status: splitStatus(eonet.length, extra.status.error) },
    { signals: emsc, sourceKeys: ['EMSC'], status: splitStatus(emsc.length, extra.status.error) },
  ];
}
