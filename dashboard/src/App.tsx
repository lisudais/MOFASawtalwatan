import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from './components/Header';
import WorldMap, { type AlertMarker } from './components/WorldMap';
import IntelSidebar from './components/IntelSidebar';
import SidebarResizeHandle from './components/SidebarResizeHandle';
import EventDetail from './components/EventDetail';
import AggregatedAlertFeed from './components/AggregatedAlertFeed';
import AlertDetailsPanel from './components/AlertDetailsPanel';
import { aggregatedToDetail } from './services/feed/aggregatedToDetail';
import { useFeedCards } from './services/feed/useFeedCards';
import { aggregateAlerts, type AggregatedAlert } from './services/feed/aggregateAlerts';
import { centroidFor } from './services/feed/countryCentroids';
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
import type { DisasterEvent, DisasterType } from './services/naturalDisasterFeed';
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

// Disaster sub-type → GeoEvent glyph key (picks the marker's line icon).
const DISASTER_GLYPH: Record<DisasterType, GeoEvent['type']> = {
  EARTHQUAKE: 'EARTHQUAKE', VOLCANO: 'VOLCANO', HURRICANE: 'STORM', FLOOD: 'FLOOD', WILDFIRE: 'WILDFIRE',
};

// Placeable coordinates for an aggregated alert: a disaster's own lat/lng when
// real, otherwise the country centroid. null → not placeable (economic/global,
// or a country we have no centroid for) → no map marker.
function alertCoords(alert: AggregatedAlert): [number, number] | null {
  if (alert.lat != null && alert.lng != null && (alert.lat !== 0 || alert.lng !== 0)) {
    return [alert.lat, alert.lng];
  }
  return centroidFor(alert.countryCode);
}

// Marker glyph for an aggregated alert, by source section.
function alertGlyph(alert: AggregatedAlert): GeoEvent['type'] {
  switch (alert.ref.kind) {
    case 'natural_disaster': return DISASTER_GLYPH[alert.ref.event.disasterType] ?? 'EARTHQUAKE';
    case 'health': return 'DISEASE';
    case 'security': return 'CONFLICT';
    case 'economic': return 'DROUGHT';
  }
}

