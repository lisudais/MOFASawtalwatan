import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { CategoryInsight } from '../../types';

interface RadialGaugeProps {
  value: number; // 0-100
  trend: CategoryInsight['trend'];
  color: string;
  size?: number;
  unit?: string;
  showTrend?: boolean; // hide the embedded trend icon when it's rendered separately beside the gauge instead
}

const R = 32;
const STROKE = 6;
const CIRC = 2 * Math.PI * R;
const ARC_FRACTION = 270 / 360;
const TRACK_LENGTH = CIRC * ARC_FRACTION;

const TREND_ICON = { RISING: TrendingUp, STABLE: Minus, FALLING: TrendingDown };

export default function RadialGauge({ value, trend, color, size = 76, unit = '', showTrend = true }: RadialGaugeProps) {
  const valueLength = TRACK_LENGTH * Math.max(0, Math.min(100, value)) / 100;
  const TrendIcon = TREND_ICON[trend];

  return (
    <div className="radial-gauge" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" width={size} height={size}>
        <circle
          cx={40} cy={40} r={R}
          fill="none" stroke="var(--border)" strokeWidth={STROKE}
          strokeDasharray={`${TRACK_LENGTH} ${CIRC - TRACK_LENGTH}`}
          strokeLinecap="round"
          transform="rotate(135 40 40)"
        />
        <circle
          cx={40} cy={40} r={R}
          fill="none" stroke={color} strokeWidth={STROKE}
          strokeDasharray={`${valueLength} ${CIRC - valueLength}`}
          strokeLinecap="round"
          transform="rotate(135 40 40)"
        />
        <text x={40} y={38} textAnchor="middle" className="radial-gauge-value">{value}{unit}</text>
        {showTrend && (
          <foreignObject x={28} y={44} width={24} height={16}>
            <div className="radial-gauge-trend" style={{ color }}>
              <TrendIcon size={11} />
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
