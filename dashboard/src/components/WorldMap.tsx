import { MapContainer, TileLayer, CircleMarker, GeoJSON, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plane, ShieldAlert, TrendingUp, Layers, AlertTriangle, Users } from 'lucide-react';
import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { RISK_COLORS } from '../constants';
import type { GeoEvent, Traveler, RiskLevel } from '../types';
import FlightLayer from './FlightLayer';
import CitizenPopupCard from './CitizenPopupCard';
import { centroidFor, iso3For, ISO3_WITHOUT_POLYGON } from '../services/feed/countryCentroids';
import { countryNameAr } from '../services/feed/countryNames';
import { useBoundariesGeoJson } from '../services/geoBoundaries';
import MapLayersPanel, { type MapLayer } from './MapLayersPanel';
import {
  loadOutbreakForecasts, loadOutbreakMeta, topOutbreakByIso2, riskBandFor,
  OUTBREAK_SOURCE_AR, MARKER_THRESHOLD, type ResolvedOutbreak, type OutbreakMeta,
} from '../services/forecasting/outbreakForecast';
import OutbreakDetailCard from './OutbreakDetailCard';

/** Per-country risk from App: max Stage 5 score + the category that produced it. */
export interface CountryRisk {
  score: number;
  category: string;
  byCategory: Record<string, number>;
}

/** Only these two bands ever reach the map — LOW is filtered out before this
 *  type is constructed (see App.tsx). One marker per Global Alert Feed card,
 *  keyed by that card's own id, so the map and the right panel always agree
 *  on which alert is which. */
export type AlertMarkerBand = 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AlertMarker {
  /** Same id as the right-panel FeedCard this marker represents. */
  id: string;
  lat: number;
  lng: number;
  band: AlertMarkerBand;
  /** Original GeoEvent type — picks the glyph (earthquake, flood, …). */
  type: GeoEvent['type'];
}

interface WorldMapProps {
  alertMarkers: AlertMarker[];
  /** The id of the FeedCard currently open in the right panel, if any. */
  selectedAlertId: string | null;
  onSelectAlert: (marker: AlertMarker) => void;
  travelers: Traveler[];
  /** Drives fly-to only — set from the right panel's selected card via the
   *  same GeoEvent resolution used to build `alertMarkers`. */
  selectedEvent: GeoEvent | null;
  selectedTraveler: Traveler | null;
  /**
   * Real per-country risk for the RED layer, keyed by ISO2. Aggregated in
   * App.tsx from the pipeline output — deterministic, no mock, no fetch here.
   */
  countryRisk?: Record<string, CountryRisk>;
}

// A country is highlighted red when its overall score (the max across its
// categories) is >= this. 75 matches the Security sidebar's own red cutoff, so
// the map's red set mirrors the countries already shown red there.
const RISK_HIGHLIGHT_THRESHOLD = 75;

const CATEGORY_AR: Record<string, string> = {
  security: 'أمني',
  natural_disaster: 'كارثة طبيعية',
  health: 'صحي',
  economic: 'اقتصادي',
  political_unrest: 'اضطراب سياسي',
};

const RED = '#FF1744';

const WORLD_BOUNDARIES_URL = '/world-countries-110m.geojson';

