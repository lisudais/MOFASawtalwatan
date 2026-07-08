import { SEQUENTIAL_GOLD } from '../../constants';

export interface BarDatum {
  label: string;
  value: number;
}

interface MiniBarChartProps {
  data: BarDatum[];
  unit?: string;
  formatValue?: (v: number) => string;
}

export default function MiniBarChart({ data, unit = '', formatValue }: MiniBarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <div className="mini-bar-chart">
      {data.map((d, i) => {
        const pct = Math.max(2, (d.value / max) * 100);
        const color = i === 0 ? SEQUENTIAL_GOLD[0] : SEQUENTIAL_GOLD[2];
        return (
          <div className="mini-bar-row" key={d.label}>
            <span className="mini-bar-label">{d.label}</span>
            <div className="mini-bar-track">
              <div className="mini-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="mini-bar-value">{fmt(d.value)}{unit}</span>
          </div>
        );
      })}
    </div>
  );
}
