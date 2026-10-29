/* ============================================================
   SERVICE WORKER • ОФЛАЙН КЭШИРОВАНИЕ РАСПИСАНИЯ МГПУ
============================================================ */
const CACHE_NAME = 'mgpu-schedule-v2';

const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'logo.png',
  'schedule.json'
];

// Установка: предварительное кэширование основы приложения
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Активация: удаление старых версий кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват сетевых запросов: Network First с переходом в кэш
self.addEventListener('fetch', (event) => {
  // Запросы к внешним API (Worker, Telegram, VK Bridge) пропускаем мимо кэша файлов
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('telegram.org') || 
      event.request.url.includes('vk.com') ||
      event.request.url.includes('workers.dev')) {
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
      .catch(() => {
        // Если интернета нет — отдаём файл из кэша
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
      })
  );
});
