const CACHE='luma-shell-v2';
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
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith('luma-shell-')&&name!==CACHE).map(name=>caches.delete(name)));
    // A navigation loads one coherent shell version; open editors keep their current code.
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
