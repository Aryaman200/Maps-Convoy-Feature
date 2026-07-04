/* ============================================================
   CONVOY MODE — SERVICE WORKER
   ============================================================
   Precaches the app shell for offline use and applies per-route
   caching strategies:
     • cache-first          → same-origin app shell
     • stale-while-revalidate → CARTO map tiles + Google Fonts
     • network-first         → everything else
   Offline navigations fall back to the cached /index.html.
   ============================================================ */

/* ── Cache Versioning ──────────────────────────────────── */
const VERSION = 'v1.0.0';
const CACHE_NAME = `convoy-shell-${VERSION}`;
const RUNTIME_CACHE = `convoy-runtime-${VERSION}`;
const OWNED_CACHES = [CACHE_NAME, RUNTIME_CACHE];

/* ── App Shell (precache list) ─────────────────────────── */
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',

  /* CSS */
  '/css/design-system.css',
  '/css/components.css',
  '/css/animations.css',
  '/css/map.css',

  /* JS (load order mirrors index.html) */
  '/js/utils.js',
  '/js/route-data.js',
  '/js/route-model.js',
  '/js/map.js',
  '/js/convoy.js',
  '/js/navigation.js',
  '/js/voice.js',
  '/js/activity.js',
  '/js/dashboard.js',
  '/js/ui.js',
  '/js/app.js',
  '/js/pwa.js',

  /* Icons */
  '/icons/icon.svg',
  '/icons/maskable.svg'
];

/* ── Cross-origin hosts for stale-while-revalidate ─────── */
const SWR_HOSTS = [
  'basemaps.cartocdn.com',   // CARTO map tiles
  'fonts.googleapis.com',    // Google Fonts stylesheets
  'fonts.gstatic.com'        // Google Fonts font files
];

/* ── Install: precache the app shell ───────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* addAll is atomic — but tolerate individual misses so a single
       404 never blocks the whole install. */
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res.clone());
      } catch (_) { /* asset unavailable at install time — ignore */ }
    }));
    await self.skipWaiting();
  })());
});

/* ── Activate: drop stale caches, take control ─────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !OWNED_CACHES.includes(k)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ── Message: allow the page to trigger an update ──────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Fetch: route to the right strategy ────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  /* Only handle GET; let the browser deal with the rest. */
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* Navigation requests → app-shell / offline fallback. */
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  /* Same-origin app shell → cache-first. */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* CARTO tiles + Google Fonts → stale-while-revalidate. */
  if (SWR_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* Everything else → network-first. */
  event.respondWith(networkFirst(request));
});

/* ── Strategy: navigation with offline fallback ────────── */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    /* Keep the shell fresh for next offline load. */
    const cache = await caches.open(CACHE_NAME);
    cache.put('/index.html', fresh.clone()).catch(() => {});
    return fresh;
  } catch (_) {
    const cache = await caches.open(CACHE_NAME);
    return (
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/')) ||
      Response.error()
    );
  }
}

/* ── Strategy: cache-first ─────────────────────────────── */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    return cached || Response.error();
  }
}

/* ── Strategy: stale-while-revalidate ──────────────────── */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((res) => {
      /* Cache opaque + ok responses; skip errors. */
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}

/* ── Strategy: network-first ───────────────────────────── */
async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}
