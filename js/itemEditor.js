// 일정 항목 추가/편집 시트 — 일정 탭·지도 탭 양쪽에서 쓴다.
import { h, modal, input, select, field, toast, confirmDialog } from './ui.js';
import { store, CATEGORIES, tripDays } from './store.js';
import { searchPlace, debounce } from './geo.js';

export function openItemEditor(existing, defaults = {}) {
  const isNew = !existing;
  const rec = { cat: 'sight', cur: 'krw', ...defaults, ...(existing || {}) };
  const days = tripDays(store.doc.meta);
  const meta = store.doc.meta;

  // 선택된 좌표를 담아두는 곳 (검색 결과를 고르면 채워진다)
  let place = { name: rec.placeName || '', lat: rec.lat ?? null, lng: rec.lng ?? null, addr: rec.addr || '' };

  const fTitle = input({ value: rec.title || '', placeholder: '예: 지우펀 야시장' });
  const fDay = select(days.map(d => ({ value: String(d.index), label: `${d.label} · ${d.sub}` })), String(rec.day ?? 0));
  const fStart = input({ type: 'time', value: rec.start || '' });
  const fEnd = input({ type: 'time', value: rec.end || '' });
  const fCat = select(CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` })), rec.cat);
  const fCost = input({ type: 'number', inputmode: 'decimal', min: '0', value: rec.cost ?? '', placeholder: '0' });
  const fCur = select(
    [{ value: 'krw', label: '원' }, ...(meta.curLabel ? [{ value: 'loc', label: meta.curLabel }] : [])],
    rec.cur || 'krw',
  );
  const fMemo = h('textarea.inp', { rows: 2, placeholder: '메모 (예약번호, 준비물 등)' }, rec.memo || '');

  // ── 장소 검색 ────────────────────────────────────────────
  const fPlace = input({ value: place.name, placeholder: '장소명 검색 (예: 九份老街)' });
  const results = h('div.geo-results');
  const placeInfo = h('div.geo-picked');

  const renderPicked = () => {
    placeInfo.innerHTML = '';
    if (place.lat != null) {
      placeInfo.append(
        h('span.pin-ok', '📍 좌표 저장됨'),
        h('span.muted.small', place.addr ? place.addr.slice(0, 60) : `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`),
        h('button.linkbtn', { onclick: () => { place = { name: fPlace.value, lat: null, lng: null, addr: '' }; renderPicked(); } }, '좌표 지우기'),
      );
    } else {
      placeInfo.append(h('span.muted.small', '좌표 없이 이름만 저장해도 됩니다. 좌표가 있어야 지도에 표시돼요.'));
    }
  };
  renderPicked();

  const runSearch = debounce(async q => {
    if (!q.trim()) { results.innerHTML = ''; return; }
    results.innerHTML = '';
    results.append(h('div.muted.small', '검색 중…'));
    try {
      const rows = await searchPlace(q);
      results.innerHTML = '';
      if (!rows.length) { results.append(h('div.muted.small', '결과 없음')); return; }
      for (const r of rows) {
        results.append(h('button.geo-row', {
          onclick: () => {
            place = { name: r.name, lat: r.lat, lng: r.lng, addr: r.addr };
            fPlace.value = r.name;
            if (!fTitle.value) fTitle.value = r.name;
            results.innerHTML = '';
            renderPicked();
          },
        }, h('strong', r.name), h('span.muted.small', r.addr)));
      }
    } catch {
      results.innerHTML = '';
      results.append(h('div.muted.small', '검색 실패 — 네트워크를 확인하세요'));
    }
  });

  fPlace.addEventListener('input', () => { place.name = fPlace.value; runSearch(fPlace.value); });

  const body = h('div.form',
    field('일정 이름', fTitle),
    h('div.row2', field('일차', fDay), field('분류', fCat)),
    h('div.row2', field('시작', fStart), field('종료', fEnd)),
    field('장소', h('div', fPlace, results, placeInfo), null),
    h('div.row2',
      field('예상 금액', fCost),
      field('통화', fCur, meta.curLabel ? null : '설정에서 현지 통화를 넣으면 환산됩니다'),
    ),
    field('메모', fMemo),
  );

  const actions = [];
  if (!isNew) {
    actions.push({
      label: '삭제', danger: true,
      onClick: () => {
        // 모달을 먼저 닫고 확인 창을 띄운다
        setTimeout(async () => {
          if (await confirmDialog('일정 삭제', `"${rec.title || '이름 없는 일정'}"을(를) 삭제할까요?`)) {
            store.del('items', rec.id);
            toast('삭제했습니다');
          }
        }, 200);
      },
    });
  }
  actions.push({ label: '취소' });
  actions.push({
    label: '저장', primary: true,
    onClick: () => {
      const title = fTitle.value.trim() || place.name.trim();
      if (!title) { toast('일정 이름을 입력하세요'); return false; }
      if (fStart.value && fEnd.value && fEnd.value < fStart.value) { toast('종료 시각이 시작보다 빠릅니다'); return false; }
      store.put('items', {
        id: rec.id,
        day: Number(fDay.value),
        start: fStart.value,
        end: fEnd.value,
        title,
        cat: fCat.value,
        placeName: place.name.trim(),
        addr: place.addr || '',
        lat: place.lat, lng: place.lng,
        cost: fCost.value === '' ? 0 : Number(fCost.value),
        cur: fCur.value,
        memo: fMemo.value.trim(),
      });
      toast(isNew ? '일정을 추가했습니다' : '저장했습니다');
    },
  });

  modal({ title: isNew ? '일정 추가' : '일정 편집', body, actions });
  setTimeout(() => fTitle.focus(), 100);
}
