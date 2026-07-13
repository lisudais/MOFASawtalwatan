import { MapPin, Phone, CreditCard, CalendarDays, AlertTriangle } from 'lucide-react';
import type { Traveler } from '../types';

// Full tracking card for ONE registered citizen abroad — the content shown when
// a citizen marker is clicked on any map. Light card (matches the map popup
// bubble), RTL, with the citizen's identity, contact, travel window and current
// status, so a click answers "who is this and are they safe" at a glance.

const STATUS: Record<Traveler['status'], { color: string; bg: string; label: string }> = {
  ACTIVE:    { color: '#2979FF', bg: 'rgba(41,121,255,0.14)', label: 'نشط' },
  ALERTED:   { color: '#FF6D00', bg: 'rgba(255,109,0,0.16)',  label: 'تنبيه' },
  EVACUATED: { color: '#FF1744', bg: 'rgba(255,23,68,0.16)',  label: 'إخلاء' },
  SAFE:      { color: '#00A050', bg: 'rgba(0,160,80,0.14)',   label: 'آمن' },
};

// Gregorian, Arabic digits/month names — avoids ar-SA's default Hijri calendar
// so the travel window reads unambiguously against the feed's Gregorian dates.
const dateFmt = new Intl.DateTimeFormat('ar', {
  year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory',
});
const fmt = (d: Date) => (d instanceof Date && !isNaN(d.getTime()) ? dateFmt.format(d) : 'غير متاح');

export default function CitizenPopupCard({ traveler }: { traveler: Traveler }) {
  const s = STATUS[traveler.status];
  return (
    <div dir="rtl" className="citizen-popup">
      <div className="citizen-popup-head">
        <div>
          <div className="citizen-popup-name">{traveler.nameAr}</div>
          <div className="citizen-popup-name-en">{traveler.nameEn}</div>
        </div>
        <span className="citizen-popup-status" style={{ color: s.color, background: s.bg }}>
          {s.label}
        </span>
      </div>

      <div className="citizen-popup-rows">
        <div><MapPin size={11} /> <span>{traveler.destination}</span></div>
        <div><Phone size={11} /> <span className="mono-num">{traveler.phone}</span></div>
        <div><CreditCard size={11} /> <span>جواز السفر: <span className="mono-num">{traveler.passportNumber}</span></span></div>
        <div><CalendarDays size={11} /> <span>الوصول: {fmt(traveler.arrivalDate)}</span></div>
        <div><CalendarDays size={11} /> <span>المغادرة: {fmt(traveler.departureDate)}</span></div>
        <div>
          <AlertTriangle size={11} />
          <span>التنبيهات النشطة: <span className="mono-num">{traveler.alerts.length}</span></span>
        </div>
      </div>
    </div>
  );
}
