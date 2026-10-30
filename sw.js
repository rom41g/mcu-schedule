/*
  Интерактивное расписание для МГПУ (MCU Schedule)
  Copyright (c) 2026 Окороков Роман Александрович. Все права защищены.
*/

const CACHE_NAME = 'mgpu-schedule-v4';

const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'logo.png',
  'schedule.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map((asset) => cache.add(asset))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== 'mgpu-db-cache' && key !== 'mgpu-hw-cache') {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия Stale-While-Revalidate: мгновенно отдаем из кэша, в фоне обновляем
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  if (url.includes('/api/') || 
      url.includes('telegram.org') || 
      url.includes('vk.com') ||
      url.includes('unpkg.com') ||
      url.includes('workers.dev')) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => null);

      // Если есть в кэше — отдаем за 0 мс, не дожидаясь сети
      return cachedResponse || fetchPromise.then((res) => {
        if (res) return res;
        if (event.request.mode === 'navigate') {
          return caches.match('./') || caches.match('index.html');
        }
        return new Response('Офлайн: ресурс недоступен', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});
