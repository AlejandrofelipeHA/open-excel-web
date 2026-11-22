const VERSION='v6';
const PREFIX='luma-shell:'+self.registration.scope+':';
const CACHE=PREFIX+VERSION;
const SHELL=[
  './','./index.html','./styles.css','./app.js','./manifest.json',
  './assets/icon-192.png','./assets/icon-512.png','./assets/xlsx.full.min.js',
  './core/grid-model.js','./core/dependency-graph.js','./core/formula-engine.js',
  './core/data-tools.js','./core/function-registry.js','./core/command-manager.js',
  './plugins/standard-functions.js','./plugins/functions/standard.js','./plugins/functions/example.js','./plugins/functions/extended.js',
  './ui/canvas-renderer.js','./ui/editor-overlay.js','./ui/selection.js',
  './io/clipboard.js','./io/file-manager.js','./io/ooxml.js','./ui/workbook-tools.js','./ui/chart-view.js'
];
const appURLs=new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all([...appURLs].map(async url=>{
      const fresh=new URL(url);
      fresh.searchParams.set('luma-shell',VERSION);
      const response=await fetch(fresh,{cache:'reload'});
      if (!response.ok) throw new Error('PWA shell: '+response.status+' '+url);
      await cache.put(url,response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(PREFIX)&&name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if (request.method!=='GET') return;
  const url=new URL(request.url);
  if (url.origin!==location.origin) return;
  const cacheKey=url.href.split('?')[0];
  if (!appURLs.has(cacheKey)) return;
  event.respondWith((async()=>{
    const cached=await (await caches.open(CACHE)).match(cacheKey);
    return cached ?? fetch(request);
  })());
});
