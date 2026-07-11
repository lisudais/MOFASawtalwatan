import { useState, type ReactNode, type MouseEvent } from 'react';
import { checkLink } from '../services/ai/verifyLink';
import { officialFallbackUrl } from '../services/ai/officialFallback';

interface SafeSourceLinkProps {
  href: string | null | undefined;
  className?: string;
  children: ReactNode;
  // Extra text (source name, adapter label) to help pick the right official
  // fallback org when the URL itself doesn't reveal it clearly enough.
  fallbackHint?: string | null;
}

// A source link that never opens broken. On click it validates the URL
// through the server-side /api/link-check proxy (the browser can't read a
// cross-origin status code itself — see verifyLink.ts) and only opens it if
// it really returns 200; a 404/unreachable link opens that organization's
// current official page instead (never a third-party site).
export default function SafeSourceLink({ href, className, children, fallbackHint }: SafeSourceLinkProps) {
  const [checking, setChecking] = useState(false);

  if (!href) return null;

  async function handleClick(e: MouseEvent) {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    const { ok } = await checkLink(href!);
    setChecking(false);
    const target = ok ? href! : officialFallbackUrl(href, fallbackHint);
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  return (
    <a className={className} href={href} aria-busy={checking} onClick={handleClick}>
      {children}
    </a>
  );
}
