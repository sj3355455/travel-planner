// 일정 탭 — 일차별 카드 목록
import { h, toast, promptDialog } from '../ui.js';
import {
  store, tripDays, catOf, toKRW, spentKRW, hasSpent, won, dayColor,
  toMin, fmtDur, dayNoteId,
} from '../store.js';
import { openItemEditor } from '../itemEditor.js';
import { mapLinks } from '../geo.js';

let selectedDay = 0;

/** 일정 사이 여유가 이보다 짧으면 빨갛게 — 이동/대기 시간이 빠듯하다는 신호 */
const TIGHT_MIN = 20;

export function renderPlan(root) {
  const meta = store.doc.meta;
  const days = tripDays(meta);
  if (selectedDay >= days.length) selectedDay = 0;

  const items = store.all('items');
  root.append(dayStrip(days, items));

  if (!days.length) {
    root.append(empty('여행 날짜를 먼저 정해주세요', '오른쪽 위 ⚙ 설정에서 시작일과 종료일을 입력하면 일차가 생깁니다.'));
    root.append(orphanSection(items, days));
    return;
  }

  const day = days[selectedDay];
  const list = items.filter(i => (i.day || 0) === selectedDay).sort(sortByTime);
  const dayTotal = list.reduce((s, i) => s + toKRW(i, meta), 0);
  const daySpent = list.reduce((s, i) => s + spentKRW(i, meta), 0);

  root.append(h('div.day-head',
    h('div', h('strong', day.label), h('span.muted', ' · ' + day.sub)),
    h('div.day-total',
      dayTotal ? h('span.money', won(dayTotal)) : null,
      daySpent ? h('span.muted.small', ` · 실제 ${won(daySpent)}`) : null,
    ),
  ));

  root.append(dayNote(selectedDay));

  if (!list.length) {
    root.append(empty('아직 일정이 없습니다', '아래 + 버튼으로 첫 일정을 추가해 보세요.'));
  } else {
    const wrap = h('div.cards');
    list.forEach((it, idx) => {
      // 앞 일정이 끝난 뒤 이 일정이 시작할 때까지의 여유를 사이에 끼워 넣는다
      const prev = list[idx - 1];
      const gapEl = prev ? gapBetween(prev, it) : null;
      if (gapEl) wrap.append(gapEl);
      wrap.append(itemCard(it, idx, meta));
    });
    root.append(wrap);
  }

  root.append(orphanSection(items, days));
  root.append(h('button.fab', { onclick: () => openItemEditor(null, { day: selectedDay }) }, '+'));
}

/**
 * 여행 기간을 줄이면 마지막 일차보다 뒤에 있던 일정이 어느 화면에도 안 나온다.
 * (예산에는 계속 잡히는데 열어볼 방법이 없어 유령 일정이 된다.)
 * 그런 일정을 모아 보여주고 마지막 날로 옮길 수 있게 한다.
 */
