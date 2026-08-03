// OpenStreetMap Nominatim 장소 검색 (무료·키 불필요).
// 이용 정책상 초당 1회 이하로 호출해야 해서 디바운스 + 결과 캐시를 둔다.
// 길찾기(라우팅)는 유료 API 가 필요해 이 앱에는 넣지 않았다.
const cache = new Map();

export async function searchPlace(q, limit = 6) {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);

  const url = 'https://nominatim.openstreetmap.org/search'
    + `?format=jsonv2&addressdetails=1&limit=${limit}&accept-language=ko&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('장소 검색 실패');
  const rows = await res.json();
  const out = rows.map(r => ({
    name: (r.name || r.display_name.split(',')[0] || '').trim(),
    addr: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
  cache.set(key, out);
  return out;
}

/** 입력이 멎고 나서 실행 */
export function debounce(fn, ms = 550) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** 외부 지도 앱으로 열기 — 길찾기는 각 지도 서비스에 맡긴다 */
export function mapLinks(place) {
  const q = encodeURIComponent(place.name || `${place.lat},${place.lng}`);
  return [
    { label: '구글맵', url: place.lat ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}` : `https://www.google.com/maps/search/?api=1&query=${q}` },
    { label: '네이버지도', url: `https://map.naver.com/p/search/${q}` },
  ];
}
