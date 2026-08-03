// 시간표 탭 — 일차를 열, 시각을 행으로 놓은 학교 시간표 형태
import { h } from '../ui.js';
import { store, tripDays, catOf, dayColor } from '../store.js';
import { openItemEditor } from '../itemEditor.js';

const HOUR_PX = 56;      // 1시간 높이
const MIN_SPAN = 30;     // 종료시각 없는 일정의 기본 길이(분)

const toMin = t => { const [h_, m] = (t || '').split(':').map(Number); return h_ * 60 + (m || 0); };
const pad = n => String(n).padStart(2, '0');

export function renderTimetable(root) {
  const days = tripDays(store.doc.meta);
  const items = store.all('items');

  if (!days.length) {
    root.append(h('div.empty', h('strong', '여행 날짜를 먼저 정해주세요'), h('p.muted', '⚙ 설정에서 시작일·종료일을 입력하세요.')));
    return;
  }

  const timed = items.filter(i => i.start);
  const untimed = items.filter(i => !i.start);

  // 표시 범위: 일정이 걸친 시간대 ±여유. 일정이 없으면 08–22시.
  let lo = 8 * 60, hi = 22 * 60;
  if (timed.length) {
    lo = Math.min(...timed.map(i => toMin(i.start)));
    hi = Math.max(...timed.map(i => Math.max(toMin(i.end || i.start) , toMin(i.start) + MIN_SPAN)));
    lo = Math.floor(lo / 60) * 60;
    hi = Math.ceil(hi / 60) * 60;
    if (hi - lo < 240) hi = lo + 240;
  }
  const hours = (hi - lo) / 60;
  const gridH = hours * HOUR_PX;

  // ── 시간 눈금 ───────────────────────────────────────────
  const gutter = h('div.tt-gutter', { style: { height: gridH + 'px' } });
  for (let m = lo; m <= hi; m += 60) {
    gutter.append(h('span.tt-hour', { style: { top: ((m - lo) / 60 * HOUR_PX) + 'px' } }, `${pad(Math.floor(m / 60) % 24)}:00`));
  }

  // ── 일차 열 ─────────────────────────────────────────────
  const cols = h('div.tt-cols');
  const head = h('div.tt-head');
  head.append(h('div.tt-head-cell.gutter-cell', ''));

  days.forEach(d => {
    head.append(h('div.tt-head-cell',
      h('strong', { style: { color: dayColor(d.index) } }, d.label),
      h('span.muted.small', d.sub)));

    const col = h('div.tt-col', { style: { height: gridH + 'px' } });
    for (let m = lo + 60; m < hi; m += 60) {
      col.append(h('div.tt-line', { style: { top: ((m - lo) / 60 * HOUR_PX) + 'px' } }));
    }

    const dayItems = timed.filter(i => (i.day || 0) === d.index)
      .sort((a, b) => toMin(a.start) - toMin(b.start));

    for (const { it, lane, lanes } of layout(dayItems)) {
      const s = toMin(it.start);
      const e = Math.max(toMin(it.end || it.start), s + MIN_SPAN);
      const c = catOf(it.cat);
      const w = 100 / lanes;
      col.append(h('button.tt-block', {
        style: {
          top: ((s - lo) / 60 * HOUR_PX) + 'px',
          height: ((e - s) / 60 * HOUR_PX - 3) + 'px',
          left: `calc(${lane * w}% + 2px)`,
          width: `calc(${w}% - 4px)`,
          background: c.color + '22',
          borderLeftColor: c.color,
        },
        onclick: () => openItemEditor(it),
      },
        h('span.tt-time', it.start + (it.end ? '–' + it.end : '')),
        h('span.tt-title', `${c.icon} ${it.title}`),
        it.placeName ? h('span.tt-place', it.placeName) : null,
      ));
    }
    cols.append(col);
  });

  root.append(h('div.tt-wrap',
    head,
    h('div.tt-body', gutter, cols),
  ));

  if (untimed.length) {
    const box = h('div.tt-untimed', h('div.section-title', '시간 미정'));
    for (const it of untimed) {
      const d = days[it.day || 0];
      box.append(h('button.pill', { onclick: () => openItemEditor(it) },
        h('span.muted.small', d ? d.label : ''), ' ', catOf(it.cat).icon + ' ' + it.title));
    }
    root.append(box);
  }
}

/**
 * 겹치는 일정을 나란히 놓기 위한 레인 배치.
 * 서로 겹치는 묶음(cluster) 안에서만 열을 나눠 폭을 줄인다.
 */
function layout(list) {
  const out = [];
  let cluster = [], clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const lanes = [];   // lanes[i] = 그 레인의 마지막 종료시각
    const placed = [];
    for (const it of cluster) {
      const s = toMin(it.start);
      const e = Math.max(toMin(it.end || it.start), s + MIN_SPAN);
      let lane = lanes.findIndex(end => end <= s);
      if (lane === -1) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
      placed.push({ it, lane });
    }
    for (const p of placed) out.push({ ...p, lanes: lanes.length });
    cluster = []; clusterEnd = -1;
  };

  for (const it of list) {
    const s = toMin(it.start);
    const e = Math.max(toMin(it.end || it.start), s + MIN_SPAN);
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}
