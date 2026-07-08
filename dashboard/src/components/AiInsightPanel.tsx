import { useState } from 'react';
import { Brain, AlertTriangle, Activity, Search, CheckCircle2 } from 'lucide-react';
import { fetchAiInsight } from '../services/aiInsight';
import { RISK_COLORS, RISK_LABEL_AR } from '../constants';
import type { AiInsight, InsightHighlightKind } from '../types';

interface AiInsightPanelProps {
  domainLabel: string;
  buildSummary: () => string;
  sourceNames: string[];
}

const HIGHLIGHT_ICON: Record<InsightHighlightKind, React.ElementType> = {
  RISK: AlertTriangle,
  TREND: Activity,
  CAUSE: Search,
  ACTION: CheckCircle2,
};

const HIGHLIGHT_COLOR: Record<InsightHighlightKind, string> = {
  RISK: 'var(--danger-high)',
  TREND: 'var(--text-secondary)',
  CAUSE: 'var(--text-secondary)',
  ACTION: 'var(--danger-low)',
};

const HIGHLIGHT_LABEL_AR: Record<InsightHighlightKind, string> = {
  RISK: 'الخطر',
  TREND: 'الاتجاه',
  CAUSE: 'السبب',
  ACTION: 'الإجراء',
};

export default function AiInsightPanel({ domainLabel, buildSummary, sourceNames }: AiInsightPanelProps) {
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function analyze() {
    setLoading(true);
    setFailed(false);
    const result = await fetchAiInsight(domainLabel, buildSummary(), sourceNames);
    setLoading(false);
    if (!result) {
      setFailed(true);
      return;
    }
    setInsight(result);
  }

  return (
    <div className="ai-insight-panel">
      <button className="ai-analyze-btn" onClick={analyze} disabled={loading}>
        <Brain size={13} />
        {loading ? 'جاري التحليل بواسطة gpt-oss:20b…' : 'تحليل ذكي'}
      </button>

      {failed && (
        <div className="ai-insight-error">
          تعذر الوصول إلى Ollama المحلي — تأكد أنه يعمل على http://localhost:11434 وأن نموذج gpt-oss:20b متاح.
        </div>
      )}

      {insight && (
        <div className="ai-insight-result">
          <div className="ai-insight-header">
            <span
              className="risk-badge"
              style={{
                background: RISK_COLORS[insight.riskLevel] + '22',
                color: RISK_COLORS[insight.riskLevel],
                border: `1px solid ${RISK_COLORS[insight.riskLevel]}`,
              }}
            >
              {RISK_LABEL_AR[insight.riskLevel]}
            </span>
          </div>

          <div className="insight-highlight-list">
            {insight.highlights.map((h) => {
              const Icon = HIGHLIGHT_ICON[h.kind];
              const color = HIGHLIGHT_COLOR[h.kind];
              return (
                <div className="insight-highlight-row" key={h.kind}>
                  <Icon size={13} style={{ color }} />
                  <span className="insight-highlight-label" style={{ color }}>{HIGHLIGHT_LABEL_AR[h.kind]}</span>
                  <span className="insight-highlight-text">{h.text}</span>
                </div>
              );
            })}
          </div>

          {insight.sources.length > 0 && (
            <div className="ai-insight-sources">المصادر: {insight.sources.join('، ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
