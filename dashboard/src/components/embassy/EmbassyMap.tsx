import { MapContainer, TileLayer, Marker, Popup, Rectangle, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Globe, HeartPulse, Plane, Users } from 'lucide-react';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { eventDivIcon, travelerIcon } from '../WorldMap';
import MapLayersPanel, { type MapLayer } from '../MapLayersPanel';
import { useBoundariesGeoJson } from '../../services/geoBoundaries';
import { hospitalsForEmbassy, saudiPresencePoints } from '../../services/embassyFacilities';
import { PORT_STATUS_AR, PORT_STATUS_COLOR, type EmbassyConfig } from '../../services/embassies';
import type { GeoEvent, Traveler } from '../../types';

interface EmbassyMapProps {
  embassy: EmbassyConfig;
  events: GeoEvent[];       // already scope-filtered by the caller
  travelers: Traveler[];    // already scope-filtered by the caller
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
}

// Natural Earth 1:110m (already-simplified) world-country polygons — the same
// file WorldMap's risk-highlight layer uses. Swap this one constant for a
// more precise boundary source (e.g. a consulate-district polygon) later
// without touching any of the drawing logic below.
const EMBASSY_BOUNDARY_GEOJSON_URL = '/world-countries-110m.geojson';

const CYAN = '#7DD3FC';
const PRESENCE_GREEN = '#00E676';

// Distinct embassy marker — gold-accented building glyph so the mission itself
// is instantly distinguishable from the risk-colored incident circles, while
// staying inside the dashboard's existing color system (Saudi gold + navy).
const embassyIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width:34px;height:34px;border-radius:9px;
      background:rgba(10,22,40,0.92);border:2px solid #C9A84C;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 14px rgba(201,168,76,0.55);
    ">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9A84C"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/>
        <path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>
      </svg>
    </div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

// Hospital marker — same square-glyph language as embassyIcon, rose accent so
// it reads as "medical" without borrowing the app's danger-red risk color.
const hospitalIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width:26px;height:26px;border-radius:8px;
      background:rgba(10,22,40,0.92);border:2px solid #F43F5E;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 10px rgba(244,63,94,0.5);
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F43F5E"
        stroke-width="3.2" stroke-linecap="round">
        <path d="M12 3v18M3 12h18"/>
      </svg>
    </div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// Airport marker — same glyph language, cyan accent matching the app's
// existing flight-related color (aircraft markers, "حركة الطيران" toggle).
const airportIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width:26px;height:26px;border-radius:8px;
      background:rgba(10,22,40,0.92);border:2px solid ${CYAN};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 10px rgba(125,211,252,0.5);
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${CYAN}"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
      </svg>
    </div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function hasCoords(t: { lat: number; lng: number }): boolean {
  return Number.isFinite(t.lat) && Number.isFinite(t.lng) && (t.lat !== 0 || t.lng !== 0);
}

function FlyToSelection({ event }: { event: GeoEvent | null }) {
  const map = useMap();
  useEffect(() => {
    if (event && hasCoords(event)) {
      map.flyTo([event.lat, event.lng], Math.max(map.getZoom(), 6), { duration: 0.8 });
    }
  }, [event, map]);
  return null;
}

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

// Auto-frames the map to the host country's real boundary the first time it
// loads, replacing the old fixed embassy-centered zoom. Fires once per mount
// (guarded by the ref) so it doesn't fight a user's subsequent manual pan/
// zoom, and only once the real GeoJSON polygon (not the coarse bounds box)
// is available — that's what "fitBounds على GeoJSON حدود الدولة" means here.
function FitToBoundary({ feature }: { feature: FeatureCollection | null }) {
  const map = useMap();
  const firedRef = useRef(false);
  useEffect(() => {
    if (!feature || firedRef.current) return;
    const bounds = L.geoJSON(feature).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] });
      firedRef.current = true;
    }
  }, [feature, map]);
  return null;
}

