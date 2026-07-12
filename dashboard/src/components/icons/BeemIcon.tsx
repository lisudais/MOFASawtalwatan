interface BeemIconProps {
  size?: number;
  className?: string;
}

export default function BeemIcon({ size = 18, className }: BeemIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M28 14 C18 14 10 21 10 29 C10 36 16 42 24 44 L21 51 L32 43 C40 42 46 36 46 29 C46 21 38 14 28 14 Z"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M20 29 L27 29 L24 22 L37 32 L28 32 L31 39 Z"
        fill="currentColor"
      />
    </svg>
  );
}
