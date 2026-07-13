import { useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';

interface AlertApprovalModalProps {
  messageAr: string;
  placeAr: string;
  expectedAffected: number;
  /** True when no configured embassy covers this country — the approval
   *  still records an audit trail, but no consulate inbox will receive it. */
  unrouted: boolean;
  onConfirm: (approvedByAr: string) => void;
  onCancel: () => void;
}

// Same dark "Intelligence Terminal" modal shell as RegisterModal
// (.modal-overlay / .modal-card) — nothing new introduced visually.
export default function AlertApprovalModal({
  messageAr, placeAr, expectedAffected, unrouted, onConfirm, onCancel,
}: AlertApprovalModalProps) {
  // No auth/session exists yet in this project (see services/embassies.ts
  // getCurrentAccess) — manual entry until a real signed-in user lands.
  const [approvedByAr, setApprovedByAr] = useState('');

  function handleConfirm() {
    const name = approvedByAr.trim();
    if (!name) return;
    onConfirm(name);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <button className="event-detail-close" onClick={onCancel} title="إلغاء"><X size={16} /></button>
        <div className="modal-title">
          <ShieldCheck size={14} style={{ marginLeft: 6, verticalAlign: '-2px' }} />
          اعتماد وإرسال الأمر للقنصلية
        </div>

        <div className="modal-field">
          <label>نص الرسالة</label>
          <p className="rd-text">{messageAr}</p>
        </div>
        <div className="form-row-split">
          <div className="modal-field">
            <label>الدولة / المنطقة</label>
            <p className="rd-text">{placeAr}</p>
          </div>
          <div className="modal-field">
            <label>عدد المتأثرين المتوقع</label>
            <p className="rd-text">{expectedAffected.toLocaleString('en-US')}</p>
          </div>
        </div>

        {unrouted && (
          <div className="rd-text" style={{ color: '#FF6D00' }}>
            لا توجد سفارة مهيأة لهذه الدولة ضمن النظام حاليًا — سيُسجَّل الاعتماد دون إرسال إشعار لقنصلية محددة.
          </div>
        )}

        <div className="modal-field">
          <label>المسؤول المعتمد</label>
          <input
            required
            value={approvedByAr}
            onChange={(e) => setApprovedByAr(e.target.value)}
            dir="rtl"
            placeholder="اسم المسؤول المعتمد"
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="rc-btn" style={{ flex: 1 }} onClick={onCancel}>
            إلغاء
          </button>
          <button
            type="button"
            className="btn-alert-all"
            style={{ flex: 1, background: '#FF1744' }}
            disabled={!approvedByAr.trim()}
            onClick={handleConfirm}
          >
            تأكيد الاعتماد
          </button>
        </div>
      </div>
    </div>
  );
}
