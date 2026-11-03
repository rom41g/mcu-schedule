/*
  Интерактивное расписание для МГПУ (MCU Schedule)
  Copyright (c) 2026 Окороков Роман Александрович. Все права защищены.
*/

// ВЕРСИЯ КЭША ОБНОВЛЕНА ДЛЯ СБРОСА ВСЕХ СТАРЫХ ФАЙЛОВ
const CACHE_NAME = 'mgpu-schedule-v6';

const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'logo.png',
  'schedule.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map((asset) => cache.add(asset))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // Удаляем старые кэши (включая mgpu-schedule-v5)
          if (key !== CACHE_NAME && key !== 'mgpu-hw-cache') {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// СТРАТЕГИЯ: NETWORK-FIRST ДЛЯ СТРАНИЦЫ И РАСПИСАНИЯ
// Всегда берём свежий index.html и schedule.json с GitHub, если есть интернет.
// И только если сеть недоступна (офлайн) — отдаём сохранённую копию.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Игнорируем запросы к API воркера и внешним библиотекам
  if (url.includes('/api/') || 
      url.includes('telegram.org') || 
      url.includes('vk.com') ||
      url.includes('unpkg.com') ||
      url.includes('workers.dev')) {
    return;
  }

  const isHtmlOrSchedule = event.request.mode === 'navigate' || 
                           url.endsWith('/index.html') || 
                           url.endsWith('/schedule.json') ||
                           url.endsWith('/');

  if (isHtmlOrSchedule) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('index.html') || caches.match('./');
            }
            return new Response('Офлайн: ресурс недоступен', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
        })
    );
    return;
  }

  // Для картинок и статики используем кэш с обновлением в фоне
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});
