// Card-layer rollup for the Global Alert Feed — grouping option B.
//
// One State Dept advisory yields several distinct threat rows (armed conflict,
// violent crime, terrorism, kidnapping, health risk). Stage 4 correctly refuses
// to merge them: they are different events, and merging would change what
// `distinctSources` and the corroboration bonus mean to Stage 5. So the feed
// showed "الكويت · أمني" three times at 95.
//
// This module groups them for DISPLAY ONLY. The pipeline, the clusters and the
// scores are untouched — a group simply presents the cards that already exist:
//
//   score      = max member score        (the worst threat defines the card)
//   summary    = summary of that member  (never a synthesized sentence)
//   sources    = union of member sources
//   tags       = corroborated if ANY member is; official if ANY member is
//   occurredAt = most recent member
//   threats    = the members themselves, for the expandable list
//
// Nothing is invented and nothing is averaged. Every number on a group card is a
// number that appears on one of its members.

import type { FeedCard } from './feedCards';

export interface FeedCardGroup {
  /** Stable across refreshes: `${country}|${eventType}`, or the card id when ungrouped. */
  id: string;
  country: string | null;
  eventType: FeedCard['eventType'];
  /** The highest-scoring member. Its score, summary and icon represent the group. */
  lead: FeedCard;
  /** All members, highest score first. Length 1 for an ungrouped card. */
  threats: FeedCard[];
  score: number;
  tier: 1 | 2 | null;
  tags: FeedCard['tags'];
  sources: string[];
  occurredAt: string | null;
  url: string | null;
  /** true when this group rolls up more than one cluster. */
  grouped: boolean;
}

/** Highest tier present: 1 beats 2 beats null. */
function bestTier(cards: FeedCard[]): 1 | 2 | null {
  if (cards.some((c) => c.tier === 1)) return 1;
  if (cards.some((c) => c.tier === 2)) return 2;
  return null;
}

function mostRecent(cards: FeedCard[]): string | null {
  const times = cards.map((c) => c.occurredAt).filter((t): t is string => !!t).sort();
  return times.at(-1) ?? null;
}

/**
 * Groups by country + eventType. Cards with a null country are NEVER grouped —
 * they would all collapse into one meaningless bucket per event type, since a
 * null country means "we could not determine where this happened".
 */
export function groupFeedCards(cards: FeedCard[]): FeedCardGroup[] {
  const buckets = new Map<string, FeedCard[]>();
  const singles: FeedCard[] = [];

  for (const card of cards) {
    if (!card.country) {
      singles.push(card);
      continue;
    }
    const key = `${card.country}|${card.eventType}`;
    const list = buckets.get(key);
    if (list) list.push(card);
    else buckets.set(key, [card]);
  }

  const groups: FeedCardGroup[] = [];

  for (const [key, members] of buckets) {
    const threats = [...members].sort((a, b) => b.score - a.score);
    const lead = threats[0];
    groups.push({
      id: key,
      country: lead.country,
      eventType: lead.eventType,
      lead,
      threats,
      score: lead.score,
      tier: bestTier(threats),
      tags: [
        threats.some((t) => t.tags.includes('corroborated')) ? 'corroborated' : 'unconfirmed',
        ...(threats.some((t) => t.tags.includes('official')) ? (['official'] as const) : []),
      ],
      sources: [...new Set(threats.flatMap((t) => t.sources))],
      occurredAt: mostRecent(threats),
      url: threats.find((t) => t.url)?.url ?? null,
      grouped: threats.length > 1,
    });
  }

  for (const card of singles) {
    groups.push({
      id: card.id,
      country: null,
      eventType: card.eventType,
      lead: card,
      threats: [card],
      score: card.score,
      tier: card.tier,
      tags: card.tags,
      sources: card.sources,
      occurredAt: card.occurredAt,
      url: card.url,
      grouped: false,
    });
  }

  return groups.sort((a, b) => b.score - a.score);
}
