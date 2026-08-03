// 지도 탭 — Leaflet + OpenStreetMap (키·결제 불필요)
// 길찾기는 유료 API 가 필요해 넣지 않았다. 대신 일차별 방문 순서를 점선으로만 이어 보여주고,
// 실제 경로 안내는 각 핀의 "구글맵/네이버지도" 링크로 넘긴다.
import { h, toast } from '../ui.js';
import { store, tripDays, catOf, dayColor } from '../store.js';
import { openItemEditor } from '../itemEditor.js';
import { mapLinks } from '../geo.js';

let mapEl = null;      // 지도 DOM (탭을 오갈 때 재사용)
let map = null;
let layer = null;
let meLayer = null;    // 내 위치 마커
let dayFilter = 'all'; // 'all' | 일차 index
let pickMode = false;

export function renderMap(root) {
  const days = tripDays(store.doc.meta);
  const items = store.all('items').filter(i => i.lat != null && i.lng != null);

  // 필터 칩
  const chips = h('div.chips',
    h('button', { class: 'chip' + (dayFilter === 'all' ? ' on' : ''), onclick: () => { dayFilter = 'all'; store.emit('change'); } }, '전체'),
    ...days.map(d => h('button', {
      class: 'chip' + (dayFilter === d.index ? ' on' : ''),
      style: dayFilter === d.index ? { borderColor: dayColor(d.index), color: dayColor(d.index) } : {},
      onclick: () => { dayFilter = d.index; store.emit('change'); },
    }, d.label)),
  );
  root.append(chips);

  if (!mapEl) mapEl = h('div#leafmap.mapbox');
  root.append(mapEl);

  root.append(h('div.map-tools',
    h('button', {
      class: 'btn small' + (pickMode ? ' primary' : ''),
      onclick: () => { pickMode = !pickMode; toast(pickMode ? '지도를 눌러 위치를 지정하세요' : '위치 찍기 해제'); store.emit('change'); },
    }, pickMode ? '위치 찍는 중… (해제)' : '📍 지도에서 위치 찍어 추가'),
    h('button.btn.small', { onclick: locateMe }, '🧭 내 위치'),
    h('span.muted.small', `핀 ${items.length}개`),
  ));

  // 지도 초기화·갱신은 DOM 에 붙은 뒤에. rAF 는 탭이 화면에 없으면 안 돌아서 setTimeout 을 쓴다.
  setTimeout(() => drawMap(items, days), 0);
}

function drawMap(items, days) {
  if (!window.L) return;
  if (!map) {
    map = L.map(mapEl, { zoomControl: true, attributionControl: true })
      .setView([25.034, 121.564], 11);   // 기본 위치: 타이베이
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    map.on('click', e => {
      if (!pickMode) return;
      pickMode = false;
      openItemEditor(null, {
        day: dayFilter === 'all' ? 0 : dayFilter,
        lat: e.latlng.lat, lng: e.latlng.lng,
        placeName: `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`,
      });
    });
  }
  map.invalidateSize();

  if (layer) layer.remove();
  layer = L.layerGroup().addTo(map);

  const shown = items.filter(i => dayFilter === 'all' || (i.day || 0) === dayFilter);
  const bounds = [];

  // 일차별로 방문 순서대로 번호 매기고 점선으로 잇는다
  const groups = new Map();
  for (const it of shown) {
    const d = it.day || 0;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(it);
  }

  for (const [d, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => (a.start || '99:99') < (b.start || '99:99') ? -1 : 1);
    const color = dayColor(d);
    const pts = [];

    list.forEach((it, i) => {
      const ll = [it.lat, it.lng];
      pts.push(ll);
      bounds.push(ll);
      const c = catOf(it.cat);
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: `<div class="pin" style="background:${color}"><span>${i + 1}</span></div>`,
        iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26],
      });
      const links = mapLinks(it).map(l => `<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join(' · ');
      const time = it.start ? `${it.start}${it.end ? '–' + it.end : ''} · ` : '';
      const popup = h('div.pop',
        h('b', `${c.icon} ${it.title}`),
        h('div.pop-sub', `${days[d] ? days[d].label : ''} · ${time}${it.placeName || ''}`),
        h('div.pop-links', { html: links }),
        h('button.linkbtn', { onclick: () => openItemEditor(it) }, '✏️ 이 일정 편집'),
      );
      L.marker(ll, { icon }).bindPopup(popup).addTo(layer);
    });

    if (pts.length > 1) {
      L.polyline(pts, { color, weight: 2, opacity: .65, dashArray: '6 6' }).addTo(layer);
    }
  }

  if (bounds.length === 1) map.setView(bounds[0], 14);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
}

/** 브라우저 위치 권한을 받아 현재 위치를 찍는다 (여행 중 "나 지금 어디" 확인용) */
function locateMe() {
  if (!navigator.geolocation) { toast('이 브라우저는 위치를 지원하지 않습니다'); return; }
  if (!map) { toast('지도를 먼저 불러오는 중입니다'); return; }
  toast('위치를 확인하는 중…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (meLayer) meLayer.remove();
      meLayer = L.marker(ll, {
        icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      }).bindPopup('현재 위치').addTo(map);
      map.setView(ll, 15);
      toast('현재 위치를 찾았습니다');
    },
    err => toast(err.code === 1 ? '위치 권한이 거부되었습니다' : '위치를 찾지 못했습니다'),
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

/** 탭을 떠날 때 지도 DOM 이 사라지지 않도록 보관 */
export function detachMap() {
  if (mapEl && mapEl.parentNode) mapEl.remove();
}
