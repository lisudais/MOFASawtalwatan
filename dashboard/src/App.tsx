import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from './components/Header';
import WorldMap, { type AlertMarker } from './components/WorldMap';
import IntelSidebar from './components/IntelSidebar';
import SidebarResizeHandle from './components/SidebarResizeHandle';
import EventDetail from './components/EventDetail';
import GlobalAlertFeed from './components/GlobalAlertFeed';
import AlertDetailsPanel from './components/AlertDetailsPanel';
import type { FeedCard } from './services/feed/feedCards';
import { useFeedCards } from './services/feed/useFeedCards';
import { groupFeedCards } from './services/feed/groupCards';
import { resolveGeoEvent, hasValidCoords } from './services/feed/resolveGeoEvent';
import { classifyRiskByScore } from './services/riskClassification';
import { buildGlobalContextSummary } from './services/chatbotContext';
import { useFlights, buildFlightStatusSummary } from './services/flightStatus';
import HealthCountryDetailPanel from './components/HealthCountryDetailPanel';
import DisasterDetailPanel from './components/DisasterDetailPanel';
import OfficialStatementDetailPanel from './components/OfficialStatementDetailPanel';
import SecurityDetailPanel from './components/SecurityDetailPanel';
import EconomyDetailPanel from './components/EconomyDetailPanel';
import NotificationToast from './components/NotificationToast';
import AiChatbot from './components/AiChatbot';
import CommitteeView from './components/CommitteeView';
import ReportPreview from './components/report/ReportPreview';
import EmbassyDashboard from './components/embassy/EmbassyDashboard';
import { getEmbassyById, getCurrentAccess, canAccessEmbassy } from './services/embassies';
import { loadFirebaseConfig, initFirebase } from './services/firebaseRt';
import { fetchGDACSEvents } from './services/gdacs';
import { fetchUSGSEarthquakes } from './services/usgs';
import { fetchExtraDisasterEvents } from './services/disasters';
import { MOCK_TRAVELERS } from './services/mockData';
import { generateNotificationMessage, generateNotificationMessageAr, generateAiSuggestion, generateActionSteps } from './services/riskEngine';
import { registerServiceWorker, requestPermission, sendPushNotification, onAcknowledge } from './services/pushNotification';
import type { GeoEvent, Traveler, Notification, DashboardStats } from './types';
import type { CountryHealthEntry } from './services/healthAnalysis';
import type { DisasterEvent } from './services/naturalDisasterFeed';
import type { OfficialStatement } from './services/officialStatements';
import type { CountrySecurityProfile } from './services/security';
import type { EconomicIndicator } from './services/economy';
import './index.css';

// If URL has ?view=committee, show the committee view instead of dashboard
const IS_COMMITTEE_VIEW = new URLSearchParams(window.location.search).get('view') === 'committee';

// Init Firebase on load if already configured (needed for committee view)
const savedFbCfg = loadFirebaseConfig();
if (savedFbCfg) initFirebase(savedFbCfg);

const SIDEBAR_WIDTH_KEY = 'sidebar-width-pct';
const SIDEBAR_DEFAULT_PCT = 75;
const SIDEBAR_MIN_PCT = 25;
const SIDEBAR_MAX_PCT = 90;

function loadSidebarWidthPct(): number {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (raw >= SIDEBAR_MIN_PCT && raw <= SIDEBAR_MAX_PCT) return raw;
  } catch {
    // storage unavailable — fall through to default
  }
  return SIDEBAR_DEFAULT_PCT;
}

function loadSavedTraveler(): Traveler | null {
  try {
    const raw = localStorage.getItem('my-traveler');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      arrivalDate: new Date(parsed.arrivalDate),
      departureDate: new Date(parsed.departureDate),
    };
  } catch {
    return null;
  }
}

