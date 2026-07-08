import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, ref, push, onValue, set, type Database } from 'firebase/database';

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  databaseURL: string;
  projectId?: string;
}

const STORAGE_KEY = 'mfa-firebase-config';

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function loadFirebaseConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveFirebaseConfig(cfg: FirebaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function initFirebase(cfg: FirebaseConfig): void {
  try {
    app = initializeApp(cfg);
    db = getDatabase(app);
  } catch {
    app = null;
    db = null;
  }
}

export function isFirebaseReady(): boolean {
  return db !== null;
}

export interface CommitteeResponse {
  type: 'SAFE' | 'SOS';
  travelerName: string;
  eventId: string;
  timestamp: number;
}

export function sendCommitteeAlert(eventId: string, message: string): void {
  if (!db) return;
  set(ref(db, `alerts/${eventId}`), { message, timestamp: Date.now() });
}

export function submitCommitteeResponse(response: CommitteeResponse): void {
  if (!db) return;
  push(ref(db, `responses/${response.eventId}`), response);
}

export function subscribeToResponses(
  eventId: string,
  callback: (responses: CommitteeResponse[]) => void
): () => void {
  if (!db) return () => {};
  const responsesRef = ref(db, `responses/${eventId}`);
  const unsubscribe = onValue(responsesRef, (snapshot) => {
    const value = snapshot.val() ?? {};
    callback(Object.values(value) as CommitteeResponse[]);
  });
  return () => unsubscribe();
}

export function subscribeToAlert(
  eventId: string,
  callback: (alert: { message: string; timestamp: number } | null) => void
): () => void {
  if (!db) return () => {};
  const alertRef = ref(db, `alerts/${eventId}`);
  const unsubscribe = onValue(alertRef, (snapshot) => {
    callback(snapshot.val());
  });
  return () => unsubscribe();
}
