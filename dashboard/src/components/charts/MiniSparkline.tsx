interface MiniSparklineProps {
  values: number[];
  color: string;
  height?: number;
}

const VB_W = 100;

export default function MiniSparkline({ values, color, height = 28 }: MiniSparklineProps) {
  if (values.length < 2) return <div style={{ height }} />;

  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const step = VB_W / (values.length - 1);

  const toY = (v: number) => height - 2 - ((v - min) / range) * (height - 4);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * step},${toY(v)}`).join(' ');
  const lastY = toY(values[values.length - 1]);

  return (
    <svg viewBox={`0 0 ${VB_W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={VB_W} cy={lastY} r={2} fill={color} />
    </svg>
  );
}
