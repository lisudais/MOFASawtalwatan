import { MapContainer, TileLayer, CircleMarker, GeoJSON, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Plane, ShieldAlert, FlaskConical } from 'lucide-react';
import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { RISK_COLORS } from '../constants';
import type { GeoEvent, Traveler, RiskLevel } from '../types';
import { fetchFlights, type Flight } from '../services/opensky';
import { centroidFor, iso3For, ISO3_WITHOUT_POLYGON } from '../services/feed/countryCentroids';
import { countryNameAr } from '../services/feed/countryNames';

/** Per-country risk from App: max Stage 5 score + the category that produced it. */
export interface CountryRisk {
  score: number;
  category: string;
  byCategory: Record<string, number>;
}

interface WorldMapProps {
  events: GeoEvent[];
  travelers: Traveler[];
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
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

/* ── EXPERIMENTAL predicted-risk placeholder ─────────────────────────────────
   NOT A REAL FORECAST. There is no trained prediction model yet. These are
   fixed demo values, decoupled from the real pipeline on purpose, shown only to
   prototype the eventual predicted-risk layer. The UI labels this layer
   "تنبؤ تجريبي — نموذج قيد التطوير" and renders it in a deliberately different
   style (dashed, low-opacity, blue) so it can never be mistaken for real risk.
   Replace this constant with a real model output when one exists. */
const EXPERIMENTAL_PREDICTED_RISK: Record<string, number> = {
  IR: 78, SD: 72, LB: 68, YE: 74, ET: 61, ML: 66, PK: 59, UA: 81, MM: 63,
};

const RED = '#FF1744';
const BLUE = '#3B82F6';

/** Lazily fetches the world-countries boundary GeoJSON from public/ (once). */
function useWorldBoundaries(enabled: boolean): FeatureCollection | null {
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!enabled || geo) return;
    let cancelled = false;
    fetch('/world-countries-110m.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setGeo(d); })
      .catch(() => { /* layer just won't draw polygons; centroid fallback still works */ });
    return () => { cancelled = true; };
  }, [enabled, geo]);
  return geo;
}

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

