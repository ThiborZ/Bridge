/*
 * Offline support.
 *
 * The point is not speed — the whole game is under thirty kilobytes — it is that
 * once she has opened it, it keeps working on a tablet with no wifi. It is also
 * what makes the browser offer "add to home screen" at all: without a service
 * worker there is no install prompt to show.
 *
 * The strategy differs by request on purpose. The page itself is fetched from
 * the network first, so a new version is picked up as soon as there is a
 * connection; assets are served from the cache first, because Vite gives them
 * hashed filenames and a hashed file never changes.
 */

/*
 * The cache is named after the build. The registration URL carries `?v=<build>`,
 * so every deploy is a distinct worker with a distinct cache, and `activate`
 * below deletes the previous one. A fixed name would accumulate every asset ever
 * shipped and make "why is she still on the old version" a real question.
 */
const VERSION = `bridge-${new URL(self.location.href).searchParams.get('v') ?? 'dev'}`;

self.addEventListener('install', (event) => {
  // Take over straight away rather than waiting for every tab to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== VERSION) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(VERSION);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          // No connection: the copy from last time will do.
          return (await caches.match(request)) ?? (await caches.match('./')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(VERSION);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
