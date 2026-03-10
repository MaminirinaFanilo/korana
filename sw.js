// ════════════════════════════════════════════
//  KORANA — sw.js  (Service Worker)
//  Notifications push natives desktop + mobile
// ════════════════════════════════════════════

const SW_VERSION = 'korana-sw-v1';

// ── Installation du SW ──
self.addEventListener('install', event => {
  console.log('[KORANA SW] Installé v1');
  self.skipWaiting();
});

// ── Activation ──
self.addEventListener('activate', event => {
  console.log('[KORANA SW] Activé');
  event.waitUntil(self.clients.claim());
});

// ── Réception d'un message depuis la page ──
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'NEW_MESSAGE') return;

  const { senderName, senderAvatar, text, roomLabel, isImage } = data;

  const body = isImage
    ? `${senderAvatar} ${senderName} a envoyé une photo`
    : `${senderAvatar} ${senderName}: ${text.length > 80 ? text.slice(0, 80) + '…' : text}`;

  const title = roomLabel ? `KORANA · ${roomLabel}` : 'KORANA';

  const options = {
    body,
    icon:  '/favicon.ico',
    badge: '/favicon.ico',
    tag:   `korana-msg-${Date.now()}`,
    renotify: true,
    vibrate: [120, 60, 120],
    silent: false,
    data: { url: self.registration.scope, ts: Date.now() },
    actions: [
      { action: 'open',    title: '💬 Répondre' },
      { action: 'dismiss', title: 'Ignorer'      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Clic sur la notification ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // Ouvrir ou focus la fenêtre KORANA
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Si un onglet KORANA est déjà ouvert → focus
        for (const client of clientList) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            return client.focus();
          }
        }
        // Sinon ouvrir un nouvel onglet
        if (self.clients.openWindow) {
          return self.clients.openWindow(event.notification.data?.url || '/');
        }
      })
  );
});

// ── Fermeture de notification (analytics optionnel) ──
self.addEventListener('notificationclose', event => {
  console.log('[KORANA SW] Notification fermée', event.notification.tag);
});
