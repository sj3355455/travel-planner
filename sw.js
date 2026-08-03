/* 여행 플래너 서비스 워커 — 오프라인 캐시 + 무중단 자동 업데이트
 *
 * ▶ 새 패치를 낼 때는 아래 VERSION 한 줄만 올리면 된다(예: v1 → v2).
 *   파일 내용이 바뀌면 브라우저가 새 워커로 감지 → 설치 → 활성화 → 제어권 교체 순으로 진행되고,
 *   그 순간 앱이 자동으로 1회 새로고침된다(app.js 의 controllerchange 처리). 폴링 불필요.
 *
 * 전략:
 *  - 코드(navigate/.html/.js/.css): 네트워크 우선 + HTTP 캐시 우회(cache:'reload') → 항상 최신
 *  - 그 외 정적 자산: 캐시 우선 + 백그라운드 갱신
 *  - 외부 출처(Supabase / 지도 타일 / Nominatim): 가로채지 않음
 */
const VERSION = 'v5';
const BASE = new URL('.', self.location).pathname;
const CACHE = 'travel' + BASE + VERSION;

const ASSETS = [
  '', 'index.html', 'styles.css', 'manifest.json',
  'js/app.js', 'js/store.js', 'js/ui.js', 'js/supabase.js', 'js/config.js', 'js/geo.js', 'js/itemEditor.js',
  'js/exportMd.js', 'js/install.js',
  'js/views/plan.js', 'js/views/timetable.js', 'js/views/map.js', 'js/views/budget.js', 'js/views/checklist.js',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
].map(p => BASE + p);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 개별 캐싱 — 파일 하나가 실패해도 설치가 통째로 깨지지 않게
    await Promise.allSettled(ASSETS.map(a => cache.add(new Request(a, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const mine = 'travel' + BASE;
    await Promise.all(keys.filter(k => k.startsWith(mine) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase·타일·Nominatim 은 통과

  const isCode = req.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname);

  if (isCode) {
    // 네트워크 우선. HTTP 캐시까지 우회해야 GitHub Pages 의 max-age 때문에 옛 코드가 나오지 않는다.
    e.respondWith((async () => {
      try {
        const res = await fetch(new Request(req, { cache: 'reload' }));
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match(BASE + 'index.html')) || Response.error();
      }
    })());
    return;
  }

  // 그 외: 캐시 우선 + 백그라운드 갱신
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const net = fetch(req).then(res => {
      caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => cached || Response.error());
    return cached || net;
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'getVersion') e.source.postMessage({ type: 'appVersion', version: VERSION });
});
