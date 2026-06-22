self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Notifikasi dari sistem',
    icon: data.icon || 'https://raw.githubusercontent.com/TheGetsuzoZhiro/image/refs/heads/main/43D434F0-C01C-4A9E-8A5C-93B650B5981C.png',
    badge: data.badge || '/badge.png',
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Sinyal Baru', options));
});