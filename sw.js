// Lichtbak service worker: laat de app offline werken en ontvangt gedeelde foto's.
const VERSION = 'lichtbak-v3';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'engine.js', 'store.js', 'sample.js', 'bewerk.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lichtbak-v') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);

  // Foto's die vanuit de galerij naar Lichtbak worden gedeeld
  if(req.method === 'POST' && url.pathname.endsWith('/share')){
    e.respondWith((async () => {
      try {
        const form = await req.formData(), files = form.getAll('photos'), inbox = await caches.open('lichtbak-inbox');
        let i = 0;
        for(const f of files){
          if(!(f instanceof File)) continue;
          await inbox.put(new Request(`./__inbox/${Date.now()}-${i++}`), new Response(f, {headers:{'content-type':f.type || 'image/jpeg', 'x-name':encodeURIComponent(f.name || 'gedeeld.jpg')}}));
        }
      } catch(_){}
      return Response.redirect('./?gedeeld=1', 303);
    })());
    return;
  }
  if(req.method !== 'GET') return;

  // Lettertypen voor tekst/watermerk: na één keer online ook offline beschikbaar
  if(url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com'){
    e.respondWith(caches.open('lichtbak-fonts').then(async c => {
      const hit = await c.match(req); if(hit) return hit;
      try { const res = await fetch(req); if(res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; } catch(_){ return Response.error(); }
    }));
    return;
  }
  if(url.origin !== location.origin) return;

  // App zelf: direct uit de cache, op de achtergrond bijwerken
  e.respondWith(caches.open(VERSION).then(async c => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = await c.match(key, {ignoreSearch:true});
    const net = fetch(req).then(res => { if(res.ok && req.mode !== 'navigate') c.put(req, res.clone()); if(res.ok && req.mode === 'navigate') c.put('index.html', res.clone()); return res; }).catch(() => null);
    if(hit){ e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline', {status:503});
  }));
});
