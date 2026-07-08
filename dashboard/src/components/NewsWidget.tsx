import { useState, useEffect } from 'react';
import { Newspaper, Clock } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';
import AiInsightPanel from './AiInsightPanel';
import MiniBarChart from './charts/MiniBarChart';
import { fetchNewsAnalysis, fetchNewsVolume } from '../services/news';
import { NEWS_SOURCE_LINKS } from '../constants';
import type { NewsArticle, VolumePoint } from '../types';

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NewsWidget() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [volume, setVolume] = useState<VolumePoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [articleData, volumeData] = await Promise.all([fetchNewsAnalysis(), fetchNewsVolume()]);
      if (!cancelled) {
        setArticles(articleData);
        setVolume(volumeData);
      }
    }
    load();
    const interval = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const buildSummary = () => {
    if (articles.length === 0) return 'لا توجد أخبار متاحة حاليًا.';
    const headlines = articles.slice(0, 10).map((a) => `${a.title} (${a.source})`).join(' | ');
    return `أحدث العناوين المرصودة: ${headlines}`;
  };

  const chartData = volume.slice(-10).map((v) => ({
    label: v.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    value: v.count,
  }));

  return (
    <CollapsibleSection
      icon={<Newspaper size={14} />}
      titleEn="News Analysis"
      titleAr="تحليل الأخبار"
      badge={<span className="panel-badge">{articles.length}</span>}
    >
      {chartData.length > 0 && <MiniBarChart data={chartData} formatValue={(v) => v.toFixed(2)} />}

      {articles.length === 0 ? (
        <div className="widget-empty-state">لا توجد أخبار متاحة حاليًا.</div>
      ) : (
        <div className="news-list">
          {articles.map((a) => (
            <a className="news-item" key={a.id} href={a.url} target="_blank" rel="noreferrer">
              <div className="news-title">{a.title}</div>
              <div className="news-meta">
                <span className="news-source">{a.source}</span>
                <span className="news-time"><Clock size={9} /> {timeAgo(a.seenDate)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
      <div className="source-badge-row">
        {NEWS_SOURCE_LINKS.map((s) => (
          <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="source-badge">{s.name}</a>
        ))}
      </div>

      <AiInsightPanel
        domainLabel="الأخبار"
        buildSummary={buildSummary}
        sourceNames={['GDELT (تجميع من وكالات ومنصات عالمية)']}
      />
    </CollapsibleSection>
  );
}
