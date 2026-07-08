import { Share2, Download } from 'lucide-react';

interface CategoryPlaceholderCardProps {
  labelAr: string;
}

// Empty shell for a not-yet-wired category box — header only (name, count=0,
// live badge, share/download affordances), no data. Filled in later, one
// category at a time, by reusing the existing data-fetching services
// (DisasterWidget/EconomyWidget/HealthWidget's fetch logic etc.) — this
// component itself carries no data logic.
export default function CategoryPlaceholderCard({ labelAr }: CategoryPlaceholderCardProps) {
  return (
    <div className="region-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">0</span>
        <button className="region-icon-btn" disabled title="مشاركة">
          <Share2 size={13} />
        </button>
        <button className="region-icon-btn" disabled title="تنزيل">
          <Download size={13} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">{labelAr}</span>
        </div>
      </div>

      <div className="region-placeholder-body">بانتظار البيانات...</div>
    </div>
  );
}
