import { useState, useEffect } from 'react';
import { ShieldCheck, PhoneCall } from 'lucide-react';
import { loadFirebaseConfig, initFirebase, isFirebaseReady, submitCommitteeResponse, subscribeToAlert } from '../services/firebaseRt';

export default function CommitteeView() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('event') ?? 'general';

  const [ready, setReady] = useState(isFirebaseReady());
  const [travelerName, setTravelerName] = useState('');
  const [submitted, setSubmitted] = useState<'SAFE' | 'SOS' | null>(null);
  const [alert, setAlert] = useState<{ message: string; timestamp: number } | null>(null);

  useEffect(() => {
    if (ready) return;
    const cfg = loadFirebaseConfig();
    if (cfg) {
      initFirebase(cfg);
      setReady(isFirebaseReady());
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    return subscribeToAlert(eventId, setAlert);
  }, [ready, eventId]);

  function respond(type: 'SAFE' | 'SOS') {
    submitCommitteeResponse({
      type,
      travelerName: travelerName || 'مجهول',
      eventId,
      timestamp: Date.now(),
    });
    setSubmitted(type);
  }

  return (
    <div className="app" style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="modal-card" style={{ maxWidth: 360, textAlign: 'center' }}>
        <div className="modal-title">لجنة الاستجابة للطوارئ</div>

        {!ready && (
          <div className="widget-empty-state">
            لم يتم تفعيل الاتصال بعد. يرجى فتح الرابط من الجهاز الرئيسي بعد الاتصال بقاعدة البيانات.
          </div>
        )}

        {ready && alert && (
          <div className="event-detail-action" style={{ marginBottom: 12 }}>{alert.message}</div>
        )}

        {ready && !submitted && (
          <>
            <div className="modal-field">
              <label>اسمك (اختياري)</label>
              <input value={travelerName} onChange={(e) => setTravelerName(e.target.value)} dir="rtl" />
            </div>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: 10 }}>
              <button className="btn-validate" style={{ background: 'var(--danger-low)' }} onClick={() => respond('SAFE')}>
                <ShieldCheck size={14} /> أنا بخير
              </button>
              <button className="btn-validate" style={{ background: 'var(--danger-critical)' }} onClick={() => respond('SOS')}>
                <PhoneCall size={14} /> بحاجة للمساعدة
              </button>
            </div>
          </>
        )}

        {submitted && (
          <div className="event-detail-action">
            تم إرسال استجابتك: {submitted === 'SAFE' ? 'أنا بخير ✓' : 'طلب مساعدة تم إرساله ✓'}
          </div>
        )}
      </div>
    </div>
  );
}
