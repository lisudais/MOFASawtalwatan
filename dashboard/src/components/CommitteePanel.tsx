import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Users2, CheckCircle, Send, ShieldCheck, PhoneCall } from 'lucide-react';
import {
  loadFirebaseConfig, saveFirebaseConfig, initFirebase, isFirebaseReady,
  sendCommitteeAlert, subscribeToResponses, type FirebaseConfig, type CommitteeResponse,
} from '../services/firebaseRt';
import type { GeoEvent } from '../types';

interface CommitteePanelProps {
  selectedEvent: GeoEvent | null;
  travelersAtRisk: number;
}

export default function CommitteePanel({ selectedEvent, travelersAtRisk }: CommitteePanelProps) {
  const [cfg, setCfg] = useState<FirebaseConfig>(() => loadFirebaseConfig() ?? { apiKey: '', databaseURL: '' });
  const [ready, setReady] = useState(isFirebaseReady());
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [responses, setResponses] = useState<CommitteeResponse[]>([]);

  useEffect(() => {
    if (!ready || !selectedEvent) return;
    return subscribeToResponses(selectedEvent.id, setResponses);
  }, [ready, selectedEvent]);

  async function handleSave() {
    setSaving(true);
    try {
      saveFirebaseConfig(cfg);
      initFirebase(cfg);
      setReady(isFirebaseReady());
    } finally {
      setSaving(false);
    }
  }

  async function handleAlert() {
    if (!selectedEvent) return;
    setSending(true);
    try {
      sendCommitteeAlert(selectedEvent.id, selectedEvent.title);
    } finally {
      setSending(false);
    }
  }

  const committeeUrl = `${window.location.origin}${window.location.pathname}?view=committee${selectedEvent ? `&event=${selectedEvent.id}` : ''}`;
  const safeCount = responses.filter((r) => r.type === 'SAFE').length;
  const sosCount = responses.filter((r) => r.type === 'SOS').length;

  return (
    <div className="panel committee-panel">
      <div className="panel-header">
        <Users2 size={14} />
        <span>Committee Response</span>
        <span className="panel-header-ar">استجابة اللجنة</span>
      </div>

      {!ready && (
        <div className="committee-setup-form">
          <div className="modal-field">
            <label>Firebase API Key</label>
            <input value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} />
          </div>
          <div className="modal-field">
            <label>Firebase Database URL</label>
            <input value={cfg.databaseURL} onChange={(e) => setCfg({ ...cfg, databaseURL: e.target.value })} />
          </div>
          <button
            className="btn-validate"
            onClick={handleSave}
            disabled={saving || !cfg.apiKey || !cfg.databaseURL}
          >
            {saving ? <><span className="spinner" /> Connecting…</> : <><CheckCircle size={12} /> Connect</>}
          </button>
          <div className="setup-step-label" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            Set Firebase RTDB rules to allow read/write: <code style={{ color: 'var(--saudi-light)' }}>{`{".read":true,".write":true}`}</code>
          </div>
        </div>
      )}

      {ready && (
        <div className="committee-alert-section">
          <div className="committee-qr-section">
            <div className="committee-qr-label" onClick={() => setQrExpanded((v) => !v)}>
              <CheckCircle size={11} color="#00E676" />
              <span>Firebase connected · share this QR with committee</span>
              <span className="qr-toggle-hint">{qrExpanded ? '▲' : '▼'}</span>
            </div>
            {qrExpanded && (
              <div className="committee-qr-body">
                <div className="committee-qr-box">
                  <QRCodeSVG
                    value={committeeUrl}
                    size={200}
                    bgColor="#0A1628"
                    fgColor="#C9A84C"
                    level="M"
                  />
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                  Scan to open committee alert page<br />
                  <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>(works on any phone, no app needed)</span>
                </div>
              </div>
            )}
          </div>

          {selectedEvent && (safeCount > 0 || sosCount > 0) && (
            <div className="response-tracker">
              <span className="resp-safe"><ShieldCheck size={11} /> أنا بخير: {safeCount}</span>
              <span className="resp-sos"><PhoneCall size={11} /> بحاجة للمساعدة: {sosCount}</span>
            </div>
          )}

          {selectedEvent ? (
            <button className="btn-validate" onClick={handleAlert} disabled={sending}>
              {sending ? <><span className="spinner" /> Sending…</> : <><Send size={12} /> Alert Committee ({travelersAtRisk} at risk)</>}
            </button>
          ) : (
            <div className="widget-empty-state">Select an event on the map to alert the committee.</div>
          )}
        </div>
      )}
    </div>
  );
}
