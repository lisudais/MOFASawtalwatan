import { X, Users, MapPin, Clock, Radio } from 'lucide-react';
import { RISK_COLORS, RISK_LABEL_AR, TYPE_ICON } from '../constants';
import type { GeoEvent } from '../types';

interface EventDetailProps {
  event: GeoEvent;
  travelersAtRisk: number;
  onClose: () => void;
}

// Friendly source labels for the real feeds behind each event.
const SOURCE_LABEL: Record<GeoEvent['source'], string> = {
  GDACS: 'GDACS',
  USGS: 'USGS',
  EONET: 'NASA EONET',
  EMSC: 'EMSC',
  RELIEFWEB: 'ReliefWeb',
  ACLED: 'ACLED',
  MOCK: 'MOCK',
};

export default function EventDetail({ event, travelersAtRisk, onClose }: EventDetailProps) {
  const color = RISK_COLORS[event.riskLevel];
  const Icon = TYPE_ICON[event.type];

  return (
    <div className="event-detail-card">
      <button className="event-detail-close" onClick={onClose}><X size={16} /></button>
      <div className="event-detail-title">
        <Icon size={14} style={{ color, marginLeft: 6 }} />
        {event.title}
      </div>

      <div className="event-detail-row">
        <span className="risk-badge" style={{ background: color + '22', color, border: `1px solid ${color}` }}>
          {event.riskLevel} · {RISK_LABEL_AR[event.riskLevel]}
        </span>
        <span><MapPin size={11} /> {event.country}</span>
        <span><Clock size={11} /> {event.timestamp.toLocaleString()}</span>
      </div>

      <div className="event-detail-row">{event.description}</div>

      <div className="event-detail-row">
        <span><Radio size={11} /> المصدر: {SOURCE_LABEL[event.source] ?? event.source}</span>
      </div>

      {travelersAtRisk > 0 && (
        <div className="event-detail-row">
          <Users size={11} /> {travelersAtRisk} traveler(s) in this country
        </div>
      )}

      <div className="event-detail-action">{event.recommendedAction}</div>
    </div>
  );
}
