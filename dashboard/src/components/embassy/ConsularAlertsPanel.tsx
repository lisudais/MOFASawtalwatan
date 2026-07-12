import { useState } from 'react';
import GlobalAlertFeed from '../GlobalAlertFeed';
import { useFeedCards } from '../../services/feed/useFeedCards';
import type { FeedCard } from '../../services/feed/feedCards';
import type { EmbassyConfig } from '../../services/embassies';

// Country-scoped clone of the Global Alert Feed. It renders the SAME
// GlobalAlertFeed component (identical cards, badges, severity bar, corroboration
// state, ×N counts) and pulls from the SAME pipeline via the shared useFeedCards
// hook — only restricted to the consulate's covered ISO2 codes. No duplicated
// fetch, no new data source, no mock: just the country filter over /api/feed.
export default function ConsularAlertsPanel({ embassy }: { embassy: EmbassyConfig }) {
  const { cards, loading, error } = useFeedCards(embassy.coveredCountryCodes);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  return (
    <GlobalAlertFeed
      cards={cards}
      loading={loading}
      error={error}
      selectedCardId={selectedCardId}
      onSelectCard={(card: FeedCard) => setSelectedCardId(card.id)}
      titleAr="تنبيهات القنصلية"
    />
  );
}
