// 일정 탭 — 일차별 카드 목록
import { h } from '../ui.js';
import { store, tripDays, catOf, toKRW, won, dayColor } from '../store.js';
import { openItemEditor } from '../itemEditor.js';
import { mapLinks } from '../geo.js';

let selectedDay = 0;

export function renderPlan(root) {
  const meta = store.doc.meta;
  const days = tripDays(meta);
  if (selectedDay >= days.length) selectedDay = 0;

  const items = store.all('items');
  const byDay = d => items.filter(i => (i.day || 0) === d).sort(sortByTime);

  root.append(dayStrip(days, items));

  if (!days.length) {
    root.append(empty('여행 날짜를 먼저 정해주세요', '오른쪽 위 ⚙ 설정에서 시작일과 종료일을 입력하면 일차가 생깁니다.'));
    return;
  }

  const day = days[selectedDay];
  const list = byDay(selectedDay);
  const dayTotal = list.reduce((s, i) => s + toKRW(i, meta), 0);

  root.append(h('div.day-head',
    h('div', h('strong', day.label), h('span.muted', ' · ' + day.sub)),
    h('span.day-total', dayTotal ? won(dayTotal) : ''),
  ));

  if (!list.length) {
    root.append(empty('아직 일정이 없습니다', '아래 + 버튼으로 첫 일정을 추가해 보세요.'));
  } else {
    const wrap = h('div.cards');
    list.forEach((it, idx) => wrap.append(itemCard(it, idx, meta)));
    root.append(wrap);
  }

  root.append(h('button.fab', { onclick: () => openItemEditor(null, { day: selectedDay }) }, '+'));
}

function sortByTime(a, b) {
  const ta = a.start || '99:99', tb = b.start || '99:99';
  return ta === tb ? (a.title || '').localeCompare(b.title || '') : ta < tb ? -1 : 1;
}

function dayStrip(days, items) {
  const strip = h('div.chips');
  days.forEach(d => {
    const n = items.filter(i => (i.day || 0) === d.index).length;
    strip.append(h('button', {
      class: 'chip' + (d.index === selectedDay ? ' on' : ''),
      style: d.index === selectedDay ? { borderColor: dayColor(d.index), color: dayColor(d.index) } : {},
      onclick: () => { selectedDay = d.index; store.emit('change'); },
    }, h('strong', d.label), h('span.muted.small', d.sub), n ? h('span.badge', n) : null));
  });
  return strip;
}

function itemCard(it, idx, meta) {
  const c = catOf(it.cat);
  const cost = toKRW(it, meta);
  const time = it.start ? (it.end ? `${it.start}–${it.end}` : it.start) : '시간 미정';

  const links = (it.lat != null)
    ? h('div.card-links', ...mapLinks({ name: it.placeName, lat: it.lat, lng: it.lng }).map(l =>
        h('a.linkbtn', { href: l.url, target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, l.label)))
    : null;

  return h('div.card', { onclick: () => openItemEditor(it) },
    h('div.card-time', h('span.no', String(idx + 1)), h('span', time)),
    h('div.card-main',
      h('div.card-title', h('span.cat-dot', { style: { background: c.color } }, c.icon), h('strong', it.title)),
      it.placeName ? h('div.muted.small', (it.lat != null ? '📍 ' : '') + it.placeName) : null,
      it.memo ? h('div.card-memo', it.memo) : null,
      links,
    ),
    h('div.card-cost', cost ? won(cost) : ''),
  );
}

function empty(title, sub) {
  return h('div.empty', h('strong', title), h('p.muted', sub));
}
