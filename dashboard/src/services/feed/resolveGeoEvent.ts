// Bridges a Global Alert Feed card back to the real geophysical event behind
// it — the ONLY place a FeedCard's precise coordinates can come from, since
// FeedCard itself carries no lat/lng (see feedCards.ts). Used by both the
// right-panel card-click flow and the map's alert-marker layer, so a card and
// its marker are always resolved through the exact same logic and therefore
// always agree.

import type { FeedCard } from './feedCards';
import type { GeoEvent } from '../../types';

/**
 * Resolves a FeedCard to the GeoEvent it was built from, if any. `signalIds`
 * entries are `${sourceType}:${originalId}`; a geophysical member's
 * originalId matches one of the events currently held in state.
 *
 * Returns null when the card isn't backed by a geophysical event (security /
 * statement / GDELT / health / economic clusters have no GeoEvent at all) —
 * callers MUST treat that as "no real coordinates available" and never
 * substitute a guessed/centroid position.
 */
export function resolveGeoEvent(card: FeedCard, events: GeoEvent[]): GeoEvent | null {
  const geoIds = card.signalIds.map((id) => id.slice(id.indexOf(':') + 1));
  return events.find((e) => geoIds.includes(e.id)) ?? null;
}

/** A GeoEvent with no usable coordinates must never become a map marker. */
export function hasValidCoords(event: GeoEvent): boolean {
  return (
    Number.isFinite(event.lat) && Number.isFinite(event.lng) &&
    (event.lat !== 0 || event.lng !== 0)
  );
}
