self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title ?? 'MealFlow';
  const options = { body: data.body ?? '', icon: '/android-chrome-192x192.png' };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
