import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  fetchFlightStates,
  FLIGHT_REFRESH_INTERVAL_MS,
  FLIGHT_INTERPOLATION_MS,
  FLIGHT_STALE_TIMEOUT_MS,
  type Flight,
} from '../services/opensky';

// Near-real-time aircraft layer. Deliberately IMPERATIVE (its own Leaflet
// LayerGroup managed via refs) rather than react-leaflet <Marker>s, so that:
//   • markers are matched by icao24 and UPDATED in place — never recreated,
//     never duplicated, and the layer is never torn down each refresh;
//   • positions can be animated every frame with zero React re-renders;
//   • the map viewport is never touched (setLatLng only, never setView).
// Data is polled from our /api/opensky proxy; movement between the ~15s upstream
// snapshots is smoothed by interpolating strictly between two REAL positions.

const DEV = import.meta.env.DEV;
const devlog = (...args: unknown[]) => { if (DEV) console.log('[flights]', ...args); };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const na = (v: unknown): string =>
  v === null || v === undefined || v === '' ? 'غير متاح' : esc(String(v));

// Aircraft marker — small plane glyph rotated to the flight heading (cyan, so it
// never collides with the risk-colour palette). Same look as before the refactor.
function aircraftIcon(heading: number | null): L.DivIcon {
  const rot = typeof heading === 'number' ? heading : 0;
  return new L.DivIcon({
    className: 'aircraft-map-icon',
    html:
      `<div class="aircraft-glyph" style="transform:rotate(${rot}deg)">` +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="#7DD3FC" stroke="#0A1628" stroke-width="0.6">' +
      '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L11 19v-5.5z"/>' +
      '</svg></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function popupHtml(f: Flight): string {
  return (
    `<div dir="rtl" class="flight-popup">` +
    `<strong>رحلة: ${na(f.callsign)}</strong>` +
    `<div>شركة الطيران: غير متاح</div>` +
    `<div>المنشأ: ${na(f.originCountry)}</div>` +
    `<div>الوجهة: غير متاح</div>` +
    `<div>الارتفاع: ${f.baroAltitude != null ? `${Math.round(f.baroAltitude)} م` : 'غير متاح'}</div>` +
    `<div>السرعة: ${f.velocity != null ? `${Math.round(f.velocity * 3.6)} كم/س` : 'غير متاح'}</div>` +
    `<div>آخر تحديث: ${f.lastContact != null ? new Date(f.lastContact * 1000).toLocaleTimeString('ar-SA') : 'غير متاح'}</div>` +
    `</div>`
  );
}

interface Aircraft {
  marker: L.Marker;
  fromLat: number; fromLng: number; // interpolation start (previous rendered pos)
  toLat: number; toLng: number;     // interpolation target (latest real snapshot)
  animStart: number;                // ms timestamp the current glide began
  heading: number | null;
  lastSeen: number;                 // ms timestamp of the last response containing it
}

export default function FlightLayer({ enabled }: { enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    const group = L.layerGroup().addTo(map);
    const aircraft = new Map<string, Aircraft>();
    let fetching = false;   // overlap guard — never two in-flight requests
    let stopped = false;    // set on cleanup so late awaits are ignored
    let rafId = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    // ── Fetch + reconcile (match by icao24, update in place) ──────────────
    async function poll() {
      if (fetching || stopped) { if (fetching) devlog('request skipped: previous still in-flight'); return; }
      if (document.hidden) return; // paused while the tab is inactive
      fetching = true;
      const t0 = performance.now();
      devlog('request started:', new Date().toISOString());
      try {
        const { ok, states, source } = await fetchFlightStates();
        if (stopped) return;
        const dur = Math.round(performance.now() - t0);
        const now = Date.now();
        devlog('source:', source);
        devlog('records received:', states.length);

        if (ok && states.length > 0) {
          let valid = 0;
          let updated = 0;
          for (const f of states) {
            if (!Number.isFinite(f.latitude) || !Number.isFinite(f.longitude) || !f.icao24) continue;
            valid++;
            const existing = aircraft.get(f.icao24);
            if (existing) {
              // Only re-anchor the glide when the snapshot actually moved — a
              // repeated (cached) position must not restart/decelerate the anim.
              if (f.latitude !== existing.toLat || f.longitude !== existing.toLng) {
                const cur = existing.marker.getLatLng();
                existing.fromLat = cur.lat; existing.fromLng = cur.lng;
                existing.toLat = f.latitude; existing.toLng = f.longitude;
                existing.animStart = now;
              }
              existing.lastSeen = now;
              if (f.heading !== existing.heading) {
                existing.heading = f.heading;
                existing.marker.setIcon(aircraftIcon(f.heading)); // rotate to new heading
              }
              existing.marker.getPopup()?.setContent(popupHtml(f));
            } else {
              const marker = L.marker([f.latitude, f.longitude], { icon: aircraftIcon(f.heading) })
                .bindPopup(popupHtml(f));
              marker.addTo(group);
              aircraft.set(f.icao24, {
                marker,
                fromLat: f.latitude, fromLng: f.longitude,
                toLat: f.latitude, toLng: f.longitude,
                animStart: now, heading: f.heading, lastSeen: now,
              });
            }
            updated++;
          }
          devlog('valid coordinates:', valid);
          pruneStale(now);
          devlog('markers updated:', updated);
        } else {
          // Graceful failure/empty: KEEP the last good aircraft; only drop the
          // ones that have now been missing long enough to be considered gone.
          devlog(ok ? 'no records — keeping last aircraft' : 'request failed — keeping last aircraft');
          pruneStale(now);
        }

        devlog('request duration:', `${dur}ms`);
        devlog('next refresh:', `${FLIGHT_REFRESH_INTERVAL_MS}ms`);
      } finally {
        fetching = false;
      }
    }

    function pruneStale(now: number) {
      for (const [id, a] of aircraft) {
        if (now - a.lastSeen > FLIGHT_STALE_TIMEOUT_MS) {
          group.removeLayer(a.marker);
          aircraft.delete(id);
        }
      }
    }

    // ── Animation — glide each marker toward its latest real position ─────
    function animate() {
      const now = Date.now();
      for (const a of aircraft.values()) {
        const t = FLIGHT_INTERPOLATION_MS > 0
          ? Math.min(1, (now - a.animStart) / FLIGHT_INTERPOLATION_MS)
          : 1;
        const lat = a.fromLat + (a.toLat - a.fromLat) * t;
        const lng = a.fromLng + (a.toLng - a.fromLng) * t;
        a.marker.setLatLng([lat, lng]); // moves the marker only — never the map
      }
      rafId = requestAnimationFrame(animate);
    }

    // ── Lifecycle: start polling + animation; pause both when tab hidden ──
    function startAnim() { if (!rafId) rafId = requestAnimationFrame(animate); }
    function stopAnim() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

    function onVisibility() {
      if (document.hidden) {
        stopAnim(); // pause — no fetching, no animation while inactive
      } else {
        startAnim();
        void poll(); // catch up immediately on return
      }
    }

    void poll();
    intervalId = setInterval(() => { void poll(); }, FLIGHT_REFRESH_INTERVAL_MS);
    startAnim();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
      stopAnim();
      document.removeEventListener('visibilitychange', onVisibility);
      group.remove();
      aircraft.clear();
    };
  }, [enabled, map]);

  return null;
}