export const travelerIcon = new L.DivIcon({
  className: 'traveler-map-icon',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#00A050;border:2px solid #fff;box-shadow:0 0 6px rgba(0,160,80,0.8);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

// ── Risk / event markers (non-flight) ────────────────────────────────────
// Lucide-style SVG path strings for each event type (embedded in the Leaflet
// divIcon HTML — same minimal line-icon style as the rest of the dashboard).
const EVENT_SVG: Record<GeoEvent['type'], string> = {
  EARTHQUAKE:   '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  FLOOD:        '<path d="M2 12h20M2 7c3.5 0 3.5 5 7 5s3.5-5 7-5 3.5 5 7 5"/><path d="M2 17c3.5 0 3.5 5 7 5s3.5-5 7-5 3.5 5 7 5"/>',
  STORM:        '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/><path d="m13 11-4 6h6l-4 6"/>',
  VOLCANO:      '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  CONFLICT:     '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
  TERROR:       '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  CIVIL_UNREST: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>',
  DISEASE:      '<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  DROUGHT:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  WILDFIRE:     '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>',
};

function eventSvgIcon(type: GeoEvent['type'], color: string, px: number): string {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${EVENT_SVG[type] ?? '<circle cx="12" cy="12" r="6"/>'}
  </svg>`;
}

function riskCircleSize(level: RiskLevel): number {
  return { CRITICAL: 22, HIGH: 18, MEDIUM: 14, LOW: 11, SAFE: 8 }[level];
}

// Type-specific icon inside a glowing, risk-colored circular marker — size and
// glow strength scale with risk level, selected events are drawn larger.
export function eventDivIcon(event: GeoEvent, isSelected: boolean): L.DivIcon {
  const color = RISK_COLORS[event.riskLevel];
  const size = Math.round((isSelected ? 1.3 : 1) * riskCircleSize(event.riskLevel));
  const pulsing = event.riskLevel === 'CRITICAL' || event.riskLevel === 'HIGH';
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:${size * 2}px;height:${size * 2}px;
        background:${color}22;border:2px solid ${color};
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        cursor:pointer;box-shadow:0 0 ${size}px ${color}88;
        ${pulsing ? 'animation:eventIconPulse 2s infinite;' : ''}
      ">
        ${eventSvgIcon(event.type, color, Math.round(size * 1.1))}
      </div>`,
    iconSize: [size * 2, size * 2],
    iconAnchor: [size, size],
  });
}

// ── Alert markers (Global Alert Feed → map) ─────────────────────────────
// Colour/size are driven by the card's severity BAND (the same 0-100 score
// shown in the right panel), never the raw GeoEvent.riskLevel — a card and
// its marker must always read the same severity. Per spec: MEDIUM is
// yellow, HIGH/CRITICAL both read as red (unlike the 4-colour scale used
// elsewhere in the app) so the map only ever shows two marker states.
const ALERT_BAND_COLOR: Record<AlertMarkerBand, string> = {
  MEDIUM: '#FFD600',
  HIGH: '#FF1744',
  CRITICAL: '#FF1744',
};
const ALERT_BAND_SIZE: Record<AlertMarkerBand, number> = { MEDIUM: 14, HIGH: 18, CRITICAL: 22 };