function MainDashboard() {
  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [travelers] = useState<Traveler[]>(() => {
    const saved = loadSavedTraveler();
    return saved ? [saved, ...MOCK_TRAVELERS] : MOCK_TRAVELERS;
  });
  const [selectedEvent, setSelectedEvent] = useState<GeoEvent | null>(null);
  // Pipeline feed (Stages 1-6) — still powers the map's country-risk RED layer
  // and the assistant's grounding context. Neither the right-column list nor
  // the map's event MARKERS use it any more: both are now a live roll-up of the
  // four sidebar sections (see `aggregatedAlerts`).
  const { cards: feedCards } = useFeedCards();
  // Fly-to target for the map — the coordinates of the currently-selected alert
  // (from the right list or a marker click).
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);
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
  // Live mirror of the Natural-Disasters card's own feed (naturalDisasterFeed.ts)
  // — the SAME list the left card renders. Powers the aggregated right-column
  // feed so its disaster items match the left card exactly (same country/severity).
  const [disasterEvents, setDisasterEvents] = useState<DisasterEvent[]>([]);
  // Right-column aggregated-feed selection (highlight only) — separate from the
  // pipeline-driven `selectedCard`/map flow.
  const [selectedAggId, setSelectedAggId] = useState<string | null>(null);
  // Clicking a RIGHT-column "التنبيهات العالمية" item opens the SAME original
  // alert card the dashboard was built around (AlertDetailsPanel) — just fed with
  // that alert's data (adapted via aggregatedToDetail). Kept as its own state so
  // the right flow never collides with the left-sidebar panels.
  const [selectedAggAlert, setSelectedAggAlert] = useState<AggregatedAlert | null>(null);
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

  // Only one detail window is ever open at a time. Opening any LEFT-sidebar panel
  // also closes the RIGHT-column's dedicated window (and vice-versa), so the two
  // independent flows never show two windows at once.
  const clearDetailPanels = useCallback(() => {
    setSelectedCountry(null); setSelectedDisaster(null); setSelectedStatement(null);
    setSelectedSecurity(null); setSelectedIndicator(null);
    setSelectedAggAlert(null);
  }, []);
  const openHealth = useCallback((entry: CountryHealthEntry) => { clearDetailPanels(); setSelectedCountry(entry); }, [clearDetailPanels]);
  const openDisaster = useCallback((d: DisasterEvent) => { clearDetailPanels(); setSelectedDisaster(d); }, [clearDetailPanels]);
  const openStatement = useCallback((s: OfficialStatement) => { clearDetailPanels(); setSelectedStatement(s); }, [clearDetailPanels]);
  const openSecurity = useCallback((p: CountrySecurityProfile) => { clearDetailPanels(); setSelectedSecurity(p); }, [clearDetailPanels]);
  const openIndicator = useCallback((ind: EconomicIndicator) => { clearDetailPanels(); setSelectedIndicator(ind); }, [clearDetailPanels]);

  // THE right-column list. A live roll-up of the four left sections' own data
  // (health / natural disasters / security / economy), ranked by real risk score
  // across all of them. Recomputes whenever ANY section refreshes, so the list
  // stays in live sync with the left cards with no separate fetch of its own.
  const aggregatedAlerts = useMemo(
    () => aggregateAlerts({ healthCountries, disasterEvents, securityCountries, economyIndicators }),
    [healthCountries, disasterEvents, securityCountries, economyIndicators],
  );
  const aggregatedLoading =
    healthCountries.length === 0 && disasterEvents.length === 0 &&
    securityCountries.length === 0 && economyIndicators.length === 0;

  // Clicking a right-column item opens the ORIGINAL alert card (AlertDetailsPanel)
  // — the same one the dashboard was built around — fed with this alert's data.
  // It also highlights the row and flies the map to the alert's location. The
  // left sidebar's own click flow (openHealth/openDisaster/…) is completely
  // separate and untouched.
  const handleSelectAggregated = useCallback((alert: AggregatedAlert) => {
    clearDetailPanels();               // close any left-sidebar panel first
    setSelectedAggId(alert.id);
    const coords = alertCoords(alert);
    if (coords) setFlyTo({ lat: coords[0], lng: coords[1] });
    setSelectedAggAlert(alert);        // open the original alert card
  }, [clearDetailPanels]);

  // Map event markers — built from the SAME aggregated four-section data as the
  // right list, so the map reflects real risk scores from health/disasters/
  // security (no dependency on the slow pipeline feed). Every band LOW→CRITICAL
  // is placed (an event that qualifies is never hidden by an over-strict cutoff).
  // Coordinates: a disaster's own lat/lng, else the country centroid; economic/
  // global alerts have no location and are simply not placed. When several alerts
  // collapse to the same point, the most severe one wins that marker.
  const alertMarkers = useMemo<AlertMarker[]>(() => {
    const best = new Map<string, AlertMarker>();
    for (const alert of aggregatedAlerts) {
      const coords = alertCoords(alert);
      if (!coords) continue;
      const [lat, lng] = coords;
      const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
      const prev = best.get(key);
      if (prev && prev.score >= alert.score) continue;
      best.set(key, {
        id: alert.id, lat, lng, score: alert.score,
        band: classifyRiskByScore(alert.score).band, type: alertGlyph(alert),
      });
    }
    return [...best.values()];
  }, [aggregatedAlerts]);

  // Per-country risk for the map's "current risk" choropleth — built from the
  // SAME aggregatedAlerts list the right column ("التنبيهات العالمية") renders,
  // so the shaded map is a faithful mirror of that panel: the country of a red
  // alert there is shaded red here, at the same score. ISO2-keyed; alerts with no
  // country (e.g. global market moves, countryCode='') are ignored. For each
  // country we keep its highest alert score, the driving category, and the
  // per-category breakdown so the polygon popup can explain "why".
  const countryRisk = useMemo(() => {
    const byCountry: Record<string, { score: number; category: string; byCategory: Record<string, number> }> = {};
    for (const a of aggregatedAlerts) {
      if (!a.countryCode) continue;
      const entry = byCountry[a.countryCode] ??= { score: 0, category: a.category, byCategory: {} };
      entry.byCategory[a.category] = Math.max(entry.byCategory[a.category] ?? 0, a.score);
      if (a.score > entry.score) { entry.score = a.score; entry.category = a.category; }
    }
    return byCountry;
  }, [aggregatedAlerts]);

  // A marker click does exactly what clicking its right-list item does.
  const handleSelectAlertMarker = useCallback((marker: AlertMarker) => {
    const alert = aggregatedAlerts.find((a) => a.id === marker.id);
    if (alert) handleSelectAggregated(alert);
  }, [aggregatedAlerts, handleSelectAggregated]);

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

  // Any detail panel currently open over the map. Passed to WorldMap so it can
  // pull its floating controls (layers trigger, forecast banner) out of the DOM
  // while a panel is open — those controls share the map's top-left slot with
  // the panels and would otherwise peek out beside them.
  const anyDetailOpen = !!(
    selectedEvent || selectedCountry || selectedDisaster ||
    selectedStatement || selectedSecurity || selectedIndicator || selectedAggAlert
  );

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
          onSelectCountry={openHealth}
          onSelectDisaster={openDisaster}
          onDisasterDataLoaded={setDisasterEvents}
          onSelectStatement={openStatement}
          onSelectSecurity={openSecurity}
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
          onSelectIndicator={openIndicator}
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
            selectedAlertId={selectedAggId}
            onSelectAlert={handleSelectAlertMarker}
            travelers={travelers}
            flyTo={flyTo}
            selectedTraveler={null}
            countryRisk={countryRisk}
            detailOpen={anyDetailOpen}
          />
          {/* Empty / error state — shown ONLY when the aggregated feed (the map's
              marker source) has nothing to place. No mock fallback is ever shown. */}
          {!aggregatedLoading && alertMarkers.length === 0 && (
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
          {/* RIGHT-column "التنبيهات العالمية" detail — the SAME original
              AlertDetailsPanel card, populated with the selected alert's data. */}
          {selectedAggAlert && (() => {
            const { card, event } = aggregatedToDetail(selectedAggAlert);
            return (
              <AlertDetailsPanel
                card={card}
                event={event}
                travelers={travelers}
                onClose={() => { setSelectedAggAlert(null); setSelectedAggId(null); }}
                onTrackCitizen={(c) => {
                  if (Number.isFinite(c.lat) && Number.isFinite(c.lng) && (c.lat !== 0 || c.lng !== 0)) {
                    setFlyTo({ lat: c.lat, lng: c.lng });
                  }
                }}
              />
            );
          })()}
          <AiChatbot globalSummaryAr={globalSummaryAr} />
        </div>

        <div className="right-column">
          <AggregatedAlertFeed
            alerts={aggregatedAlerts}
            loading={aggregatedLoading}
            selectedId={selectedAggId}
            onSelectAlert={handleSelectAggregated}
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
