// HQ alert-approval workflow: an HQ analyst approves a citizen alert instead
// of sending it directly, then the owning consulate executes the real send.
// No backend exists yet, so the queue lives in localStorage (same pattern as
// services/history.ts) — swap the read/write pair for a real API later, the
// call sites won't change.
//
// This is also the single shared state source for the workflow: both the
// main dashboard (AlertDetailsPanel) and the consulate view (EmbassyDashboard)
// read it through `useApprovedAlerts()`, so a status change made on one side
// (e.g. the consulate executing a send) is reflected on the other without a
// manual refresh — via the native `storage` event across tabs, and a same-tab
// custom event (`storage` never fires in the tab that made the write).

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'alert-approval-queue';
const CHANGE_EVENT = 'alert-approval-queue:changed';

export type AlertApprovalStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'              // معتمد — بانتظار تنفيذ القنصلية
  | 'SENDING'                // قيد الإرسال
  | 'SENT';                  // تم الإرسال

export const ALERT_APPROVAL_STATUS_AR: Record<AlertApprovalStatus, string> = {
  DRAFT: 'مسودة',
  PENDING_APPROVAL: 'بانتظار اعتماد',
  APPROVED: 'معتمد — بانتظار تنفيذ القنصلية',
  SENDING: 'قيد الإرسال',
  SENT: 'تم الإرسال',
};

export const ALERT_APPROVAL_STATUS_COLOR: Record<AlertApprovalStatus, string> = {
  DRAFT: '#8B98AE',
  PENDING_APPROVAL: '#FFD600',
  APPROVED: '#C9A84C',
  SENDING: '#FF6D00',
  SENT: '#00E676',
};

export interface ApprovedAlertSummary {
  id: string;
  embassyId: string;
  messageAr: string;
  countryCode: string;
  countryAr: string;
  expectedAffected: number;
  status: AlertApprovalStatus;
  approvedByAr: string;
  approvedAt: string; // ISO
  sentByAr?: string;
  sentAt?: string; // ISO
  /** The FeedCard this alert was approved from (content-addressed, stable
   *  across feed refreshes) — lets the main dashboard find its way back from
   *  a queue entry to the card it should badge. Optional: older/manually
   *  seeded entries may not have one. */
  sourceCardId?: string;
}

function readAll(): ApprovedAlertSummary[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(list: ApprovedAlertSummary[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — the approval simply won't persist this session
  }
  // Same-tab listeners (native `storage` only fires in OTHER tabs).
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getApprovedAlerts(): ApprovedAlertSummary[] {
  return readAll();
}

/** Live view of the approval queue — re-reads on any write, this tab or
 *  another. This IS the "shared state" the workflow syncs through. */
export function useApprovedAlerts(): ApprovedAlertSummary[] {
  const [alerts, setAlerts] = useState<ApprovedAlertSummary[]>(() => readAll());
  useEffect(() => {
    const reload = () => setAlerts(readAll());
    window.addEventListener('storage', reload);
    window.addEventListener(CHANGE_EVENT, reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener(CHANGE_EVENT, reload);
    };
  }, []);
  return alerts;
}

/** Records an HQ approval. Called once, from the confirmation modal — this
 *  IS the audit trail (approver name + timestamp), not a re-send of it. */
export function addApprovedAlert(input: {
  embassyId: string;
  messageAr: string;
  countryCode: string;
  countryAr: string;
  expectedAffected: number;
  approvedByAr: string;
  sourceCardId?: string;
}): ApprovedAlertSummary {
  const entry: ApprovedAlertSummary = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'APPROVED',
    approvedAt: new Date().toISOString(),
    ...input,
  };
  const list = readAll();
  list.push(entry);
  writeAll(list);
  return entry;
}

export function markAlertSending(id: string): void {
  const list = readAll();
  const i = list.findIndex((a) => a.id === id);
  if (i === -1) return;
  list[i] = { ...list[i], status: 'SENDING' };
  writeAll(list);
}

/** The real dispatch point — same logic that used to sit behind the main
 *  dashboard's send button, now triggered from the consulate side only. */
export function markAlertSent(id: string, sentByAr: string): void {
  const list = readAll();
  const i = list.findIndex((a) => a.id === id);
  if (i === -1) return;
  list[i] = { ...list[i], status: 'SENT', sentByAr, sentAt: new Date().toISOString() };
  writeAll(list);
}

/** Shared by both dashboards for approval/execution timestamps. */
export function formatDateTimeAr(d: Date): string {
  return d.toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
}
