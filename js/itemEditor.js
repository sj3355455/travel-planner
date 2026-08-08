// 일정 항목 추가/편집 시트 — 일정 탭·지도 탭·검색 양쪽에서 쓴다.
//
// 추가할 때는 한 화면에 하나씩만 물어본다: 분류 → 장소 → 시간.
// 일차는 열려 있던 화면에서 가져오고, 이름은 고른 장소 이름을 쓴다.
// 금액·메모처럼 나중에 채워도 되는 것들은 마지막 단계의 '자세히 입력'으로 미룬다.
// 편집할 때는 처음부터 전체 폼을 보여준다.
import { h, modal, input, select, field, toast, confirmDialog } from './ui.js';
import { store, CATEGORIES, tripDays } from './store.js';
import { searchPlace, debounce } from './geo.js';

const STEPS = ['분류', '장소', '시간'];

export function openItemEditor(existing, defaults = {}) {
  const isNew = !existing;
  const rec = { cat: 'sight', cur: 'krw', ...defaults, ...(existing || {}) };
  const days = tripDays(store.doc.meta);
  const meta = store.doc.meta;

  let detailed = !isNew;   // 추가는 단계별로, 편집은 전체 폼
  let step = 0;            // 0 분류 · 1 장소 · 2 시간

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

  // ── 분류 고르기 ──────────────────────────────────────────
  let cat = rec.cat;
  const catRow = h('div.cat-pick');
  const renderCat = () => {
    catRow.innerHTML = '';
    for (const c of CATEGORIES) {
      const on = c.id === cat;
      catRow.append(h('button', {
        class: 'cat-btn' + (on ? ' on' : ''),
        style: on ? { borderColor: c.color, background: c.color + '1f', color: c.color } : {},
        onclick: () => {
          cat = c.id;
          renderCat();
          // 마법사에서는 고르는 즉시 다음 단계로 — 한 번 탭으로 끝난다
          if (!detailed) go(1);
        },
      }, h('span.ic', c.icon), h('span', c.label)));
    }
  };
  renderCat();

  // ── 장소 검색 ────────────────────────────────────────────
  const fPlace = input({ placeholder: '장소명을 검색하세요', value: place.name });
  const results = h('div.geo-results');
  const placeInfo = h('div.geo-picked');

  // 검색해서 고른 위치가 맞는지 눈으로 확인하는 작은 지도
  const mapBox = h('div.mini-map');
  const mapHint = h('p.muted.small.mini-map-hint', '검색 결과를 고르면 여기 지도에 위치가 표시됩니다.');
  let mini = null, miniPin = null;

  const syncMap = () => {
    const has = place.lat != null && window.L;
    mapBox.hidden = !has;
    mapHint.hidden = has;
    if (!has) return;
    const at = [place.lat, place.lng];
    if (!mini) {
      mini = L.map(mapBox, {
        zoomControl: false,
        scrollWheelZoom: false,   // 모달 안에서 휠로 확대되면 스크롤이 갇힌다
      }).setView(at, 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(mini);
      miniPin = L.marker(at).addTo(mini);
    } else {
      mini.setView(at, 16);
      miniPin.setLatLng(at);
    }
    // 모달 안에서는 컨테이너 크기가 한 박자 늦게 잡힌다
    setTimeout(() => mini && mini.invalidateSize(), 60);
  };

  const renderPicked = () => {
    placeInfo.innerHTML = '';
    if (place.lat != null) {
      placeInfo.append(
        h('span.pin-ok', '📍 좌표 저장됨'),
        h('span.muted.small', place.addr ? place.addr.slice(0, 60) : `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`),
        h('button.linkbtn', {
          onclick: () => { place = { name: fPlace.value, lat: null, lng: null, addr: '' }; renderPicked(); syncMap(); },
        }, '좌표 지우기'),
      );
    } else {
      placeInfo.append(h('span.muted.small', '좌표 없이 이름만 저장해도 됩니다. 좌표가 있어야 지도에 표시돼요.'));
    }
  };
  renderPicked();
  syncMap();

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
            syncMap();
          },
        }, h('strong', r.name), h('span.muted.small', r.addr)));
      }
    } catch {
      results.innerHTML = '';
      results.append(h('div.muted.small', '검색 실패 — 네트워크를 확인하세요'));
    }
  });

  fPlace.addEventListener('input', () => { place.name = fPlace.value; runSearch(fPlace.value); });

  // ── 화면 그리기 ──────────────────────────────────────────
  const body = h('div.form');
  let m;   // modal 핸들 (아래에서 채워진다)

  /** 지금 몇 번째인지 알려주는 머리말 */
  const stepHead = () => h('div.wiz-head',
    h('div.wiz-steps', ...STEPS.map((label, i) =>
      h('span', { class: 'wiz-step' + (i === step ? ' on' : i < step ? ' done' : '') }, label))),
  );

  /** 이 일정이 어느 날에 들어가는지 */
  const dayHint = () => {
    const d = days[Number(fDay.value)];
    if (!d) return h('p.muted.small.wiz-sub', '여행 날짜를 정하면 일차가 붙습니다. 지금은 1일차로 저장돼요.');
    return h('p.muted.small.wiz-sub', `${d.label} · ${d.sub}에 추가됩니다`);
  };

  const go = n => { step = n; renderBody(); };

  const renderBody = () => {
    body.innerHTML = '';
    // 분류만 나오는 화면에서는 버튼을 크게
    catRow.className = 'cat-pick' + (detailed ? '' : ' big');

    if (detailed) {
      body.append(
        field('일정 이름', fTitle),
        field('분류', catRow),
        field('일차', fDay),
        h('div.row2', field('시작', fStart), field('종료', fEnd)),
        h('label.field', h('span.field-label', '장소'), fPlace),
        results, placeInfo, mapHint, mapBox,
        h('div.row2',
          field('예상 금액', fCost),
          field('통화', fCur, meta.curLabel ? null : '설정에서 현지 통화를 넣으면 환산됩니다'),
        ),
        field('실제 지출', fSpent, '여행 중에 실제로 쓴 금액. 예산 탭에서 예상과 비교됩니다'),
        field('메모', fMemo),
      );
      m && m.setActions(detailedActions());
      syncMap();
      return;
    }

    if (step === 0) {
      body.append(
        stepHead(),
        h('div.wiz-title', '무슨 일정인가요?'),
        dayHint(),
        catRow,
      );
    } else if (step === 1) {
      body.append(
        stepHead(),
        h('div.wiz-title', '어디인가요?'),
        h('p.muted.small.wiz-sub', '검색 결과를 골라 지도에서 위치를 확인하세요'),
        fPlace, results, placeInfo,
        mapHint, mapBox,
      );
      setTimeout(() => fPlace.focus(), 80);
      syncMap();
    } else {
      body.append(
        stepHead(),
        h('div.wiz-title', '몇 시인가요?'),
        h('p.muted.small.wiz-sub', '비워두면 "시간 미정"으로 저장됩니다'),
        fStart,
        h('button.linkbtn.wiz-more', {
          onclick: () => { detailed = true; renderBody(); },
        }, '＋ 이름·금액·메모까지 자세히 입력'),
      );
    }
    m && m.setActions(stepActions());
    body.scrollTop = 0;
  };

  // ── 버튼 ─────────────────────────────────────────────────
  const stepActions = () => {
    if (step === 0) return [{ label: '취소' }];
    const back = { label: '뒤로', onClick: () => { go(step - 1); return false; } };
    if (step === 1) {
      return [back, {
        label: '다음', primary: true,
        onClick: () => {
          if (!place.name.trim() && !fTitle.value.trim()) { toast('장소를 입력하세요'); return false; }
          go(2);
          return false;
        },
      }];
    }
    return [back, { label: '저장', primary: true, onClick: save }];
  };

  const detailedActions = () => {
    const list = [];
    if (!isNew) {
      list.push({
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
      list.push({
        label: '복제',
        onClick: () => {
          if (!validate()) return false;
          const copy = collect();
          store.put('items', { ...copy, title: copy.title + ' (복사)' });
          toast('복제했습니다');
        },
      });
    }
    list.push({ label: '취소' });
    list.push({ label: '저장', primary: true, onClick: save });
    return list;
  };

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

  function save() {
    if (!validate()) return false;
    store.put('items', { id: rec.id, ...collect() });
    toast(isNew ? '일정을 추가했습니다' : '저장했습니다');
  }

  m = modal({
    title: isNew ? '일정 추가' : '일정 편집',
    body,
    onClose: () => { if (mini) { mini.remove(); mini = null; } },
  });
  renderBody();
  if (detailed) setTimeout(() => fTitle.focus(), 100);
}