// Host-country-focused map for the embassy sub-dashboard. Same tile layer,
// same event/traveler marker design, same fly-to + details-panel pattern as
// the main WorldMap — only the framing and the data scope differ.
export default function EmbassyMap({ embassy, events, travelers, selectedEvent, onSelectEvent }: EmbassyMapProps) {
  const { bounds } = embassy;

  const [layersOpen, setLayersOpen] = useState(false);
  const layersBtnRef = useRef<HTMLButtonElement>(null);
  // Boundary defaults on (it replaces what used to be an always-visible
  // rectangle); the three brand-new overlay layers default off so the map
  // doesn't suddenly look cluttered for existing sessions.
  const [showBoundary, setShowBoundary] = useState(true);
  const [showHospitals, setShowHospitals] = useState(false);
  const [showAirports, setShowAirports] = useState(false);
  const [showPresence, setShowPresence] = useState(false);

  const worldGeo = useBoundariesGeoJson(EMBASSY_BOUNDARY_GEOJSON_URL, showBoundary);
  const boundaryFeature = useMemo(() => {
    if (!worldGeo) return null;
    const f = worldGeo.features.find((f) => f.properties?.name === embassy.hostCountry);
    return f ? { type: 'FeatureCollection' as const, features: [f] } : null;
  }, [worldGeo, embassy.hostCountry]);

  const hospitals = useMemo(() => hospitalsForEmbassy(embassy.id), [embassy.id]);
  const airportPorts = useMemo(
    () => embassy.ports.filter((p) => p.type === 'AIRPORT' && p.coordinates),
    [embassy.ports],
  );
  const presencePoints = useMemo(() => saudiPresencePoints(embassy.id), [embassy.id]);

  function handleLayerToggle(id: string) {
    switch (id) {
      case 'boundary': setShowBoundary((v) => !v); break;
      case 'hospitals': setShowHospitals((v) => !v); break;
      case 'airports': setShowAirports((v) => !v); break;
      case 'presence': setShowPresence((v) => !v); break;
    }
  }

  const mapLayers: MapLayer[] = [
    { id: 'boundary', labelAr: 'حدود الدولة المضيفة', icon: <Globe size={13} />, enabled: showBoundary },
    { id: 'airports', labelAr: 'المطارات', icon: <Plane size={13} />, enabled: showAirports },
    { id: 'hospitals', labelAr: 'المستشفيات الرئيسية', icon: <HeartPulse size={13} />, enabled: showHospitals, accentColor: '#F43F5E' },
    { id: 'presence', labelAr: 'تواجد السعوديين (تمثيلي)', icon: <Users size={13} />, enabled: showPresence, accentColor: PRESENCE_GREEN },
  ];
  const activeLayerCount = mapLayers.filter((l) => l.enabled).length;

  return (
    <>
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

      <MapContainer
        center={[embassy.coordinates.lat, embassy.coordinates.lng]}
        zoom={embassy.mapZoom}
        minZoom={3}
        zoomControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="" />
        <FlyToSelection event={selectedEvent} />
        <MapResizeObserver />
        <FitToBoundary feature={boundaryFeature} />

        {/* Embassy scope boundary — real country-shaped outline (Natural Earth
            110m), replacing the old dashed bounding-box rectangle. Falls back
            to the rectangle only if the polygon can't be resolved (fetch
            failed, or a future host country isn't in the 110m set). */}
        {showBoundary && (
          boundaryFeature ? (
            <GeoJSON
              key={embassy.id}
              data={boundaryFeature}
              style={() => ({ color: '#C9A84C', weight: 1.5, opacity: 0.55, fillColor: '#C9A84C', fillOpacity: 0.05 })}
            />
          ) : (
            <Rectangle
              bounds={[[bounds.latMin, bounds.lngMin], [bounds.latMax, bounds.lngMax]]}
              pathOptions={{ color: '#C9A84C', weight: 1, opacity: 0.35, fillOpacity: 0.02, dashArray: '6 6' }}
            />
          )
        )}

        {/* Airports — the same port records/status shown in "المطارات والحدود"
            (services/embassies.ts), just plotted at their real coordinates
            instead of listed in a panel. No separate data source. */}
        {showAirports && airportPorts.map((p) => (
          <Marker key={p.nameAr} position={[p.coordinates!.lat, p.coordinates!.lng]} icon={airportIcon}>
            <Popup>
              <div dir="rtl" className="flight-popup">
                <strong>{p.nameAr}</strong>
                <div>
                  مطار ·{' '}
                  <span style={{ color: PORT_STATUS_COLOR[p.status], fontWeight: 700 }}>
                    {PORT_STATUS_AR[p.status]}
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Hospitals — mock/representative, see services/embassyFacilities.ts
            TODO for the real facility-registry source this should become. */}
        {showHospitals && hospitals.map((h) => (
          <Marker key={h.id} position={[h.lat, h.lng]} icon={hospitalIcon}>
            <Popup>
              <div dir="rtl" className="flight-popup">
                <strong>{h.nameAr}</strong>
                <div>مستشفى · {h.cityAr}</div>
                {h.addressAr && <div style={{ opacity: 0.7 }}>{h.addressAr}</div>}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Saudi presence — deterministic representative scatter, not real
            individual positions (services/embassyFacilities.ts). Small,
            translucent, uniform dots read as "general area," not tracking. */}
        {showPresence && presencePoints.map((pt, i) => (
          <CircleMarker
            key={i}
            center={[pt.lat, pt.lng]}
            radius={5}
            pathOptions={{ color: PRESENCE_GREEN, weight: 0, fillColor: PRESENCE_GREEN, fillOpacity: 0.25 }}
            interactive={false}
          />
        ))}

        {/* The mission itself — distinct marker */}
        <Marker position={[embassy.coordinates.lat, embassy.coordinates.lng]} icon={embassyIcon} zIndexOffset={2000}>
          <Popup>
            <strong>{embassy.nameAr}</strong>
            <br />
            {embassy.cityAr} · {embassy.hostCountryAr}
          </Popup>
        </Marker>

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

        {travelers.map((t) => (
          <Marker key={t.id} position={[t.lat, t.lng]} icon={travelerIcon}>
            <Popup>
              <strong>{t.nameAr}</strong>
              <br />
              {t.destination} · {t.status}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  );
}
