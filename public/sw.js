/* Service worker: makes the app shell load offline.
   Strategy: network-first for navigation + static assets (so updates
   arrive when online), falling back to cache when offline.
   API calls (/api/) always go to the network and are never cached. */

const CACHE = 'ortho-rounds-v26';
const SHELL = ['./', 'index.html', 'milestones.js', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-maskable.svg'];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API or non-GET; let them hit the network directly.
  if(req.method !== 'GET' || url.pathname.startsWith('/api/')){
    return;
  }
  // Only handle same-origin requests.
  if(url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res=>{
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
        }
        return res;
      })
      .catch(()=> caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
