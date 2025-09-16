self.addEventListener("install", e=>self.skipWaiting());
self.addEventListener("activate", e=>self.clients.claim());

const CACHE_VERSION = 'V0.0.4';

// Während der Entwicklung: für JS-Dateien Netzwerk bevorzugen (hält Breakpoints aktuell)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // optional: in Cache legen
          const copy = res.clone();
          caches.open('js-dev-' + CACHE_VERSION).then(c => c.put(event.request, copy)).catch(()=>{});
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return; // JS behandelt, Rest fällt in bestehende Logik
  }
  // ... deine bestehende fetch-Strategie folgt hier ...
});
