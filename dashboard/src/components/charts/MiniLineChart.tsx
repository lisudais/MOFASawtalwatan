import { useState, useRef } from 'react';
import type { PointerEvent } from 'react';

export interface LineSeries {
  name: string;
  color: string;
  points: { x: number; y: number }[]; // x = timestamp ms, y = value
}

interface MiniLineChartProps {
  series: LineSeries[];
  height?: number;
  unit?: string;
}

const VB_W = 300;
const VB_H = 110;
const PAD = 6;

export default function MiniLineChart({ series, height = 110, unit = '' }: MiniLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return null;

  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toX = (x: number) => PAD + ((x - xMin) / xRange) * (VB_W - PAD * 2);
  const toY = (y: number) => VB_H - PAD - ((y - yMin) / yRange) * (VB_H - PAD * 2);

  const pointCount = series[0]?.points.length ?? 0;

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * VB_W;
    const ratio = Math.min(1, Math.max(0, (relX - PAD) / (VB_W - PAD * 2)));
    const idx = Math.round(ratio * (pointCount - 1));
    setHoverIndex(Math.min(pointCount - 1, Math.max(0, idx)));
  }

  const hoverPoint = hoverIndex !== null ? series[0]?.points[hoverIndex] : null;

  return (
    <div className="mini-line-chart">
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span className="chart-legend-item" key={s.name}>
              <span className="chart-legend-dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD} x2={VB_W - PAD}
            y1={PAD + f * (VB_H - PAD * 2)} y2={PAD + f * (VB_H - PAD * 2)}
            stroke="var(--border)" strokeWidth={0.5}
          />
        ))}

        {series.map((s) => {
          const path = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x)},${toY(p.y)}`).join(' ');
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {last && <circle cx={toX(last.x)} cy={toY(last.y)} r={3} fill={s.color} />}
            </g>
          );
        })}

        {hoverIndex !== null && hoverPoint && (
          <line
            x1={toX(hoverPoint.x)} x2={toX(hoverPoint.x)}
            y1={PAD} y2={VB_H - PAD}
            stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2,2"
          />
        )}
      </svg>

      {hoverIndex !== null && (
        <div className="chart-tooltip">
          <div className="chart-tooltip-date">
            {series[0]?.points[hoverIndex] && new Date(series[0].points[hoverIndex].x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </div>
          {series.map((s) => (
            <div className="chart-tooltip-row" key={s.name}>
              <span className="chart-legend-dot" style={{ background: s.color }} />
              {s.name}: {s.points[hoverIndex!]?.y.toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
