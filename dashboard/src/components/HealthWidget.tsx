import { useState, useEffect } from 'react';
import { HeartPulse } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';
import AiInsightPanel from './AiInsightPanel';
import MiniBarChart from './charts/MiniBarChart';
import { fetchHealthSnapshot } from '../services/health';
import { HEALTH_SOURCE_LINKS } from '../constants';
import type { HealthSnapshot } from '../types';

export default function HealthWidget() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await fetchHealthSnapshot();
      if (!cancelled) setSnapshot(data);
    }
    load();
    const interval = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const buildSummary = () => {
    if (!snapshot) return 'لا توجد بيانات متاحة حاليًا.';
    const top = snapshot.topCountries.map((c) => `${c.country}: ${c.cases.toLocaleString()} حالة`).join('، ');
    return `الحالات النشطة عالميًا: ${snapshot.activeCases.toLocaleString()}، الوفيات: ${snapshot.deaths.toLocaleString()}، عدد الدول المتأثرة: ${snapshot.affectedCountries}.\nأعلى الدول من حيث الحالات: ${top}`;
  };

  return (
    <CollapsibleSection
      icon={<HeartPulse size={14} />}
      titleEn="Global Health Watch"
      titleAr="الرصد الصحي"
    >
      {!snapshot ? (
        <div className="widget-empty-state">جارِ تحميل البيانات الصحية…</div>
      ) : (
        <>
          <div className="health-tiles">
            <div className="health-tile">
              <span className="health-tile-value">{snapshot.activeCases.toLocaleString()}</span>
              <span className="health-tile-label">Active · نشطة</span>
            </div>
            <div className="health-tile">
              <span className="health-tile-value">{snapshot.deaths.toLocaleString()}</span>
              <span className="health-tile-label">Deaths · وفيات</span>
            </div>
            <div className="health-tile">
              <span className="health-tile-value">{snapshot.affectedCountries}</span>
              <span className="health-tile-label">Countries · دول</span>
            </div>
          </div>
          <MiniBarChart
            data={snapshot.topCountries.map((c) => ({ label: c.country, value: c.cases }))}
            formatValue={(v) => v.toLocaleString()}
          />
        </>
      )}
      <div className="source-badge-row">
        {HEALTH_SOURCE_LINKS.map((s) => (
          <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="source-badge">{s.name}</a>
        ))}
      </div>

      <AiInsightPanel
        domainLabel="الصحة العالمية"
        buildSummary={buildSummary}
        sourceNames={['disease.sh (JHU CSSE)']}
      />
    </CollapsibleSection>
  );
}
