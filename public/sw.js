// ============ SERVICE WORKER UNTUK WEB PUSH ============
self.addEventListener("install", (event) => {
  console.log("[SW] Installed");
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activated");
  event.waitUntil(self.clients.claim());
});

// ============ TERIMA PUSH ============
self.addEventListener("push", (event) => {
  let data = { title: "Notifikasi Baru", body: "Ada update." };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    // Jika data bukan JSON, gunakan text
    data.body = event.data ? event.data.text() : "Ada update.";
  }

  const options = {
    body: data.body,
    icon: "/assets/favicon/favicon-48x48.png", // Ganti dengan icon Anda
    badge: "/assets/favicon/favicon-32x32.png",
    vibrate: [200, 100, 200],
    data: {
      url: "/", // URL yang akan dibuka saat notifikasi diklik
    },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ============ KLIK NOTIFIKASI ============
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Jika sudah ada tab yang terbuka, fokuskan
        for (const client of windowClients) {
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        // Jika tidak, buka tab baru
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
