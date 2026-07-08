import { useState } from 'react';
import { X } from 'lucide-react';
import type { Traveler } from '../types';

interface RegisterModalProps {
  onRegister: (traveler: Traveler) => void;
  onClose: () => void;
}

export default function RegisterModal({ onRegister, onClose }: RegisterModalProps) {
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [destination, setDestination] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [phone, setPhone] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const traveler: Traveler = {
      id: `my-device-${Date.now()}`,
      nameAr,
      nameEn,
      passportNumber,
      destination,
      countryCode: countryCode.toUpperCase(),
      lat: 0,
      lng: 0,
      arrivalDate: new Date(),
      departureDate: new Date(Date.now() + 7 * 86400000),
      phone,
      status: 'ACTIVE',
      alerts: [],
    };
    localStorage.setItem('my-traveler', JSON.stringify(traveler));
    onRegister(traveler);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="event-detail-close" onClick={onClose}><X size={16} /></button>
        <div className="modal-title">Register as Traveler · تسجيل مسافر</div>
        <form onSubmit={handleSubmit}>
          <div className="form-row-split">
            <div className="modal-field">
              <label>Full name (English)</label>
              <input required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>الاسم الكامل (عربي)</label>
              <input required value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
            </div>
          </div>
          <div className="modal-field">
            <label>Passport number</label>
            <input required value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} />
          </div>
          <div className="form-row-split">
            <div className="modal-field">
              <label>Destination city/country</label>
              <input required value={destination} onChange={(e) => setDestination(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Country code (ISO2)</label>
              <input required maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} />
            </div>
          </div>
          <div className="modal-field">
            <label>Phone number</label>
            <input required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn-validate" style={{ flex: 1 }}>Register</button>
          </div>
        </form>
      </div>
    </div>
  );
}
