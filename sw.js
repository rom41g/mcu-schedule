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
      for (const asset of ASSETS_TO_CACHE) {
        try {
          await cache.add(new Request(asset, { cache: 'reload' }));
        } catch (e) {}
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== 'mgpu-db-cache') {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Таймаут для сетевых запросов, чтобы приложение никогда не зависало на белом экране
function fetchWithTimeout(request, timeoutMs = 1800) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;

  // Запросы к API воркера не кэшируем в SW (для них есть localStorage в index.html)
  if (url.includes('/api/') || url.includes('workers.dev')) {
    return;
  }

  // Для внешних SDK (Telegram / VK) в офлайне мгновенно отдаем пустую заглушку, чтобы не вешать экран
  if (url.includes('telegram.org') || url.includes('unpkg.com') || url.includes('vk.com')) {
    event.respondWith(
      fetchWithTimeout(event.request, 1200)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || new Response('// offline sdk stub', {
            status: 200,
            headers: { 'Content-Type': 'application/javascript' }
          });
        })
    );
    return;
  }

  // Для самой страницы, иконок и schedule.json: мгновенная отдача из кэша с фоновым обновлением
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });

      const networkPromise = fetchWithTimeout(event.request, 2500)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkRes;
        })
        .catch(() => null);

      // Если есть в кэше — отдаем МГНОВЕННО, не дожидаясь сети (0 мс задержки в авиарежиме)
      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }

      const netRes = await networkPromise;
      if (netRes) return netRes;

      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('index.html', { ignoreSearch: true }) || 
                         await caches.match('./', { ignoreSearch: true });
        if (fallback) return fallback;
      }

      if (url.includes('schedule.json')) {
        const dbCache = await caches.open('mgpu-db-cache');
        const dbMatch = await dbCache.match('schedule.json', { ignoreSearch: true });
        if (dbMatch) return dbMatch;
      }

      return new Response('Офлайн', { status: 503 });
    })()
  );
});