// Aircraft marker — deliberately distinct from the round risk markers: a small
// plane glyph rotated to the flight heading, in a cool cyan that reads clearly
// on the dark map and never collides with the risk colour palette.
function aircraftIcon(heading: number | null): L.DivIcon {
  const rot = typeof heading === 'number' ? heading : 0;
  return new L.DivIcon({
    className: 'aircraft-map-icon',
    html:
      `<div class="aircraft-glyph" style="transform:rotate(${rot}deg)">` +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="#7DD3FC" stroke="#0A1628" stroke-width="0.6">' +
      '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L11 19v-5.5z"/>' +
      '</svg></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const na = (v: unknown): string =>
  v === null || v === undefined || v === '' ? 'غير متاح' : String(v);

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
  events, travelers, selectedEvent, onSelectEvent, selectedTraveler, countryRisk = {},
}: WorldMapProps) {
  // ── Flight monitoring (isolated from alert/risk state) ──────────────────
  const [showFlights, setShowFlights] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  // ── Risk highlight layers — mutually exclusive with each other, independent
  //    of the flight layer. 'none' | 'current' (real RED) | 'predicted' (BLUE). ──
  const [riskLayer, setRiskLayer] = useState<RiskLayer>('none');

  useEffect(() => {
    if (!showFlights) return;
    let cancelled = false;
    const load = async () => {
      const data = await fetchFlights();
      if (!cancelled) setFlights(data);
    };
    load();
    const id = setInterval(load, 15000); // safe 15s refresh
    return () => { cancelled = true; clearInterval(id); };
  }, [showFlights]);

  const toggleLayer = (layer: RiskLayer) =>
    setRiskLayer((cur) => (cur === layer ? 'none' : layer));

  const worldGeo = useWorldBoundaries(riskLayer !== 'none');

  const redCountries = riskLayer === 'current' ? riskCountries(countryRisk, RISK_HIGHLIGHT_THRESHOLD) : [];
  const blueCountries = riskLayer === 'predicted'
    ? riskCountries(
        Object.fromEntries(Object.entries(EXPERIMENTAL_PREDICTED_RISK).map(([k, v]) => [k, { score: v }])),
        0,
      )
    : [];
  const active = riskLayer === 'current' ? redCountries : riskLayer === 'predicted' ? blueCountries : [];
  const activeColor = riskLayer === 'predicted' ? BLUE : RED;
  const isPredicted = riskLayer === 'predicted';

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
      {/* Map layer controls — a single horizontal row (flight + two risk layers) */}
      <div className="map-toggle-row">
        <button
          type="button"
          className={`map-toggle-btn flight${showFlights ? ' active' : ''}`}
          onClick={() => setShowFlights((v) => !v)}
          title="مراقبة حركة الطيران"
        >
          <Plane size={13} />
          {showFlights ? 'إخفاء حركة الطيران' : 'حركة الطيران'}
        </button>
        <button
          type="button"
          className={`map-toggle-btn current${riskLayer === 'current' ? ' active' : ''}`}
          onClick={() => toggleLayer('current')}
          title="إبراز الدول عالية الخطورة وفق البيانات الحالية"
        >
          <ShieldAlert size={13} />
          {riskLayer === 'current' ? 'إخفاء طبقة الخطر' : 'طبقة الخطر الحالي'}
        </button>
        <button
          type="button"
          className={`map-toggle-btn predicted${riskLayer === 'predicted' ? ' active' : ''}`}
          onClick={() => toggleLayer('predicted')}
          title="طبقة تنبؤ تجريبية — ليست بيانات حقيقية"
        >
          <FlaskConical size={13} />
          {riskLayer === 'predicted' ? 'إخفاء التنبؤ' : 'تنبؤ تجريبي'}
        </button>
      </div>

      {/* Persistent, unmistakable disclaimer while the placeholder layer is on */}
      {riskLayer === 'predicted' && (
        <div className="predict-banner" dir="rtl">
          <FlaskConical size={12} />
          تنبؤ تجريبي — نموذج قيد التطوير (ليست بيانات حقيقية)
        </div>
      )}

      <MapContainer center={[20, 30]} zoom={2.4} minZoom={2} worldCopyJump style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution=""
        />
        <FlyToSelection event={selectedEvent} traveler={selectedTraveler} />
        <MapResizeObserver />

        {/* Risk highlight — country-polygon shading. RED = real Stage 5 risk
            (solid fill). BLUE = experimental placeholder (dashed, low opacity,
            plus the banner above). Only the active layer renders. */}
        {polyFeatures && polyFeatures.features.length > 0 && (
          <GeoJSON
            key={polyKey}
            data={polyFeatures}
            style={() => ({
              color: activeColor,
              weight: isPredicted ? 1.5 : 1,
              dashArray: isPredicted ? '5 4' : undefined,
              fillColor: activeColor,
              fillOpacity: isPredicted ? 0.15 : 0.35,
            })}
            onEachFeature={(feature: Feature, layer) => {
              const c = byIso3.get(String(feature.id));
              if (!c) return;
              const name = countryNameAr(c.iso2);
              if (isPredicted) {
                layer.bindPopup(
                  `<div dir="rtl" class="flight-popup"><strong>${name}</strong>` +
                  `<div style="color:${BLUE};font-weight:700">تنبؤ تجريبي — نموذج قيد التطوير</div>` +
                  `<div>قيمة تجريبية: ${c.score}/100 (ليست بيانات حقيقية)</div></div>`
                );
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
                color: activeColor,
                weight: 1.5,
                dashArray: isPredicted ? '4 4' : undefined,
                fillColor: activeColor,
                fillOpacity: isPredicted ? 0.15 : 0.3,
              }}
            >
              <Popup>
                <div dir="rtl" className="flight-popup">
                  <strong>{countryNameAr(c.iso2)}</strong>
                  {isPredicted ? (
                    <>
                      <div style={{ color: BLUE, fontWeight: 700 }}>تنبؤ تجريبي — نموذج قيد التطوير</div>
                      <div>قيمة تجريبية: {c.score}/100 (ليست بيانات حقيقية)</div>
                    </>
                  ) : (
                    <div>مستوى الخطر: {c.score}/100 — المصدر: {c.category ? (CATEGORY_AR[c.category] ?? c.category) : 'غير محدد'}</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {events.map((event) => {
          const isSelected = selectedEvent?.id === event.id;
          return (
            <Marker
              key={event.id}
              position={[event.lat, event.lng]}
              icon={eventDivIcon(event, isSelected)}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => onSelectEvent(event) }}
            >
              <Popup>
                <strong>{event.title}</strong>
                <br />
                {event.country} · {event.riskLevel}
              </Popup>
            </Marker>
          );
        })}

        {travelers.map((traveler) => (
          <Marker key={traveler.id} position={[traveler.lat, traveler.lng]} icon={travelerIcon}>
            <Popup>
              <strong>{traveler.nameEn}</strong>
              <br />
              {traveler.destination} · {traveler.status}
            </Popup>
          </Marker>
        ))}

        {/* Aircraft markers — only when the toggle is enabled; hide only these */}
        {showFlights && flights.map((f) => (
          <Marker key={f.icao24} position={[f.latitude, f.longitude]} icon={aircraftIcon(f.heading)}>
            <Popup>
              <div dir="rtl" className="flight-popup">
                <strong>رحلة: {na(f.callsign)}</strong>
                <div>شركة الطيران: غير متاح</div>
                <div>المنشأ: {na(f.originCountry)}</div>
                <div>الوجهة: غير متاح</div>
                <div>الارتفاع: {f.baroAltitude != null ? `${Math.round(f.baroAltitude)} م` : 'غير متاح'}</div>
                <div>السرعة: {f.velocity != null ? `${Math.round(f.velocity * 3.6)} كم/س` : 'غير متاح'}</div>
                <div>آخر تحديث: {f.lastContact != null ? new Date(f.lastContact * 1000).toLocaleTimeString('ar-SA') : 'غير متاح'}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  );
}
