import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import WorldMap from './components/WorldMap';
import IntelSidebar from './components/IntelSidebar';
import SidebarResizeHandle from './components/SidebarResizeHandle';
import EventDetail from './components/EventDetail';
import GlobalAlertFeed from './components/GlobalAlertFeed';
import AlertDetailsPanel from './components/AlertDetailsPanel';
import HealthCountryDetailPanel from './components/HealthCountryDetailPanel';
import DisasterDetailPanel from './components/DisasterDetailPanel';
import OfficialStatementDetailPanel from './components/OfficialStatementDetailPanel';
import SecurityDetailPanel from './components/SecurityDetailPanel';
import EconomyDetailPanel from './components/EconomyDetailPanel';
import NotificationToast from './components/NotificationToast';
import AiChatbot from './components/AiChatbot';
import CommitteeView from './components/CommitteeView';
import { loadFirebaseConfig, initFirebase } from './services/firebaseRt';
import { fetchGDACSEvents } from './services/gdacs';
import { fetchUSGSEarthquakes } from './services/usgs';
import { fetchExtraDisasterEvents } from './services/disasters';
import { MOCK_TRAVELERS } from './services/mockData';
import { generateNotificationMessage, generateNotificationMessageAr, generateAiSuggestion, generateActionSteps } from './services/riskEngine';
import { registerServiceWorker, requestPermission, sendPushNotification, onAcknowledge } from './services/pushNotification';
import type { GeoEvent, Traveler, Notification, DashboardStats } from './types';
import type { CountryHealthEntry } from './services/healthAnalysis';
import type { NaturalDisaster } from './services/naturalDisasters';
import type { OfficialStatement } from './services/officialStatements';
import type { SecurityProfile } from './services/security';
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

export default function App() {
  if (IS_COMMITTEE_VIEW) return <CommitteeView />;

  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [travelers] = useState<Traveler[]>(() => {
    const saved = loadSavedTraveler();
    return saved ? [saved, ...MOCK_TRAVELERS] : MOCK_TRAVELERS;
  });
  const [selectedEvent, setSelectedEvent] = useState<GeoEvent | null>(null);
  // Right sidebar (Global Alert Feed) selection — deliberately separate from
  // `selectedEvent`, which drives the left sidebar / map / EventDetail flow.
  const [selectedRightAlert, setSelectedRightAlert] = useState<GeoEvent | null>(null);
  // Citizen tracked from the right-sidebar details panel — feeds the map's
  // existing selectedTraveler fly-to only; no marker layer is altered.
  const [trackedCitizen, setTrackedCitizen] = useState<Traveler | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryHealthEntry | null>(null);
  const [selectedDisaster, setSelectedDisaster] = useState<NaturalDisaster | null>(null);
  const [selectedStatement, setSelectedStatement] = useState<OfficialStatement | null>(null);
  const [selectedSecurity, setSelectedSecurity] = useState<SecurityProfile | null>(null);
  const [selectedIndicator, setSelectedIndicator] = useState<EconomicIndicator | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  // True only when EVERY real alert source failed — drives the map's error vs
  // empty state. No mock fallback is ever used.
  const [feedError, setFeedError] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
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

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const travelersAtRiskForEvent = selectedEvent
    ? travelers.filter((t) => t.countryCode === selectedEvent.countryCode).length
    : 0;

  const stats: DashboardStats = {
    totalEvents: events.length,
    criticalEvents: events.filter((e) => e.riskLevel === 'CRITICAL').length,
    affectedCountries: new Set(events.map((e) => e.countryCode).filter(Boolean)).size,
    travelersAtRisk: travelers.filter((t) => t.status === 'ALERTED' || t.status === 'EVACUATED').length,
    notificationsSent: notifications.filter((n) => n.sent).length,
    activeAlerts: events.filter((e) => e.riskLevel === 'CRITICAL' || e.riskLevel === 'HIGH').length,
  };

  return (
    <div className="app">
      <Header lastUpdated={lastUpdated} />
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
          onSelectIndicator={(ind) => { setSelectedCountry(null); setSelectedDisaster(null); setSelectedStatement(null); setSelectedSecurity(null); setSelectedIndicator(ind); }}
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
            events={events}
            travelers={travelers}
            selectedEvent={selectedRightAlert}
            onSelectEvent={setSelectedRightAlert}
            selectedTraveler={trackedCitizen}
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
          {selectedRightAlert && (
            <AlertDetailsPanel
              alert={selectedRightAlert}
              travelers={travelers}
              onClose={() => setSelectedRightAlert(null)}
              onTrackCitizen={setTrackedCitizen}
            />
          )}
          <AiChatbot />
        </div>

        <div className="right-column">
          <GlobalAlertFeed
            events={events}
            selectedAlert={selectedRightAlert}
            onSelectAlert={setSelectedRightAlert}
          />
        </div>
      </main>

      <NotificationToast notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}
