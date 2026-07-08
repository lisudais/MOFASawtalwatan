import { useState, useEffect, useMemo, useCallback } from 'react';
import { Globe2, Clock, MapPin, Zap, AlertTriangle, X, Sparkles, Link2, RefreshCw, Siren } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';
import AiInsightPanel from './AiInsightPanel';
import AiSituationReportCard from './AiSituationReportCard';
import RadialGauge from './charts/RadialGauge';
import MiniLineChart from './charts/MiniLineChart';
import { fetchCategoryInsights, type SituationReportStats } from '../services/aiInsight';
import { scoreToRiskLevel } from '../services/riskEngine';
import {
  computeRateComparison, computeTopRegions, computeAnomalyScore,
  computeSeverityIndex, computeSourceCoverage, computeOverallIndex,
} from '../services/analytics/disasterStats';
import { recordDailySnapshot, getCategoryHistory } from '../services/history';
import { useSituationReport } from '../hooks/useSituationReport';
import { RISK_COLORS, TYPE_ICON, TYPE_LABEL_AR, DISASTER_TYPES, TREND_ICON, TREND_COLOR } from '../constants';
import type { GeoEvent, RiskLevel, CategoryInsightsResult, Traveler } from '../types';

interface DisasterWidgetProps {
  events: GeoEvent[];
  travelers: Traveler[];
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
}

const ALL_SOURCES = ['GDACS', 'USGS', 'EONET', 'EMSC'];
const PRIORITY: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, SAFE: 4 };
const RATE_WINDOW_DAYS = 7;

const CACHE_KEY = 'ai-disaster-insights-cache';
const CACHE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const RISK_BREAKDOWN_LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dailySeries(list: GeoEvent[], days: number, valueFn: (dayEvents: GeoEvent[]) => number): { x: number; y: number }[] {
  const now = Date.now();
  const startOfToday = now - (now % DAY_MS);
  const points: { x: number; y: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfToday - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const dayEvents = list.filter((e) => e.timestamp.getTime() >= dayStart && e.timestamp.getTime() < dayEnd);
    points.push({ x: dayStart, y: valueFn(dayEvents) });
  }
  return points;
}