function orphanSection(items, days) {
  const orphans = items.filter(i => (i.day || 0) >= days.length);
  if (!orphans.length) return null;

  const lastDay = days.length - 1;
  return h('div.section.orphan',
    h('div.section-title',
      h('span', `⚠️ 여행 기간 밖 일정 ${orphans.length}개`),
      // 날짜가 아예 없으면(일차 0개) 옮길 곳이 없다
      days.length ? h('button.linkbtn', {
        onclick: () => {
          store.update(d => {
            for (const o of orphans) d.items[o.id] = { ...d.items[o.id], day: lastDay, mt: Date.now() };
          });
          toast(`${orphans.length}개를 마지막 날로 옮겼습니다`);
        },
      }, `마지막 날(${days[lastDay].label})로 옮기기`) : null,
    ),
    h('p.muted.small', '여행 날짜를 줄이면서 범위를 벗어난 일정입니다. 비용에는 계속 포함됩니다.'),
    ...orphans.map(o => h('div.line-row', { onclick: () => openItemEditor(o) },
      h('span.cat-dot', { style: { background: catOf(o.cat).color + '26', color: catOf(o.cat).color } }, catOf(o.cat).icon),
      h('div.grow', h('div', o.title), h('div.muted.small', `${(o.day || 0) + 1}일차로 지정됨`)),
    )),
  );
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

/** 일차 메모 — 숙소 주소나 그날 주의사항처럼 특정 일정에 안 붙는 내용 */
function dayNote(day) {
  const id = dayNoteId(day);
  const note = (store.doc.notes || {})[id];
  const text = note && !note.del ? note.text : '';

  const edit = async () => {
    const v = await promptDialog({
      title: `${day + 1}일차 메모`,
      label: '메모',
      value: text,
      multiline: true,
      placeholder: '숙소 주소, 그날 챙길 것, 주의사항 등',
      allowEmpty: true,
    });
    if (v === null) return;
    if (!v) { store.del('notes', id); toast('메모를 지웠습니다'); }
    else { store.put('notes', { id, day, text: v }); toast('메모를 저장했습니다'); }
  };

  if (!text) return h('button.linkbtn', { onclick: edit, style: { marginBottom: '10px' } }, '＋ 이 날 메모 추가');
  return h('div.day-note', { onclick: edit }, h('span', '📝'), h('div.txt', text));
}

/** 두 일정 사이의 빈 시간 표시. 시간 정보가 부족하면 아무것도 안 그린다. */
function gapBetween(prev, next) {
  const prevEnd = toMin(prev.end || prev.start);
  const nextStart = toMin(next.start);
  if (prevEnd == null || nextStart == null) return null;
  const gap = nextStart - prevEnd;
  if (gap <= 0 || gap > 8 * 60) return null;   // 겹치거나 너무 벌어지면 의미 없음
  return h('div', { class: 'gap' + (gap < TIGHT_MIN ? ' tight' : '') },
    h('span', `여유 ${fmtDur(gap)}${gap < TIGHT_MIN ? ' — 빠듯함' : ''}`));
}

function itemCard(it, idx, meta) {
  const c = catOf(it.cat);
  const cost = toKRW(it, meta);
  const spent = spentKRW(it, meta);
  const time = it.start ? (it.end ? `${it.start}–${it.end}` : it.start) : '시간 미정';

  // 소요 시간
  const s = toMin(it.start), e = toMin(it.end);
  const dur = s != null && e != null && e > s ? fmtDur(e - s) : null;

  const links = (it.lat != null)
    ? h('div.card-links', ...mapLinks({ name: it.placeName, lat: it.lat, lng: it.lng }).map(l =>
      h('a.linkbtn', { href: l.url, target: '_blank', rel: 'noopener', onclick: e2 => e2.stopPropagation() }, l.label)))
    : null;

  // 예상 대비 실제
  let spentEl = null;
  if (hasSpent(it)) {
    const diff = spent - cost;
    spentEl = h('span', {
      class: 'card-spent ' + (cost && diff > 0 ? 'over' : cost && diff < 0 ? 'under' : 'muted'),
    }, `실제 ${won(spent)}`);
  }

  return h('div.card', { onclick: () => openItemEditor(it) },
    h('div.card-time',
      h('span.no', String(idx + 1)),
      h('span.t', time),
      dur ? h('span.dur', dur) : null,
    ),
    h('div.card-main',
      h('div.card-title', h('span.cat-dot', { style: { background: c.color + '26', color: c.color } }, c.icon), h('strong', it.title)),
      it.placeName ? h('div.muted.small', (it.lat != null ? '📍 ' : '') + it.placeName) : null,
      it.memo ? h('div.card-memo', it.memo) : null,
      links,
    ),
    h('div.card-right',
      cost ? h('span.card-cost.money', won(cost)) : null,
      spentEl,
    ),
  );
}

function empty(title, sub) {
  return h('div.empty', h('strong', title), h('p.muted', sub));
}
