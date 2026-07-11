import { MapContainer, TileLayer, Marker, Popup, Rectangle, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { eventDivIcon, travelerIcon } from '../WorldMap';
import type { GeoEvent, Traveler } from '../../types';
import type { EmbassyConfig } from '../../services/embassies';

interface EmbassyMapProps {
  embassy: EmbassyConfig;
  events: GeoEvent[];       // already scope-filtered by the caller
  travelers: Traveler[];    // already scope-filtered by the caller
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
}

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

// Host-country-focused map for the embassy sub-dashboard. Same tile layer,
// same event/traveler marker design, same fly-to + details-panel pattern as
// the main WorldMap — only the framing and the data scope differ.
export default function EmbassyMap({ embassy, events, travelers, selectedEvent, onSelectEvent }: EmbassyMapProps) {
  const { bounds } = embassy;
  return (
    <MapContainer
      center={[embassy.coordinates.lat, embassy.coordinates.lng]}
      zoom={embassy.mapZoom}
      minZoom={3}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="" />
      <FlyToSelection event={selectedEvent} />
      <MapResizeObserver />

      {/* Embassy scope boundary — subtle gold outline of the covered area */}
      <Rectangle
        bounds={[[bounds.latMin, bounds.lngMin], [bounds.latMax, bounds.lngMax]]}
        pathOptions={{ color: '#C9A84C', weight: 1, opacity: 0.35, fillOpacity: 0.02, dashArray: '6 6' }}
      />

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
  );
}
