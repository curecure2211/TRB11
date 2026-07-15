const CACHE = 'trb-web-v56-bus-parada-flexible';
const STATIC_ASSETS = [
  './', './index.html', './styles.css?v=56', './app.js?v=56', './trb_motor_rutas.js?v=56',
  './manifest.webmanifest', './driver.html', './data/transit_data.json', './data/trb_catalogo_rutas.json',
  './vendor/jszip.min.js?v=33', './vendor/maplibre/maplibre-gl.js?v=33', './vendor/maplibre/maplibre-gl.css?v=33', './vendor/maplibre/leaflet-maplibre-gl.js?v=33', './maps/trb-map-style.json', './assets/trb-home-hero.jpg', './maps/README_MAPA_TRB.md', './icons/icon-192.png', './icons/icon-512.png', './icons/trb-favicon.png', './icons/favicon-32.png'
];

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE)
    .then(cache => cache.addAll(STATIC_ASSETS))
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Nunca cachear mosaicos externos: evita cuadrados mezclados o viejos en el mapa.
  if (url.origin !== location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Geometrías y KMZ siempre salen frescos del servidor local.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/kmz/') ||
    url.pathname.startsWith('/route_geometry/')
  ) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Durante desarrollo, HTML/JS/CSS usan red primero para no servir una versión vieja.
  if (
    event.request.mode === 'navigate' ||
    /\.(?:html|js|css)$/.test(url.pathname)
  ) {
    event.respondWith(networkFirst(event.request).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
