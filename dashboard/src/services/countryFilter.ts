// Single shared country-scoping primitive. Originally only the consular feed
// (useFeedCards → filterFeedCardsByCountry) needed this; the embassy citizen-
// requests/approved-alerts lists now route through it too, rather than each
// growing its own country-matching logic.
//
// No codes → everything through unchanged. An item whose resolved code can't
// be determined is dropped only once a filter is actually active.
export function filterByCountry<T>(
  items: T[],
  getCountryCode: (item: T) => string | null | undefined,
  countryCodes?: readonly string[] | null,
): T[] {
  if (!countryCodes || countryCodes.length === 0) return items;
  const set = new Set(countryCodes);
  return items.filter((item) => {
    const code = getCountryCode(item);
    return code != null && set.has(code);
  });
}
