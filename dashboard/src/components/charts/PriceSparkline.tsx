interface PriceSparklineProps {
  values: number[];
  color: string;
  height?: number;
}

const VB_W = 100;

// Like MiniSparkline, but auto-scales to the data's own min/max (not a forced
// 0 baseline) so price movements of a few dollars on a $2000 asset stay
// visible, plus a soft gradient area fill for the premium financial look.
export default function PriceSparkline({ values, color, height = 30 }: PriceSparklineProps) {
  if (values.length < 2) return <div style={{ height }} />;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = VB_W / (values.length - 1);
  const toY = (v: number) => height - 2 - ((v - min) / range) * (height - 4);

  const pts = values.map((v, i) => `${i * step},${toY(v)}`);
  const line = 'M' + pts.join(' L');
  const area = `${line} L${VB_W},${height} L0,${height} Z`;
  const lastY = toY(values[values.length - 1]);
  const gradId = `eco-grad-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg viewBox={`0 0 ${VB_W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={VB_W} cy={lastY} r={1.8} fill={color} />
    </svg>
  );
}
