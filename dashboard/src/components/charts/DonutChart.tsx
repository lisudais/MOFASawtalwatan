interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  totalLabel?: string;
}

const SIZE = 100;
const R = 40;
const STROKE = 14;
const CIRC = 2 * Math.PI * R;

export default function DonutChart({ data, totalLabel }: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let cumulative = 0;

  return (
    <div className="donut-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="donut-svg">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--border)" strokeWidth={STROKE} opacity={0.3} />
        {total > 0 && data.filter((d) => d.value > 0).map((d) => {
          const frac = d.value / total;
          const length = frac * CIRC;
          const offset = cumulative * CIRC;
          cumulative += frac;
          return (
            <circle
              key={d.label}
              cx={SIZE / 2} cy={SIZE / 2} r={R}
              fill="none"
              stroke={d.color}
              strokeWidth={STROKE}
              strokeDasharray={`${length} ${CIRC - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              strokeLinecap="butt"
            />
          );
        })}
        <text x={SIZE / 2} y={SIZE / 2 - 3} textAnchor="middle" className="donut-total-num">{total}</text>
        {totalLabel && <text x={SIZE / 2} y={SIZE / 2 + 10} textAnchor="middle" className="donut-total-label">{totalLabel}</text>}
      </svg>
      <div className="donut-legend">
        {data.filter((d) => d.value > 0).map((d) => (
          <div className="donut-legend-item" key={d.label}>
            <span className="chart-legend-dot" style={{ background: d.color }} />
            <span className="donut-legend-label">{d.label}</span>
            <span className="donut-legend-pct">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
