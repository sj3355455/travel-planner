// 일정 항목 추가/편집 시트 — 일정 탭·지도 탭·검색 양쪽에서 쓴다.
//
// 추가할 때는 분류·장소·시간 세 가지만 고르면 된다. 일차는 열려 있던 화면에서 가져오고,
// 이름은 고른 장소 이름을 쓴다. 금액·메모처럼 나중에 채워도 되는 것들은 '자세히 입력'으로 미룬다.
// 편집할 때는 처음부터 전체 폼을 보여준다.
import { h, modal, input, select, field, toast, confirmDialog } from './ui.js';
import { store, CATEGORIES, tripDays } from './store.js';
import { searchPlace, debounce } from './geo.js';

export function openItemEditor(existing, defaults = {}) {
  const isNew = !existing;
  const rec = { cat: 'sight', cur: 'krw', ...defaults, ...(existing || {}) };
  const days = tripDays(store.doc.meta);
  const meta = store.doc.meta;

  let detailed = !isNew;   // 추가는 간단 폼으로 시작, 편집은 전체 폼

  // 선택된 좌표를 담아두는 곳 (검색 결과를 고르면 채워진다)
  let place = { name: rec.placeName || '', lat: rec.lat ?? null, lng: rec.lng ?? null, addr: rec.addr || '' };

  const fTitle = input({ value: rec.title || '', placeholder: '비워두면 장소 이름으로 저장' });
  const fDay = select(days.map(d => ({ value: String(d.index), label: `${d.label} · ${d.sub}` })), String(rec.day ?? 0));
  const fStart = input({ type: 'time', value: rec.start || '' });
  const fEnd = input({ type: 'time', value: rec.end || '' });
  const fCost = input({ type: 'number', inputmode: 'decimal', min: '0', value: rec.cost ?? '', placeholder: '0' });
  const fSpent = input({ type: 'number', inputmode: 'decimal', min: '0', value: rec.spent ?? '', placeholder: '아직 안 씀' });
  const fCur = select(
    [{ value: 'krw', label: '원' }, ...(meta.curLabel ? [{ value: 'loc', label: meta.curLabel }] : [])],
    rec.cur || 'krw',
  );
  const fMemo = h('textarea.inp', { rows: 2, placeholder: '메모 (예약번호, 준비물 등)' }, rec.memo || '');

  // ── 분류 — 한 번 탭해서 고르는 버튼 묶음 ─────────────────
  let cat = rec.cat;
  const catRow = h('div.cat-pick');
  const renderCat = () => {
    catRow.innerHTML = '';
    for (const c of CATEGORIES) {
      const on = c.id === cat;
      catRow.append(h('button', {
        class: 'cat-btn' + (on ? ' on' : ''),
        style: on ? { borderColor: c.color, background: c.color + '1f', color: c.color } : {},
        onclick: () => { cat = c.id; renderCat(); },
      }, h('span.ic', c.icon), h('span', c.label)));
    }
  };
  renderCat();

  // ── 장소 검색 ────────────────────────────────────────────
  const fPlace = input({ value: place.name, placeholder: '장소명 검색 (예: 九份老街)' });
  const results = h('div.geo-results');
  const placeInfo = h('div.geo-picked');
  const placeBox = h('div', fPlace, results, placeInfo);

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

  // ── 폼 본문 — 간단/자세히 두 모양 ────────────────────────
  const body = h('div.form');

  /** 간단 폼에서 이 일정이 어느 날에 들어가는지 알려준다 */
  const dayHint = () => {
    const d = days[Number(fDay.value)];
    if (!d) return h('p.muted.small', '여행 날짜를 정하면 일차가 붙습니다. 지금은 1일차로 저장돼요.');
    return h('p.muted.small', `${d.label} · ${d.sub}에 추가됩니다`);
  };

  const renderBody = () => {
    body.innerHTML = '';
    if (!detailed) {
      body.append(
        dayHint(),
        field('분류', catRow),
        field('장소', placeBox),
        field('시간', fStart, '종료 시각·금액·메모는 저장한 뒤 카드를 눌러 채우면 됩니다'),
        h('button.linkbtn', { onclick: () => { detailed = true; renderBody(); } }, '＋ 이름·금액·메모까지 자세히 입력'),
      );
    } else {
      body.append(
        field('일정 이름', fTitle),
        field('분류', catRow),
        field('일차', fDay),
        h('div.row2', field('시작', fStart), field('종료', fEnd)),
        field('장소', placeBox),
        h('div.row2',
          field('예상 금액', fCost),
          field('통화', fCur, meta.curLabel ? null : '설정에서 현지 통화를 넣으면 환산됩니다'),
        ),
        field('실제 지출', fSpent, '여행 중에 실제로 쓴 금액. 예산 탭에서 예상과 비교됩니다'),
        field('메모', fMemo),
      );
    }
  };
  renderBody();

  /** 폼에서 현재 값을 읽어 저장용 레코드로 만든다 */
  const collect = () => ({
    day: Number(fDay.value) || 0,
    start: fStart.value,
    end: fEnd.value,
    title: fTitle.value.trim() || place.name.trim(),
    cat,
    placeName: place.name.trim(),
    addr: place.addr || '',
    lat: place.lat, lng: place.lng,
    cost: fCost.value === '' ? 0 : Number(fCost.value),
    spent: fSpent.value === '' ? null : Number(fSpent.value),
    cur: fCur.value,
    memo: fMemo.value.trim(),
  });

  const validate = () => {
    if (!collect().title) { toast(detailed ? '일정 이름이나 장소를 입력하세요' : '장소를 입력하세요'); return false; }
    if (fStart.value && fEnd.value && fEnd.value < fStart.value) { toast('종료 시각이 시작보다 빠릅니다'); return false; }
    return true;
  };

  const actions = [];

  if (!isNew) {
    actions.push({
      label: '삭제', danger: true,
      onClick: () => {
        setTimeout(async () => {
          if (await confirmDialog('일정 삭제', `"${rec.title || '이름 없는 일정'}"을(를) 삭제할까요?`)) {
            const undo = store.del('items', rec.id);
            toast('삭제했습니다', { label: '실행취소', onClick: undo });
          }
        }, 200);
      },
    });
    actions.push({
      label: '복제',
      onClick: () => {
        if (!validate()) return false;
        const copy = collect();
        store.put('items', { ...copy, title: copy.title + ' (복사)' });
        toast('복제했습니다');
      },
    });
  }

  actions.push({ label: '취소' });
  actions.push({
    label: '저장', primary: true,
    onClick: () => {
      if (!validate()) return false;
      store.put('items', { id: rec.id, ...collect() });
      toast(isNew ? '일정을 추가했습니다' : '저장했습니다');
    },
  });

  modal({ title: isNew ? '일정 추가' : '일정 편집', body, actions });
  setTimeout(() => (isNew ? fPlace : fTitle).focus(), 100);
}
