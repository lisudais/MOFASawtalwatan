import { X } from 'lucide-react';
import { RISK_COLORS } from '../constants';
import type { Notification } from '../types';

interface NotificationToastProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

export default function NotificationToast({ notifications, onDismiss }: NotificationToastProps) {
  const visible = notifications.slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="toast-stack">
      {visible.map((n) => (
        <div key={n.id} className="toast-card" style={{ borderColor: RISK_COLORS[n.riskLevel] }}>
          <button className="toast-close" onClick={() => onDismiss(n.id)}><X size={12} /></button>
          <div className="toast-title">{n.eventTitle}</div>
          <div className="toast-body">{n.messageAr}</div>
        </div>
      ))}
    </div>
  );
}
