import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect, useState } from 'react';
import { Plane } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RISK_COLORS } from '../constants';
import type { GeoEvent, Traveler, RiskLevel } from '../types';
import { fetchFlights, type Flight } from '../services/opensky';

interface WorldMapProps {
  events: GeoEvent[];
  travelers: Traveler[];
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
  selectedTraveler: Traveler | null;
}

const travelerIcon = new L.DivIcon({
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
function eventDivIcon(event: GeoEvent, isSelected: boolean): L.DivIcon {
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

export default function WorldMap({ events, travelers, selectedEvent, onSelectEvent, selectedTraveler }: WorldMapProps) {
  // ── Flight monitoring (isolated from alert/risk state) ──────────────────
  const [showFlights, setShowFlights] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);

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

  return (
    <>
      {/* Flight monitoring toggle — map control, matches the dashboard style */}
      <button
        type="button"
        className={`flight-toggle-btn${showFlights ? ' active' : ''}`}
        onClick={() => setShowFlights((v) => !v)}
        title="مراقبة حركة الطيران"
      >
        <Plane size={13} />
        {showFlights ? 'إخفاء حركة الطيران' : 'إظهار حركة الطيران'}
      </button>

      <MapContainer center={[20, 30]} zoom={2.4} minZoom={2} worldCopyJump style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution=""
        />
        <FlyToSelection event={selectedEvent} traveler={selectedTraveler} />
        <MapResizeObserver />

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
