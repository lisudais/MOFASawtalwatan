// Service Worker — handles push events and notification action clicks

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};

  const options = {
    body: data.body ?? 'Emergency alert from Saudi MFA',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    image: data.image ?? null,
    tag: data.tag ?? 'mfa-alert',
    renotify: true,
    requireInteraction: true,        // stays on screen until user acts
    vibrate: [300, 100, 300, 100, 600],
    timestamp: data.timestamp ?? Date.now(),
    dir: 'auto',
    data: {
      url: data.url ?? '/',
      travelerId: data.travelerId,
      eventId: data.eventId,
      riskLevel: data.riskLevel,
    },
    actions: [
      {
        action: 'evacuate',
        title: '🚨 إجراء طارئ · Emergency Action',
      },
      {
        action: 'acknowledge',
        title: '✓ تم الاستلام · Acknowledge',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Saudi MFA Alert', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  const { url, travelerId, eventId, riskLevel } = event.notification.data ?? {};

  if (action === 'evacuate') {
    event.waitUntil(
      clients.openWindow(`${url}?action=evacuate&traveler=${travelerId}&event=${eventId}`)
    );
  } else if (action === 'acknowledge') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'ACK', travelerId, eventId });
          return client.focus();
        }
        return clients.openWindow(url);
      })
    );
  } else {
    // Default tap — open the dashboard
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        return clients.openWindow(url);
      })
    );
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