function loadCache(): CategoryInsightsResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function DisasterWidget({ events, travelers, selectedEvent, onSelectEvent }: DisasterWidgetProps) {
  const [selectedType, setSelectedType] = useState<GeoEvent['type'] | null>(null);
  const [aiResult, setAiResult] = useState<CategoryInsightsResult | null>(() => {
    const cached = loadCache();
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) return cached;
    return null;
  });
  const [refreshing, setRefreshing] = useState(false);

  const disasterEvents = useMemo(
    () => events.filter((e) => DISASTER_TYPES.includes(e.type)),
    [events]
  );

  const cards = useMemo(() => {
    const now = Date.now();
    return DISASTER_TYPES.map((type) => {
      const ofType = disasterEvents.filter((e) => e.type === type);
      const last6h = ofType.filter((e) => now - e.timestamp.getTime() <= SIX_HOURS_MS).length;
      const last24h = ofType.filter((e) => now - e.timestamp.getTime() <= DAY_MS).length;
      const prev24h = ofType.filter((e) => {
        const age = now - e.timestamp.getTime();
        return age > DAY_MS && age <= DAY_MS * 2;
      }).length;
      const maxScore = Math.max(0, ...ofType.map((e) => e.score));
      const avgScore = ofType.length > 0 ? Math.round(ofType.reduce((s, e) => s + e.score, 0) / ofType.length) : 0;
      const riskLevel = ofType.length > 0 ? scoreToRiskLevel(maxScore) : 'SAFE';
      const sources = computeSourceCoverage(ofType, ALL_SOURCES);
      const riskCounts = Object.fromEntries(
        RISK_BREAKDOWN_LEVELS.map((lvl) => [lvl, ofType.filter((e) => e.riskLevel === lvl).length])
      ) as Record<RiskLevel, number>;
      return { type, count: ofType.length, last6h, last24h, prev24h, riskLevel, avgScore, sources, riskCounts };
    });
  }, [disasterEvents]);

  const overallIndex = useMemo(
    () => computeOverallIndex(cards.map((c) => ({ count: c.count, avgScore: c.avgScore, trend: aiResult?.categories[c.type]?.trend }))),
    [cards, aiResult]
  );

  const buildCategorySummary = useCallback(() => cards
    .map((c) => {
      const riskBreakdown = RISK_BREAKDOWN_LEVELS.map((lvl) => `${lvl}: ${c.riskCounts[lvl]}`).join(', ');
      return `${c.type}: العدد الحالي ${c.count} (${riskBreakdown})، آخر 6 ساعات ${c.last6h}، آخر 24 ساعة ${c.last24h}، الـ24 ساعة السابقة لها ${c.prev24h}`;
    })
    .join('\n'), [cards]);

  const loadInsights = useCallback(async () => {
    const summary = buildCategorySummary();
    const result = await fetchCategoryInsights(DISASTER_TYPES, summary, ALL_SOURCES);
    if (result) {
      setAiResult(result);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* storage unavailable */ }
    }
    return result;
  }, [buildCategorySummary]);

  async function handleForceRefresh() {
    setRefreshing(true);
    try { await loadInsights(); } finally { setRefreshing(false); }
  }

  // Real historical archive: records once per calendar day (safe to call every render).
  useEffect(() => {
    if (disasterEvents.length === 0) return;
    const counts: Record<string, number> = {};
    for (const c of cards) counts[c.type] = c.count;
    recordDailySnapshot(counts);
  }, [cards, disasterEvents.length]);

  useEffect(() => {
    if (disasterEvents.length === 0) return;

    const cached = loadCache();
    const age = cached ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
    if (age < CACHE_TTL_MS) {
      const timeout = setTimeout(loadInsights, CACHE_TTL_MS - age);
      const interval = setInterval(loadInsights, CACHE_TTL_MS);
      return () => { clearTimeout(timeout); clearInterval(interval); };
    }

    loadInsights();
    const interval = setInterval(loadInsights, CACHE_TTL_MS);
    return () => clearInterval(interval);
  }, [disasterEvents.length, loadInsights]);

  const filtered = useMemo(() => {
    if (!selectedType) return [];
    return [...disasterEvents]
      .filter((e) => e.type === selectedType)
      .sort((a, b) => PRIORITY[a.riskLevel] - PRIORITY[b.riskLevel] || b.timestamp.getTime() - a.timestamp.getTime());
  }, [disasterEvents, selectedType]);

  const drilldownCharts = useMemo(() => {
    if (!selectedType) return null;
    const ofType = disasterEvents.filter((e) => e.type === selectedType);
    const countSeries = dailySeries(ofType, 14, (d) => d.length);
    const severitySeries = dailySeries(ofType, 14, (d) => d.length > 0 ? Math.round(d.reduce((s, e) => s + e.score, 0) / d.length) : 0);
    return { countSeries, severitySeries };
  }, [disasterEvents, selectedType]);

  const situationStats: SituationReportStats | null = useMemo(() => {
    if (!selectedType) return null;
    const ofType = disasterEvents.filter((e) => e.type === selectedType);
    const rate = computeRateComparison(ofType, RATE_WINDOW_DAYS);
    const topRegions = computeTopRegions(ofType, 5);
    const history = getCategoryHistory(selectedType);
    const anomaly = computeAnomalyScore(history, rate.current);
    return { categoryLabelAr: TYPE_LABEL_AR[selectedType], rate, topRegions, anomaly, windowDays: RATE_WINDOW_DAYS };
  }, [disasterEvents, selectedType]);

  const severityIndex = useMemo(() => {
    if (!selectedType) return null;
    const ofType = disasterEvents.filter((e) => e.type === selectedType);
    return computeSeverityIndex(ofType, travelers);
  }, [disasterEvents, selectedType, travelers]);

  const situationReportQuery = useSituationReport(selectedType, situationStats, ALL_SOURCES);

  const buildOverallSummary = () => {
    const byType = cards.map((c) => `${c.type}: ${c.count}`).join('، ');
    const top5 = [...disasterEvents]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((e) => `${e.title} (${e.country || 'غير معروف'}, ${e.riskLevel}, مصدر ${e.source})`)
      .join(' | ');
    return `عدد الأحداث حسب النوع: ${byType}.\nأبرز 5 أحداث حسب الخطورة: ${top5}`;
  };

  return (
    <CollapsibleSection
      icon={<Globe2 size={14} />}
      titleEn="Natural Disasters"
      titleAr="الكوارث الطبيعية"
      badge={<span className="panel-badge">{disasterEvents.length}</span>}
    >
      <div className="terminal-header">
        <div className="terminal-header-total">
          <span className="terminal-header-total-num mono-num">{disasterEvents.length}</span>
          <span className="terminal-header-total-label">EVENTS</span>
        </div>
        <span className="terminal-live-badge">
          <span className="live-pulse" /> LIVE
        </span>
        <button className="terminal-refresh-btn" onClick={handleForceRefresh} disabled={refreshing} title="تحديث الآن">
          <RefreshCw size={12} className={refreshing ? 'spin-icon' : ''} />
        </button>
        <RadialGauge value={overallIndex.value} trend={overallIndex.trend} color={RISK_COLORS[scoreToRiskLevel(overallIndex.value)]} />
      </div>

      {aiResult?.priorityAlert && (
        <div className="priority-alert-banner">
          <Siren size={12} />
          يتطلب انتباهًا فوريًا: <strong>{TYPE_LABEL_AR[aiResult.priorityAlert as GeoEvent['type']] ?? aiResult.priorityAlert}</strong>
        </div>
      )}

      {(aiResult?.forecast || aiResult?.correlation) && (
        <div className="ai-forecast-callout">
          {aiResult.forecast && (
            <div className="ai-forecast-row"><Sparkles size={11} /> {aiResult.forecast}</div>
          )}
          {aiResult.correlation && (
            <div className="ai-forecast-row correlation"><Link2 size={11} /> {aiResult.correlation}</div>
          )}
        </div>
      )}

      <div className="terminal-row-list">
        {cards.map((c) => {
          const Icon = TYPE_ICON[c.type];
          const color = RISK_COLORS[c.riskLevel];
          const insight = aiResult?.categories[c.type];
          const TrendIcon = insight ? TREND_ICON[insight.trend] : null;
          const active = selectedType === c.type;

          return (
            <div key={c.type} className="terminal-row-wrap">
              <div
                className={`terminal-row${active ? ' active' : ''}`}
                onClick={() => setSelectedType(active ? null : c.type)}
              >
                <span className="terminal-accent-bar" style={{ background: color }} />
                <Icon size={14} className="terminal-row-icon" />
                <div className="terminal-row-name">
                  <span className="terminal-row-name-ar">
                    {TYPE_LABEL_AR[c.type]}
                    {insight?.severityFlag && <Zap size={9} className="terminal-severity-flag" />}
                  </span>
                  <span className="terminal-row-name-en">{c.type}</span>
                </div>
                <span className="terminal-row-count mono-num">{c.count}</span>
                <span className="terminal-row-trend" style={{ color: insight ? TREND_COLOR[insight.trend] : 'var(--text-muted)' }}>
                  {TrendIcon ? <TrendIcon size={12} /> : '—'}
                </span>
                <span className="terminal-row-sources mono-num">{c.sources.count}/{c.sources.total} Sources</span>
                <span className="terminal-row-score mono-num" style={{ borderColor: color, color }}>{c.avgScore}</span>
              </div>

              {active && (
                <div className="terminal-accordion">
                  <div className="disaster-drilldown-header">
                    <span>{TYPE_LABEL_AR[selectedType!]} · {selectedType}</span>
                    {severityIndex !== null && (
                      <span className="severity-index-badge mono-num" title="مؤشر الخطورة المركب = عدد الأحداث × متوسط الشدة × قرب المسافرين المتتبَعين">
                        مؤشر الخطورة: {severityIndex}
                      </span>
                    )}
                    <button className="disaster-drilldown-close" onClick={(e) => { e.stopPropagation(); setSelectedType(null); }}><X size={13} /></button>
                  </div>

                  {insight?.summary && <div className="terminal-quick-summary">{insight.summary}</div>}

                  <AiSituationReportCard
                    report={situationReportQuery.data}
                    isFetching={situationReportQuery.isFetching}
                    isError={situationReportQuery.isError}
                    onRefresh={() => situationReportQuery.refetch()}
                  />

                  {drilldownCharts && (
                    <div className="drilldown-charts">
                      <div className="drilldown-chart-block">
                        <div className="drilldown-chart-title">عدد الأحداث عبر الزمن (14 يوم)</div>
                        <MiniLineChart series={[{ name: 'العدد', color, points: drilldownCharts.countSeries }]} />
                      </div>
                      <div className="drilldown-chart-block">
                        <div className="drilldown-chart-title">مستوى الخطورة عبر الزمن (14 يوم)</div>
                        <MiniLineChart series={[{ name: 'الخطورة', color: RISK_COLORS.HIGH, points: drilldownCharts.severitySeries }]} />
                      </div>
                    </div>
                  )}

                  <div className="disaster-list">
                    {filtered.length === 0 && <div className="widget-empty-state">لا توجد أحداث لهذا التصنيف حاليًا.</div>}
                    {filtered.map((event) => {
                      const eColor = RISK_COLORS[event.riskLevel];
                      const isSelected = selectedEvent?.id === event.id;
                      const EIcon = TYPE_ICON[event.type];
                      return (
                        <div
                          key={event.id}
                          className={`feed-item${isSelected ? ' selected' : ''}`}
                          style={{ borderLeftColor: eColor }}
                          onClick={() => onSelectEvent(event)}
                        >
                          <div className="feed-icon-wrap" style={{ color: eColor }}>
                            <EIcon size={16} />
                          </div>
                          <div className="feed-body">
                            <div className="feed-title">{event.title}</div>
                            <div className="feed-meta">
                              <span className="feed-country">
                                <MapPin size={9} /> {event.country || 'Unknown'}
                              </span>
                              <span className="feed-source">{event.source}</span>
                              <span className="feed-time">
                                <Clock size={9} />
                                {timeAgo(event.timestamp)}
                              </span>
                            </div>
                            <div className="feed-score-row">
                              <span className="risk-badge" style={{ background: eColor + '22', color: eColor, border: `1px solid ${eColor}` }}>
                                {event.riskLevel === 'CRITICAL' && <Zap size={9} />}
                                {event.riskLevel}
                              </span>
                              <div className="score-bar">
                                <div className="score-fill" style={{ width: `${event.score}%`, background: eColor }} />
                              </div>
                              <span className="score-num" style={{ color: eColor }}>{event.score}</span>
                            </div>
                          </div>
                          {event.riskLevel === 'CRITICAL' && (
                            <div className="critical-indicator">
                              <AlertTriangle size={14} color="#FF1744" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AiInsightPanel
        domainLabel="الكوارث الطبيعية"
        buildSummary={buildOverallSummary}
        sourceNames={ALL_SOURCES}
      />
    </CollapsibleSection>
  );
}
