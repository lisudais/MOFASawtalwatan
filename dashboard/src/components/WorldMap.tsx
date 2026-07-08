import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RISK_COLORS } from '../constants';
import type { GeoEvent, Traveler } from '../types';

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

function FlyToSelection({ event, traveler }: { event: GeoEvent | null; traveler: Traveler | null }) {
  const map = useMap();
  useEffect(() => {
    const target = event ?? traveler;
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 4), { duration: 0.8 });
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
  return (
    <MapContainer center={[20, 30]} zoom={2.4} minZoom={2} worldCopyJump style={{ width: '100%', height: '100%' }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution=""
      />
      <FlyToSelection event={selectedEvent} traveler={selectedTraveler} />
      <MapResizeObserver />

      {events.map((event) => {
        const color = RISK_COLORS[event.riskLevel];
        const isSelected = selectedEvent?.id === event.id;
        return (
          <CircleMarker
            key={event.id}
            center={[event.lat, event.lng]}
            radius={isSelected ? 12 : 6 + event.score / 20}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: isSelected ? 0.6 : 0.35,
              weight: isSelected ? 2 : 1,
            }}
            eventHandlers={{ click: () => onSelectEvent(event) }}
          >
            <Popup>
              <strong>{event.title}</strong>
              <br />
              {event.country} · {event.riskLevel}
            </Popup>
          </CircleMarker>
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
    </MapContainer>
  );
}
