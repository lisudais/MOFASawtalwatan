import { Users, MapPin, Phone, Send, UserPlus, CheckCircle, AlertTriangle, PlaneTakeoff } from 'lucide-react';
import type { Traveler, GeoEvent } from '../types';

interface TravelerPanelProps {
  travelers: Traveler[];
  events: GeoEvent[];
  onSendAlert: (travelerId: string) => void;
  onRegisterClick: () => void;
  onSelectTraveler: (t: Traveler) => void;
}

const STATUS_CONFIG: Record<Traveler['status'], { color: string; bg: string; label: string; labelEn: string; icon: React.ElementType }> = {
  ACTIVE:    { color: '#2979FF', bg: 'rgba(41,121,255,0.12)', label: 'نشط',    labelEn: 'ACTIVE',    icon: PlaneTakeoff },
  ALERTED:   { color: '#FF6D00', bg: 'rgba(255,109,0,0.12)',  label: 'تنبيه',   labelEn: 'ALERTED',   icon: AlertTriangle },
  EVACUATED: { color: '#FF1744', bg: 'rgba(255,23,68,0.12)',  label: 'إخلاء',   labelEn: 'EVACUATED', icon: AlertTriangle },
  SAFE:      { color: '#00E676', bg: 'rgba(0,230,118,0.12)',  label: 'آمن',     labelEn: 'SAFE',      icon: CheckCircle },
};

export default function TravelerPanel({ travelers, events, onSendAlert, onRegisterClick, onSelectTraveler }: TravelerPanelProps) {
  return (
    <div className="panel traveler-panel">
      <div className="panel-header">
        <Users size={14} />
        <span>Travelers Abroad</span>
        <span className="panel-header-ar">المسافرون بالخارج</span>
        <span className="panel-badge">{travelers.length}</span>
      </div>

      <button className="traveler-register-btn" onClick={onRegisterClick}>
        <UserPlus size={13} style={{ marginLeft: 6, verticalAlign: 'middle' }} />
        Register this device · تسجيل هذا الجهاز
      </button>

      <div className="traveler-list">
        {travelers.map((traveler) => {
          const cfg = STATUS_CONFIG[traveler.status];
          const StatusIcon = cfg.icon;
          const activeAlerts = events.filter((e) => traveler.alerts.includes(e.id));

          return (
            <div
              key={traveler.id}
              className="traveler-card"
              style={{ borderLeftColor: cfg.color }}
              onClick={() => onSelectTraveler(traveler)}
            >
              <div className="traveler-card-top">
                <div className="traveler-avatar">{traveler.nameEn.charAt(0)}</div>
                <span className="traveler-name">{traveler.nameEn}</span>
                <span className="traveler-status-pill" style={{ color: cfg.color, background: cfg.bg }}>
                  <StatusIcon size={9} style={{ marginLeft: 3, verticalAlign: 'text-bottom' }} />
                  {cfg.labelEn}
                </span>
              </div>

              <div className="traveler-details">
                <MapPin size={10} style={{ verticalAlign: 'text-bottom', marginLeft: 3 }} />
                {traveler.destination}
                {' · '}
                <Phone size={10} style={{ verticalAlign: 'text-bottom', marginLeft: 3 }} />
                {traveler.phone}
              </div>

              {activeAlerts.length > 0 && (
                <div className="traveler-tags">
                  {activeAlerts.map((e) => (
                    <span key={e.id} className="tc-alert-tag">{e.title}</span>
                  ))}
                </div>
              )}

              <div className="traveler-actions">
                <button
                  className="btn-validate"
                  style={{ flex: 1 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendAlert(traveler.id);
                  }}
                >
                  <Send size={11} /> Send Alert
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
