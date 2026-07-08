import type { GeoEvent, Traveler } from '../types';

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export async function sendPushNotification(event: GeoEvent, traveler: Traveler): Promise<void> {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(`Saudi MFA Alert — ${event.riskLevel}`, {
    body: `${traveler.nameEn}: ${event.title} (${event.country})`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: `mfa-alert-${event.id}`,
    requireInteraction: true,
    data: {
      url: '/',
      travelerId: traveler.id,
      eventId: event.id,
      riskLevel: event.riskLevel,
    },
  } as NotificationOptions);
}

export function onAcknowledge(callback: (travelerId: string, eventId: string) => void): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'ACK' && event.data.travelerId && event.data.eventId) {
      callback(event.data.travelerId, event.data.eventId);
    }
  });
}
