import { Zap, AlertTriangle, Activity, Globe, Users, Bell } from 'lucide-react';
import type { DashboardStats } from '../types';

interface SidebarStatsGridProps {
  stats: DashboardStats;
}

export default function SidebarStatsGrid({ stats }: SidebarStatsGridProps) {
  // Ordered by severity first (Critical/Active alerts), then general counts.
  const items = [
    { icon: Zap,            labelAr: 'تنبيهات حرجة',   value: stats.criticalEvents,    color: 'var(--danger-critical)' },
    { icon: AlertTriangle,   labelAr: 'تنبيهات فعّالة',  value: stats.activeAlerts,      color: 'var(--danger-high)' },
    { icon: Activity,        labelAr: 'أحداث نشطة',     value: stats.totalEvents,       color: 'var(--saudi-gold)' },
    { icon: Globe,           labelAr: 'دول متأثرة',     value: stats.affectedCountries, color: 'var(--danger-high)' },
    { icon: Users,           labelAr: 'مسافرون في خطر', value: stats.travelersAtRisk,   color: 'var(--danger-medium)' },
    { icon: Bell,            labelAr: 'إشعارات مُرسلة', value: stats.notificationsSent, color: 'var(--saudi-light)' },
  ];

  return (
    <div className="sidebar-stats-grid">
      {items.map(({ icon: Icon, labelAr, value, color }) => (
        <div className="sidebar-stat-item" key={labelAr}>
          <div className="sidebar-stat-top">
            <Icon size={17} style={{ color }} />
            <span className="sidebar-stat-value mono-num" style={{ color }}>{value.toLocaleString()}</span>
          </div>
          <span className="sidebar-stat-label">{labelAr}</span>
        </div>
      ))}
    </div>
  );
}
