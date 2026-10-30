/*
  Интерактивное расписание для МГПУ (MCU Schedule)
  Copyright (c) 2026 Окороков Роман Александрович. Все права защищены.
*/

const CACHE_NAME = 'mgpu-schedule-v3';

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
      for (const asset of ASSETS_TO_CACHE) {
        try {
          await cache.add(asset);
        } catch (e) {
          console.warn('Не удалось закэшировать ресурс:', asset);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (url.includes('/api/') || 
      url.includes('telegram.org') || 
      url.includes('vk.com') ||
      url.includes('workers.dev')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;

        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./') || await caches.match('index.html');
          if (fallback) return fallback;
        }

        if (url.includes('schedule.json')) {
          const cachedDb = await caches.match('schedule.json', { ignoreSearch: true });
          if (cachedDb) return cachedDb;
        }

        return new Response('Офлайн: ресурс недоступен', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
