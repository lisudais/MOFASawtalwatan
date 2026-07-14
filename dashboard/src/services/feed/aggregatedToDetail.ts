// Adapts a right-column AggregatedAlert into exactly the inputs the ORIGINAL
// alert details card (AlertDetailsPanel) already consumes — a FeedCard plus, for
// geophysical events, a GeoEvent. This lets a click in the "التنبيهات العالمية"
// list open the SAME card the dashboard was built around, populated with the
// clicked alert's own data. No new/alternate card design is introduced.

import { classifyRiskByScore } from '../riskClassification';
import type { AggregatedAlert } from './aggregateAlerts';
import type { FeedCard } from './feedCards';
import type { EventType } from './types';
import type { GeoEvent, RiskLevel } from '../../types';

// Disaster sub-type → the GeoEvent glyph key (same map App uses for markers).
const DISASTER_GLYPH: Record<string, GeoEvent['type']> = {
  EARTHQUAKE: 'EARTHQUAKE', VOLCANO: 'VOLCANO', HURRICANE: 'STORM', FLOOD: 'FLOOD', WILDFIRE: 'WILDFIRE',
};

const BAND_TO_LEVEL: Record<string, RiskLevel> = {
  CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW',
};

const GEO_SOURCES: GeoEvent['source'][] = ['GDACS', 'USGS', 'RELIEFWEB', 'ACLED', 'MOCK', 'EONET', 'EMSC'];

/**
 * Build the (card, event) pair the ORIGINAL AlertDetailsPanel renders from any
 * aggregated alert. The FeedCard is always present; the GeoEvent is added only
 * for natural-disaster alerts (they alone carry coordinates + a headline), so
 * the panel shows real coords/description for those and reads "غير متاح" for
 * fields a given source genuinely lacks — exactly as the panel is designed to.
 */
export function aggregatedToDetail(a: AggregatedAlert): { card: FeedCard; event: GeoEvent | null } {
  const card: FeedCard = {
    id: a.id,
    country: a.countryCode || null,
    location: a.location,
    eventType: a.category as EventType,
    score: a.score,
    tier: null,
    tags: [],
    sources: a.sourceLabel ? [a.sourceLabel] : [],
    reportCount: 1,
    summary: a.detail || a.title,
    aiGenerated: false,
    occurredAt: a.occurredAt,
    url: a.url ?? null,
    geoType: a.ref.kind === 'natural_disaster' ? (DISASTER_GLYPH[a.ref.event.disasterType] ?? null) : null,
    breakdown: { band: '', bandReason: '', capApplied: null, ceilingNote: null, corroborationBonus: 0 },
    signalIds: [],
  };

  let event: GeoEvent | null = null;
  if (a.ref.kind === 'natural_disaster') {
    const d = a.ref.event;
    event = {
      id: d.id,
      title: d.title,
      type: DISASTER_GLYPH[d.disasterType] ?? 'EARTHQUAKE',
      riskLevel: BAND_TO_LEVEL[classifyRiskByScore(a.score).band] ?? 'MEDIUM',
      country: d.country,
      countryCode: d.countryCode,
      lat: d.latitude,
      lng: d.longitude,
      description: d.description || d.aiSummary || d.title,
      // Displayed source comes from card.sources (real); kept a valid union member.
      source: GEO_SOURCES.includes(d.source as GeoEvent['source']) ? (d.source as GeoEvent['source']) : 'GDACS',
      timestamp: d.updatedAt ? new Date(d.updatedAt) : new Date(),
      score: a.score,
      recommendedAction: '',
    };
  }

  return { card, event };
}