/* ─── Hash router ────────────────────────────────────────────────────────
   Lightweight routing without adding a dependency:
     ''                      → main command dashboard
     #/embassies             → searchable embassy selector
     #/embassies/:embassyId  → that embassy's scoped sub-dashboard
   Permission is validated HERE (route layer), and the embassy page itself
   only ever receives scope-filtered data (data layer) — not hidden in UI. */
function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  if (IS_COMMITTEE_VIEW) return <CommitteeView />;

  // Mission sub-dashboard: #/missions/:id is the canonical route; the older
  // #/embassies/:id form keeps working as an alias. Selection happens in the
  // header dropdown — there is no intermediate selection page. Permission is
  // validated HERE (route layer) before anything renders.
  const missionMatch = route.match(/^#\/(?:missions|embassies)\/([\w-]+)$/);
  if (missionMatch) {
    const mission = getEmbassyById(missionMatch[1]);
    const goBack = () => { window.location.hash = ''; };
    if (!mission) {
      return (
        <div className="app" dir="rtl">
          <Header lastUpdated={null} missionsMenu />
          <div className="embassy-selector-page">
            <div className="panel embassy-selector-panel">
              <div className="widget-empty-state">البعثة المطلوبة غير موجودة.</div>
              <button type="button" className="embassy-back-link" onClick={goBack}>العودة إلى اللوحة الرئيسية</button>
            </div>
          </div>
        </div>
      );
    }
    if (!canAccessEmbassy(getCurrentAccess(), mission.id)) {
      return (
        <div className="app" dir="rtl">
          <Header lastUpdated={null} missionsMenu />
          <div className="embassy-selector-page">
            <div className="panel embassy-selector-panel">
              <div className="widget-empty-state">لا تملك صلاحية الوصول إلى لوحة هذه البعثة.</div>
              <button type="button" className="embassy-back-link" onClick={goBack}>العودة إلى اللوحة الرئيسية</button>
            </div>
          </div>
        </div>
      );
    }
    return <EmbassyDashboard key={mission.id} embassy={mission} onBack={goBack} />;
  }

  return <MainDashboard />;
}

