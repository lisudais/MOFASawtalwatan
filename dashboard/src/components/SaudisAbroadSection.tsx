import { useMemo, useState } from 'react';
import { getSaudisAbroadData } from '../services/mockData';

const COLLAPSED_ROW_COUNT = 4;

export default function SaudisAbroadSection() {
  const data = useMemo(() => getSaudisAbroadData(), []);
  const [expanded, setExpanded] = useState(false);

  const segments = [...data.countries.map((c) => ({ ...c, key: c.countryCode })), {
    key: 'OTHER',
    country: 'دول أخرى',
    countryCode: 'OTHER',
    count: data.otherCount,
    percentage: data.otherPercentage,
    color: data.otherColor,
  }];

  const visibleSegments = expanded ? segments : segments.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenCount = segments.length - COLLAPSED_ROW_COUNT;

  return (
    <div className="saudis-abroad-section">
      <div className="saudis-abroad-top">
        <span className="saudis-abroad-eyebrow">جميع المسجلين · All Registered</span>
        <span className="saudis-abroad-details-link">التفاصيل ›</span>
      </div>

      <div className="saudis-abroad-hero">
        <span className="saudis-abroad-flag">🇸🇦</span>
        <span className="saudis-abroad-total mono-num">{data.total.toLocaleString('en-US')}</span>
      </div>

      <div className="saudis-abroad-distribution">
        <div className="saudis-abroad-subtitle">التوزيع الجغرافي الحالي</div>
        <div className="saudis-abroad-bar">
          {segments.map((s) => (
            <div
              key={s.key}
              className="saudis-abroad-bar-segment"
              style={{ width: `${s.percentage}%`, background: s.color }}
              title={`${s.country}: ${s.percentage}%`}
            />
          ))}
        </div>
      </div>

      <div className="saudis-abroad-list">
        {visibleSegments.map((s) => (
          <div className="saudis-abroad-row" key={s.key}>
            <span className="saudis-abroad-dot" style={{ background: s.color }} />
            <span className="saudis-abroad-country">{s.country}</span>
            <span className="saudis-abroad-count mono-num">{s.count.toLocaleString('en-US')}</span>
            <span className="saudis-abroad-pct mono-num">{s.percentage}%</span>
          </div>
        ))}

        {!expanded && hiddenCount > 0 && (
          <button className="saudis-abroad-expand-toggle" onClick={() => setExpanded(true)}>
            عرض الكل ({segments.length}) ›
          </button>
        )}
        {expanded && (
          <button className="saudis-abroad-expand-toggle" onClick={() => setExpanded(false)}>
            عرض أقل ‹
          </button>
        )}
      </div>
    </div>
  );
}
