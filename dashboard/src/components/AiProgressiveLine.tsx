import { Loader2 } from 'lucide-react';

// Non-blocking "still working" line shown under content that's already
// visible (the heuristic default or the previous panel's data) while the real
// AI call is in flight — never replaces or hides what's already on screen.
export default function AiProgressiveLine({ message }: { message: string }) {
  return (
    <div className="ai-progressive-line">
      <Loader2 size={11} className="spin-icon" />
      <span>{message}</span>
    </div>
  );
}