export function alertMarkerIcon(marker: AlertMarker, isSelected: boolean): L.DivIcon {
  const color = ALERT_BAND_COLOR[marker.band];
  const size = Math.round((isSelected ? 1.3 : 1) * ALERT_BAND_SIZE[marker.band]);
  const pulsing = marker.band === 'HIGH' || marker.band === 'CRITICAL';
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:${size * 2}px;height:${size * 2}px;
        background:${color}22;border:2px solid ${color};
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        cursor:pointer;box-shadow:0 0 ${size}px ${color}88;
        ${pulsing ? 'animation:eventIconPulse 2s infinite;' : ''}
      ">
        ${eventSvgIcon(marker.type, color, Math.round(size * 1.1))}
      </div>`,
    iconSize: [size * 2, size * 2],
    iconAnchor: [size, size],
  });
}

// An event with no usable coordinates must not move the map (and must not
// crash) — the details panel still opens, showing "غير متاح" for its location.
function hasCoords(target: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(target.lat) && Number.isFinite(target.lng) &&
    (target.lat !== 0 || target.lng !== 0)
  );
}

function FlyToSelection({ event, traveler }: { event: GeoEvent | null; traveler: Traveler | null }) {
  const map = useMap();
  useEffect(() => {
    const target = event ?? traveler;
    if (target && hasCoords(target)) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 4), { duration: 0.8 });
    }
  }, [event, traveler, map]);
  return null;
}

// Leaflet caches its container size at init and won't notice a CSS-driven
// resize (e.g. dragging the sidebar handle) on its own — this keeps tiles
// correctly sized/positioned as the map container's width changes live.
function MapResizeObserver() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// One country to highlight: which ISO codes, its score, and (for the RED layer)
// the category that drove it, so the popup can explain "why is this red".
interface RiskCountry {
  iso2: string;
  iso3: string | null;
  score: number;
  category: string | null;
  byCategory: Record<string, number> | null;
  // Forecast layer only: the full outbreak forecast for colour + popups.
  outbreak?: ResolvedOutbreak;
}

// Resolves a per-country risk map into the countries to highlight at/above the
// threshold. Layer styling (solid red vs. dashed blue) is applied at render.
function riskCountries(
  risk: Record<string, { score: number; category?: string; byCategory?: Record<string, number> }>,
  threshold: number,
): RiskCountry[] {
  const out: RiskCountry[] = [];
  for (const [iso2, v] of Object.entries(risk)) {
    if (v.score < threshold) continue;
    out.push({
      iso2,
      iso3: iso3For(iso2),
      score: v.score,
      category: v.category ?? null,
      byCategory: v.byCategory ?? null,
    });
  }
  return out;
}

type RiskLayer = 'none' | 'current' | 'predicted';

export default function WorldMap({
  alertMarkers, selectedAlertId, onSelectAlert, travelers, selectedEvent, selectedTraveler, countryRisk = {},
}: WorldMapProps) {
  // ── Flight monitoring (isolated from alert/risk state) ──────────────────
  // The imperative <FlightLayer> owns polling + smooth interpolation; this only
  // toggles it. Polling runs only while the layer is enabled.
  const [showFlights, setShowFlights] = useState(false);
  // ── Risk highlight layers — mutually exclusive with each other, independent
  //    of the flight layer. 'none' | 'current' (real RED) | 'predicted' (XGBoost outbreak forecast). ──
  const [riskLayer, setRiskLayer] = useState<RiskLayer>('none');
  // ── Event/traveler marker layers — previously always-on; now toggleable
  //    from the same layers panel. Default true so nothing already on screen
  //    disappears for existing sessions. ──────────────────────────────────
  const [showEvents, setShowEvents] = useState(true);
  const [showTravelers, setShowTravelers] = useState(true);
  // ── Layers dropdown (replaces the old row of separate toggle buttons). ──
  const [layersOpen, setLayersOpen] = useState(false);
  const layersBtnRef = useRef<HTMLButtonElement>(null);

  // ── XGBoost outbreak-forecast layer data — loaded once from the local file
  //    (/data/forecasts.json via the shared loader). No API, no mock. ──────
  const [forecastByIso2, setForecastByIso2] = useState<Record<string, ResolvedOutbreak>>({});
  const [fcMeta, setFcMeta] = useState<OutbreakMeta | null>(null);
  // The single outbreak details component — opened by clicking a forecast
  // country/marker (same OutbreakDetailCard the health card opens).
  const [selectedOutbreak, setSelectedOutbreak] = useState<ResolvedOutbreak | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOutbreakForecasts(), loadOutbreakMeta()]).then(([list, meta]) => {
      if (cancelled) return;
      setForecastByIso2(topOutbreakByIso2(list));
      setFcMeta(meta);
    });
    return () => { cancelled = true; };
  }, []);

  const toggleLayer = (layer: RiskLayer) =>
    setRiskLayer((cur) => (cur === layer ? 'none' : layer));

  // Single dispatch point for the checklist panel — each id maps back to the
  // exact same state setter the old individual buttons called. 'risk-current'
  // and 'risk-predicted' stay mutually exclusive (toggleLayer's existing
  // behavior): checking one un-checks the other, same as before.
  function handleLayerToggle(id: string) {
    switch (id) {
      case 'flights': setShowFlights((v) => !v); break;
      case 'risk-current': toggleLayer('current'); break;
      case 'risk-predicted': toggleLayer('predicted'); break;
      case 'events': setShowEvents((v) => !v); break;
      case 'travelers': setShowTravelers((v) => !v); break;
    }
  }

  const mapLayers: MapLayer[] = [
    { id: 'flights', labelAr: 'حركة الطيران', icon: <Plane size={13} />, enabled: showFlights },
    { id: 'risk-current', labelAr: 'طبقة الخطر الحالي', icon: <ShieldAlert size={13} />, enabled: riskLayer === 'current' },
    {
      id: 'risk-predicted', labelAr: 'التنبؤ بالمخاطر', labelEn: 'Risk Forecast',
      icon: <TrendingUp size={13} />, enabled: riskLayer === 'predicted',
    },
    { id: 'events', labelAr: 'أحداث ومخاطر الخريطة', icon: <AlertTriangle size={13} />, enabled: showEvents },
    { id: 'travelers', labelAr: 'المسافرون المسجّلون', icon: <Users size={13} />, enabled: showTravelers },
  ];
  const activeLayerCount = mapLayers.filter((l) => l.enabled).length;

  const worldGeo = useBoundariesGeoJson(WORLD_BOUNDARIES_URL, riskLayer !== 'none');

  const redCountries = riskLayer === 'current' ? riskCountries(countryRisk, RISK_HIGHLIGHT_THRESHOLD) : [];
  // Forecast layer: one entry per country = its highest-probability outbreak
  // forecast, coloured by the risk level (green→dark red).
  const forecastCountries: RiskCountry[] = riskLayer === 'predicted'
    ? Object.values(forecastByIso2).map((f) => ({
        iso2: f.iso2, iso3: iso3For(f.iso2), score: Math.round(f.probability * 100),
        category: f.disease, byCategory: null, outbreak: f,
      }))
    : [];
  const active = riskLayer === 'current' ? redCountries : riskLayer === 'predicted' ? forecastCountries : [];
  const isPredicted = riskLayer === 'predicted';
  const colorFor = (c: RiskCountry) => (isPredicted && c.outbreak ? riskBandFor(c.outbreak.probability).color : RED);
  // Countries at/above the marker threshold get a visible emphasis marker.
  const forecastMarkers = isPredicted
    ? active.filter((c) => c.outbreak && c.outbreak.probability >= MARKER_THRESHOLD)
    : [];

  // Polygon subset of the world GeoJSON limited to the active countries. Keyed
  // by riskLayer + the id list so react-leaflet rebuilds it when the set changes.
  const byIso3 = new Map(active.filter((c) => c.iso3).map((c) => [c.iso3 as string, c]));
  const polyFeatures = useMemo<FeatureCollection | null>(() => {
    if (!worldGeo) return null;
    const feats = worldGeo.features.filter((f) => byIso3.has(String(f.id)));
    return { type: 'FeatureCollection', features: feats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldGeo, riskLayer, active.map((c) => c.iso3).join(',')]);
  const polyKey = `${riskLayer}:${active.map((c) => c.iso3).join(',')}`;

  // Countries the 110m dataset has no polygon for (e.g. Bahrain, Tonga) fall
  // back to a centroid circle so a high-risk state is never silently dropped.
  const fallbackCircles = active.filter((c) => !c.iso3 || ISO3_WITHOUT_POLYGON.has(c.iso3));

  return (
    <>
      {/* Map layer controls — one trigger opens the checklist dropdown below,
          replacing what used to be three separate always-visible buttons. */}
      <div className="map-toggle-row">
        <button
          ref={layersBtnRef}
          type="button"
          className={`map-toggle-btn layers${layersOpen ? ' active' : ''}`}
          onClick={() => setLayersOpen((v) => !v)}
          title="طبقات الخريطة"
          aria-expanded={layersOpen}
        >
          <Layers size={13} />
          الطبقات
          {activeLayerCount > 0 && <span className="map-layers-count">{activeLayerCount}</span>}
        </button>
        {layersOpen && (
          <MapLayersPanel
            layers={mapLayers}
            onToggle={handleLayerToggle}
            onClose={() => setLayersOpen(false)}
            anchorRef={layersBtnRef}
          />
        )}
      </div>

      {/* Provenance banner while the forecast layer is on */}
      {riskLayer === 'predicted' && (
        <div className="predict-banner" dir="rtl">
          <TrendingUp size={12} />
          {OUTBREAK_SOURCE_AR}
        </div>
      )}

      <MapContainer center={[20, 30]} zoom={2.4} minZoom={2} worldCopyJump zoomControl={false} style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution=""
        />
        <FlyToSelection event={selectedEvent} traveler={selectedTraveler} />
        <MapResizeObserver />

        {/* Risk highlight — country-polygon shading. 'current' = real Stage 5
            risk (solid red). 'predicted' = XGBoost outbreak forecast, coloured by
            severity band (red/orange/yellow). Only the active layer renders. */}
        {polyFeatures && polyFeatures.features.length > 0 && (
          <GeoJSON
            key={polyKey}
            data={polyFeatures}
            style={(feature?: Feature) => {
              const c = feature ? byIso3.get(String(feature.id)) : undefined;
              const col = c ? colorFor(c) : RED;
              return { color: col, weight: 1, fillColor: col, fillOpacity: isPredicted ? 0.4 : 0.35 };
            }}
            onEachFeature={(feature: Feature, layer) => {
              const c = byIso3.get(String(feature.id));
              if (!c) return;
              const name = countryNameAr(c.iso2);
              if (isPredicted && c.outbreak) {
                // Open the single OutbreakDetailCard — no legacy popup.
                const f = c.outbreak;
                layer.on('click', () => setSelectedOutbreak(f));
              } else {
                const catAr = c.category ? (CATEGORY_AR[c.category] ?? c.category) : 'غير محدد';
                const breakdown = c.byCategory
                  ? Object.entries(c.byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => `${CATEGORY_AR[k] ?? k}: ${v}`).join('، ')
                  : '';
                layer.bindPopup(
                  `<div dir="rtl" class="flight-popup"><strong>${name}</strong>` +
                  `<div>مستوى الخطر: ${c.score}/100 — المصدر: ${catAr}</div>` +
                  (breakdown ? `<div style="opacity:.7">حسب الفئة: ${breakdown}</div>` : '') +
                  `<div style="opacity:.7">تحليل تلقائي (المرحلة 5)</div></div>`
                );
              }
            }}
          />
        )}

        {/* Centroid-circle fallback for countries absent from the 110m polygons */}
        {fallbackCircles.map((c) => {
          const center = centroidFor(c.iso2);
          if (!center) return null;
          return (
            <CircleMarker
              key={`fallback-${riskLayer}-${c.iso2}`}
              center={center}
              radius={12}
              pathOptions={{
                color: colorFor(c),
                weight: 1.5,
                fillColor: colorFor(c),
                fillOpacity: isPredicted ? 0.4 : 0.3,
              }}
              eventHandlers={isPredicted && c.outbreak ? { click: () => setSelectedOutbreak(c.outbreak!) } : undefined}
            >
              {!isPredicted && (
                <Popup>
                  <div dir="rtl" className="flight-popup">
                    <strong>{countryNameAr(c.iso2)}</strong>
                    <div>مستوى الخطر: {c.score}/100 — المصدر: {c.category ? (CATEGORY_AR[c.category] ?? c.category) : 'غير محدد'}</div>
                  </div>
                </Popup>
              )}
            </CircleMarker>
          );
        })}

        {/* Emphasis marker for countries at/above the marker threshold (>=5%) */}
        {forecastMarkers.map((c) => {
          const center = centroidFor(c.iso2);
          const f = c.outbreak!;
          if (!center) return null;
          const col = riskBandFor(f.probability).color;
          return (
            <Marker
              key={`fc-marker-${c.iso2}`}
              position={center}
              icon={L.divIcon({
                className: '',
                html: `<div style="width:14px;height:14px;border-radius:50%;background:${col};` +
                  `border:2px solid #fff;box-shadow:0 0 8px ${col};cursor:pointer;"></div>`,
                iconSize: [14, 14], iconAnchor: [7, 7],
              })}
              eventHandlers={{ click: () => setSelectedOutbreak(f) }}
            />
          );
        })}

        {/* Alert markers — one per Global Alert Feed card (right panel), same id,
            same severity colour, real source coordinates only. See App.tsx for
            how this list is built (severity-filtered, deduped, geo-resolved). */}
        {showEvents && alertMarkers.map((marker) => {
          const isSelected = marker.id === selectedAlertId;
          return (
            <Marker
              key={marker.id}
              position={[marker.lat, marker.lng]}
              icon={alertMarkerIcon(marker, isSelected)}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => onSelectAlert(marker) }}
            />
          );
        })}

        {showTravelers && travelers.map((traveler) => (
          <Marker key={traveler.id} position={[traveler.lat, traveler.lng]} icon={travelerIcon}>
            <Popup>
              <CitizenPopupCard traveler={traveler} />
            </Popup>
          </Marker>
        ))}

        {/* Aircraft layer — owns its own polling + smooth interpolation; toggled here */}
        <FlightLayer enabled={showFlights} />
      </MapContainer>

      {/* The single outbreak details component — same card the health panel opens */}
      {selectedOutbreak && (
        <OutbreakDetailCard f={selectedOutbreak} meta={fcMeta} onClose={() => setSelectedOutbreak(null)} />
      )}
    </>
  );
}