function MainDashboard() {
  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [travelers] = useState<Traveler[]>(() => {
    const saved = loadSavedTraveler();
    return saved ? [saved, ...MOCK_TRAVELERS] : MOCK_TRAVELERS;
  });
  const [selectedEvent, setSelectedEvent] = useState<GeoEvent | null>(null);
  // Right sidebar (Global Alert Feed) selection — deliberately separate from
  // `selectedEvent`, which drives the left sidebar / map / EventDetail flow.
  const [selectedRightAlert, setSelectedRightAlert] = useState<GeoEvent | null>(null);
  // Global Alert Feed cards come from the Stages 1-6 pipeline (/api/feed).
  // Fast→full orchestration lives in the shared hook (also used by the
  // consular feed, filtered by country). No filter here → the global feed.
  const { cards: feedCards, loading: cardsLoading, error: cardsError } = useFeedCards();
  const [selectedCard, setSelectedCard] = useState<FeedCard | null>(null);
  // Citizen tracked from the right-sidebar details panel — feeds the map's
  // existing selectedTraveler fly-to only; no marker layer is altered.
  const [trackedCitizen, setTrackedCitizen] = useState<Traveler | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryHealthEntry | null>(null);
  const [selectedDisaster, setSelectedDisaster] = useState<DisasterEvent | null>(null);
  const [selectedStatement, setSelectedStatement] = useState<OfficialStatement | null>(null);
  const [selectedSecurity, setSelectedSecurity] = useState<CountrySecurityProfile | null>(null);
  const [selectedIndicator, setSelectedIndicator] = useState<EconomicIndicator | null>(null);
  // Live lists surfaced by the Security/Health cards' own onDataLoaded
  // callbacks — used only to fold real cross-widget risk data into the
  // sidebar's aggregate stats below (see `stats`). Each card still owns and
  // fetches its own data; this is just a read-only mirror of the latest load.
  const [securityCountries, setSecurityCountries] = useState<CountrySecurityProfile[]>([]);
  const [healthCountries, setHealthCountries] = useState<CountryHealthEntry[]>([]);
  // Read-only mirror of the sidebar's live economic indicators — folded into the
  // exported report only; the Economy card still owns/fetches its own data.
  const [economyIndicators, setEconomyIndicators] = useState<EconomicIndicator[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  // True only when EVERY real alert source failed — drives the map's error vs
  // empty state. No mock fallback is ever used.
  const [feedError, setFeedError] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [sidebarWidthPct, setSidebarWidthPct] = useState(loadSidebarWidthPct);
  const autoAlertedRef = useRef(new Set<string>());

  // Register service worker on load
  useEffect(() => {
    registerServiceWorker().then(async (reg) => {
      if (!reg) return;
      const granted = await requestPermission();
      setPushEnabled(granted);
      onAcknowledge((travelerId, eventId) => {
        setNotifications((prev) =>
          prev.map((n) =>
            n.travelerId === travelerId && n.eventId === eventId
              ? { ...n, sent: false }
              : n
          )
        );
      });
    });
  }, []);

  // Auto-alert MY device when a CRITICAL/HIGH event matches my country
  useEffect(() => {
    const myDevice = travelers.find((t) => t.id.startsWith('my-device'));
    if (!myDevice || !pushEnabled) return;

    const matching = events.filter(
      (e) =>
        e.countryCode === myDevice.countryCode &&
        (e.riskLevel === 'CRITICAL' || e.riskLevel === 'HIGH')
    );

    matching.forEach((event) => {
      const key = `${myDevice.id}-${event.id}`;
      if (autoAlertedRef.current.has(key)) return;
      autoAlertedRef.current.add(key);

      const aiSug = generateAiSuggestion(event, myDevice);
      const steps = generateActionSteps(event);
      const notif: Notification = {
        id: `auto-${myDevice.id}-${event.id}`,
        travelerId: myDevice.id,
        travelerName: myDevice.nameEn,
        eventId: event.id,
        eventTitle: event.title,
        riskLevel: event.riskLevel,
        message: generateNotificationMessage(event, myDevice),
        messageAr: generateNotificationMessageAr(event, myDevice),
        aiSuggestion: aiSug.en,
        aiSuggestionAr: aiSug.ar,
        actionSteps: steps.en,
        actionStepsAr: steps.ar,
        timestamp: new Date(),
        sent: true,
      };
      setNotifications((prev) => [notif, ...prev]);
      sendPushNotification(event, myDevice);
    });
  }, [events, travelers, pushEnabled]);

  useEffect(() => {
    async function loadLiveData() {
      setLoading(true);
      try {
        // Real alert sources only — GDACS, USGS, EONET/NASA, EMSC. No mock data.
        const settled = await Promise.allSettled([
          fetchGDACSEvents(),
          fetchUSGSEarthquakes(),
          fetchExtraDisasterEvents(),
        ]);
        const live: GeoEvent[] = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        setEvents(live);
        setLastUpdated(new Date());
        // Error only if EVERY source rejected (transport failure), not merely empty.
        setFeedError(settled.every((r) => r.status === 'rejected'));
      } catch {
        setFeedError(true);
      } finally {
        setLoading(false);
      }
    }
    loadLiveData();
    const interval = setInterval(loadLiveData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Per-country risk for the map's RED highlight layer: the max Stage 5 score
  // across each country's feed cards. Real pipeline output, ISO2-keyed; cards
  // with no country are ignored. No mock, no fetch.
  const countryRisk = useMemo(() => {
    // Deterministic, no LLM: overall = max card.score for the country; keep the
    // driving category + per-category breakdown so the map can answer
    // "why is this country red" by pointing at real Stage 5 scores.
    const byCountry: Record<string, { score: number; category: string; byCategory: Record<string, number> }> = {};
    for (const c of feedCards) {
      if (!c.country) continue;
      const entry = byCountry[c.country] ??= { score: 0, category: c.eventType, byCategory: {} };
      entry.byCategory[c.eventType] = Math.max(entry.byCategory[c.eventType] ?? 0, c.score);
      if (c.score > entry.score) { entry.score = c.score; entry.category = c.eventType; }
    }
    return byCountry;
  }, [feedCards]);

  // Shared live flight feed — the SAME source the map's "حركة الطيران" layer
  // uses (services/flightStatus.ts). Kept always-active here so the assistant
  // can answer flight questions even when the map layer is toggled off; the
  // ref-counted loop guarantees a single shared fetch, never a duplicate.
  const flights = useFlights(true);

  // Live situation summary for the GLOBAL assistant (no embassy scope). Built
  // only from data already on screen; recomputed whenever any source changes,
  // so the assistant is always grounded in the current board — never a refusal.
  // The live flight-status summary is appended so "ماهي حالة الطيران الآن؟" is
  // answered from the real feed instead of a generic refusal.
  const globalSummaryAr = useMemo(() => {
    const base = buildGlobalContextSummary({ feedCards, events, securityCountries, healthCountries });
    const flightSummary = buildFlightStatusSummary(flights);
    return [base, flightSummary].filter(Boolean).join('\n\n');
  }, [feedCards, events, securityCountries, healthCountries, flights]);

  /**
   * Clicking a card selects it. When the cluster contains a signal that came
   * from a geophysical GeoEvent, we also select that event, so the existing
   * map fly-to and the right-side details panel keep working exactly as before.
   * Clusters with no GeoEvent behind them (security / statements / GDELT) simply
   * highlight — nothing that used to work has been taken away.
   */
  const handleSelectCard = useCallback((card: FeedCard) => {
    setSelectedCard(card);
    // When the cluster contains a geophysical signal that maps back to a
    // GeoEvent, also select it so the map fly-to keeps working. Cards with no
    // GeoEvent behind them (security / statements / GDELT) still open the
    // details panel — it now renders from the card itself. Same resolver the
    // map's alertMarkers are built with, below, so a card and its marker
    // (when one exists) always agree.
    setSelectedRightAlert(resolveGeoEvent(card, events));
  }, [events]);

  // Global Alert Feed cards, rolled up exactly the way GlobalAlertFeed itself
  // displays them (same pure function, same input) — this is what makes a map
  // marker and its right-panel card the same alert, not two parallel lists.
  const alertGroups = useMemo(() => groupFeedCards(feedCards), [feedCards]);

  // One marker per right-panel card: MEDIUM/HIGH/CRITICAL severity only (LOW
  // is never shown on the map), real source coordinates only (a card with no
  // matching GeoEvent — security/health/economic/statement clusters — has no
  // marker at all, never a guessed/centroid position), deduped by card id.
  const alertMarkers = useMemo<AlertMarker[]>(() => {
    const seen = new Set<string>();
    const out: AlertMarker[] = [];
    for (const group of alertGroups) {
      const band = classifyRiskByScore(group.score).band;
      if (band === 'LOW') continue;
      if (seen.has(group.lead.id)) continue;
      const geo = resolveGeoEvent(group.lead, events);
      if (!geo || !hasValidCoords(geo)) continue;
      seen.add(group.lead.id);
      out.push({ id: group.lead.id, lat: geo.lat, lng: geo.lng, band, type: geo.type });
    }
    return out;
  }, [alertGroups, events]);

  // Clicking a map marker must do exactly what clicking its right-panel card
  // does — so it reuses handleSelectCard, looking the FeedCard back up by the
  // same id the marker was built with.
  const handleSelectAlertMarker = useCallback((marker: AlertMarker) => {
    const group = alertGroups.find((g) => g.lead.id === marker.id);
    if (group) handleSelectCard(group.lead);
  }, [alertGroups, handleSelectCard]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const travelersAtRiskForEvent = selectedEvent
    ? travelers.filter((t) => t.countryCode === selectedEvent.countryCode).length
    : 0;

  // Aggregate stats across every live risk source on the dashboard — not just
  // the natural-disasters feed. Security (State Dept/ACLED/GDELT) and Health
  // (WHO/disease.sh) use the same LOW/MEDIUM/HIGH/CRITICAL scale as GeoEvent,
  // so they fold in directly rather than needing a separate normalization step.
  const disasterCritical = events.filter((e) => e.riskLevel === 'CRITICAL');
  const disasterHigh = events.filter((e) => e.riskLevel === 'HIGH');
  const securityCritical = securityCountries.filter((c) => c.riskLevel === 'CRITICAL');
  const securityHigh = securityCountries.filter((c) => c.riskLevel === 'HIGH');
  const healthCritical = healthCountries.filter((c) => c.analysis.risk_level.category === 'CRITICAL');
  const healthHigh = healthCountries.filter((c) => c.analysis.risk_level.category === 'HIGH');

  // Any country carrying a CRITICAL or HIGH signal from any source — used to
  // recognize an "at risk" traveler by real location, not just their manually
  // set status.
  const highRiskCountryCodes = new Set(
    [...disasterCritical, ...disasterHigh].map((e) => e.countryCode)
      .concat([...securityCritical, ...securityHigh].map((c) => c.countryCode))
      .concat([...healthCritical, ...healthHigh].map((c) => c.countryCode))
      .filter(Boolean)
  );

  const stats: DashboardStats = {
    totalEvents: events.length + securityCountries.reduce((s, c) => s + c.activeIncidents, 0) + healthCountries.length,
    criticalEvents: disasterCritical.length + securityCritical.length + healthCritical.length,
    affectedCountries: new Set([
      ...events.map((e) => e.countryCode),
      ...securityCountries.map((c) => c.countryCode),
      ...healthCountries.map((c) => c.countryCode),
    ].filter(Boolean)).size,
    travelersAtRisk: travelers.filter((t) =>
      t.status === 'ALERTED' || t.status === 'EVACUATED' || highRiskCountryCodes.has(t.countryCode)
    ).length,
    notificationsSent: notifications.filter((n) => n.sent).length,
    activeAlerts: disasterCritical.length + disasterHigh.length + securityCritical.length + securityHigh.length + healthCritical.length + healthHigh.length,
  };

  return (
    <div className="app">
      <Header lastUpdated={lastUpdated} missionsMenu onExportReport={() => setShowReport(true)} />
      {loading && (
        <div className="loading-bar">
          <div className="loading-fill" />
        </div>
      )}

      <main className="main-grid" style={{ gridTemplateColumns: `${sidebarWidthPct}vw 1fr 308px` }}>
        <IntelSidebar
          events={events}
          travelers={travelers}
          stats={stats}
          selectedEvent={selectedEvent}
          onSelectEvent={setSelectedEvent}
          onSelectCountry={(entry) => { setSelectedDisaster(null); setSelectedStatement(null); setSelectedSecurity(null); setSelectedIndicator(null); setSelectedCountry(entry); }}
          onSelectDisaster={(d) => { setSelectedCountry(null); setSelectedStatement(null); setSelectedSecurity(null); setSelectedIndicator(null); setSelectedDisaster(d); }}
          onSelectStatement={(s) => { setSelectedCountry(null); setSelectedDisaster(null); setSelectedSecurity(null); setSelectedIndicator(null); setSelectedStatement(s); }}
          onSelectSecurity={(p) => { setSelectedCountry(null); setSelectedDisaster(null); setSelectedStatement(null); setSelectedIndicator(null); setSelectedSecurity(p); }}
          onSecurityDataLoaded={(countries) => {
            setSecurityCountries(countries);
            // Keeps an already-open detail panel showing the SAME country
            // but with fresh data after a background refresh, instead of
            // freezing on the snapshot it was opened with. If that country
            // no longer has active threats, keep the last known snapshot
            // rather than abruptly closing the panel.
            setSelectedSecurity((prev) => (prev ? countries.find((c) => c.id === prev.id) ?? prev : prev));
          }}
          onHealthDataLoaded={setHealthCountries}
          onSelectIndicator={(ind) => { setSelectedCountry(null); setSelectedDisaster(null); setSelectedStatement(null); setSelectedSecurity(null); setSelectedIndicator(ind); }}
          onEconomyDataLoaded={setEconomyIndicators}
        />

        <SidebarResizeHandle
          pct={sidebarWidthPct}
          min={SIDEBAR_MIN_PCT}
          max={SIDEBAR_MAX_PCT}
          onChange={setSidebarWidthPct}
          onCommit={(pct) => {
            try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(pct)); } catch { /* storage unavailable */ }
          }}
        />

        <div className="map-section">
          {/* The map shares the RIGHT sidebar's event identity: a card click
              flies to + selects its marker, a marker click selects + scrolls to
              its card, and both open the same right-side details panel. The
              left sidebar's own `selectedEvent` flow is untouched. */}
          <WorldMap
            alertMarkers={alertMarkers}
            selectedAlertId={selectedCard?.id ?? null}
            onSelectAlert={handleSelectAlertMarker}
            travelers={travelers}
            selectedEvent={selectedRightAlert}
            selectedTraveler={trackedCitizen}
            countryRisk={countryRisk}
          />
          {/* Empty / error state — shown ONLY when there are no real events.
              No mock fallback is ever displayed. */}
          {!loading && events.length === 0 && (
            <div className="map-empty-overlay">
              {feedError
                ? 'تعذر جلب البيانات من المصدر الحقيقي'
                : 'لا توجد تنبيهات حقيقية متاحة حاليًا'}
            </div>
          )}
          {selectedEvent && (
            <EventDetail
              event={selectedEvent}
              travelersAtRisk={travelersAtRiskForEvent}
              onClose={() => setSelectedEvent(null)}
            />
          )}
          <HealthCountryDetailPanel
            country={selectedCountry}
            onClose={() => setSelectedCountry(null)}
          />
          <DisasterDetailPanel
            disaster={selectedDisaster}
            onClose={() => setSelectedDisaster(null)}
          />
          <OfficialStatementDetailPanel
            statement={selectedStatement}
            onClose={() => setSelectedStatement(null)}
          />
          <SecurityDetailPanel
            profile={selectedSecurity}
            onClose={() => setSelectedSecurity(null)}
          />
          <EconomyDetailPanel
            indicator={selectedIndicator}
            onClose={() => setSelectedIndicator(null)}
          />
          {/* Right-sidebar-only details overlay — driven solely by the Global
              Alert Feed's own state; never touches the left sidebar's panels. */}
          {selectedCard && (
            <AlertDetailsPanel
              card={selectedCard}
              event={selectedRightAlert}
              travelers={travelers}
              onClose={() => { setSelectedCard(null); setSelectedRightAlert(null); }}
              onTrackCitizen={setTrackedCitizen}
            />
          )}
          <AiChatbot globalSummaryAr={globalSummaryAr} />
        </div>

        <div className="right-column">
          <GlobalAlertFeed
            cards={feedCards}
            loading={cardsLoading}
            error={cardsError}
            selectedCardId={selectedCard?.id ?? null}
            onSelectCard={handleSelectCard}
          />
        </div>
      </main>

      <NotificationToast notifications={notifications} onDismiss={dismissNotification} />

      {showReport && (
        <ReportPreview
          inputs={{ events, healthCountries, securityCountries, economyIndicators }}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
