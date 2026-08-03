// 앱 셸 — 탭 전환, 여행 열기/만들기/공유, 설정, 동기화 표시
import { h, $, modal, toast, input, field, confirmDialog } from './ui.js';
import { store, listTrips, forgetTrip, lastTripCode, fmtDate, tripDays, mergeDoc } from './store.js';
import { remoteEnabled } from './supabase.js';
import { renderPlan } from './views/plan.js';
import { renderTimetable } from './views/timetable.js';
import { renderMap, detachMap } from './views/map.js';
import { renderBudget } from './views/budget.js';
import { renderChecklist } from './views/checklist.js';

const VIEWS = {
  plan: renderPlan,
  timetable: renderTimetable,
  map: renderMap,
  budget: renderBudget,
  checklist: renderChecklist,
};
let tab = 'plan';

// ── 렌더 ──────────────────────────────────────────────────
function render() {
  const meta = store.doc.meta;
  $('#tripTitle').textContent = meta.title || '여행';
  const days = tripDays(meta);
  $('#tripDates').textContent = meta.start
    ? `${fmtDate(meta.start)}${meta.end && meta.end !== meta.start ? ' – ' + fmtDate(meta.end) : ''} · ${days.length}일`
    : '날짜 미정';

  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));

  const root = $('#view');
  if (tab !== 'map') detachMap();
  root.innerHTML = '';
  root.className = 'view-' + tab;
  VIEWS[tab](root);
  renderSync();
}

function renderSync() {
  const dot = $('#syncDot');
  const map = {
    local: ['이 기기에만 저장됨 (Supabase 미설정)', '#6b737b'],
    idle: ['동기화됨', '#5ad1a5'],
    pushing: ['저장 중…', '#ffd75a'],
    pulling: ['불러오는 중…', '#ffd75a'],
    error: ['동기화 실패 — 로컬에는 저장됨', '#ff6b6b'],
  };
  const [title, color] = map[store.sync] || map.idle;
  dot.style.background = color;
  dot.title = title;
}

store.on('change', render);
store.on('sync', renderSync);

// ── 탭 ────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => {
  b.addEventListener('click', () => { tab = b.dataset.tab; render(); });
});

// ── 여행 목록 ─────────────────────────────────────────────
$('#btnTrips').addEventListener('click', openTripList);

function openTripList() {
  const list = listTrips();
  const body = h('div');

  body.append(h('div.list-actions',
    h('button.btn.primary', { onclick: () => { m.close(); openNewTrip(); } }, '+ 새 여행'),
    h('button.btn', { onclick: () => { m.close(); openJoin(); } }, '코드로 열기'),
  ));

  if (!list.length) {
    body.append(h('p.muted.small', '아직 만든 여행이 없습니다.'));
  } else {
    for (const t of list) {
      body.append(h('div.line-row', { onclick: async () => { m.close(); await openTrip(t.code); } },
        h('div.grow', h('strong', t.title || '이름 없는 여행'), h('div.muted.small', t.code)),
        t.code === store.code ? h('span.tag', '열림') : null,
        h('button.x', {
          onclick: async e => {
            e.stopPropagation();
            if (await confirmDialog('목록에서 제거', `"${t.title}"을(를) 이 기기 목록에서 지울까요?\n서버 데이터는 남아 있어 코드로 다시 열 수 있습니다.`, '제거')) {
              forgetTrip(t.code);
              m.close();
              openTripList();
            }
          },
        }, '✕')));
    }
  }

  const m = modal({ title: '내 여행', body, actions: [{ label: '닫기' }] });
}

function openNewTrip() {
  const fTitle = input({ placeholder: '예: 대만 타이베이 4박 5일' });
  const today = new Date().toISOString().slice(0, 10);
  const fStart = input({ type: 'date', value: today });
  const fEnd = input({ type: 'date', value: today });
  const fPeople = input({ type: 'number', min: '1', value: '1' });

  modal({
    title: '새 여행 만들기',
    body: h('div.form',
      field('여행 이름', fTitle),
      h('div.row2', field('시작일', fStart), field('종료일', fEnd)),
      field('인원', fPeople),
    ),
    actions: [
      { label: '취소' },
      {
        label: '만들기', primary: true,
        onClick: () => {
          const title = fTitle.value.trim();
          if (!title) { toast('여행 이름을 입력하세요'); return false; }
          if (fEnd.value < fStart.value) { toast('종료일이 시작일보다 빠릅니다'); return false; }
          (async () => {
            const code = await store.create(title);
            store.setMeta({ start: fStart.value, end: fEnd.value, people: Number(fPeople.value) || 1 });
            location.hash = '#trip=' + code;
            tab = 'plan';
            render();
            toast(remoteEnabled() ? `여행을 만들었습니다 (코드 ${code})` : '여행을 만들었습니다 (이 기기 전용)');
          })();
        },
      },
    ],
  });
  setTimeout(() => fTitle.focus(), 100);
}

function openJoin() {
  const f = input({ placeholder: 'ABCD-2345', autocapitalize: 'characters' });
  modal({
    title: '코드로 여행 열기',
    body: h('div.form',
      field('공유 코드', f, remoteEnabled() ? null : '⚠ Supabase 가 설정되지 않아 다른 기기의 여행은 못 불러옵니다.'),
    ),
    actions: [
      { label: '취소' },
      {
        label: '열기', primary: true,
        onClick: () => {
          const code = f.value.trim().toUpperCase();
          if (!code) return false;
          openTrip(code);
        },
      },
    ],
  });
  setTimeout(() => f.focus(), 100);
}

async function openTrip(code) {
  const res = await store.open(code);
  if (res && res.notFound) {
    toast(res.offline ? '연결 실패 — 저장된 사본이 없습니다' : '그 코드의 여행을 찾을 수 없습니다');
    return false;
  }
  location.hash = '#trip=' + code;
  tab = 'plan';
  render();
  return true;
}

// ── 공유 ──────────────────────────────────────────────────
$('#btnShare').addEventListener('click', () => {
  if (!store.code) { toast('먼저 여행을 만들어 주세요'); return; }
  const url = location.origin + location.pathname + '#trip=' + store.code;

  const body = h('div.form',
    h('div.code-box', store.code),
    h('p.muted.small', remoteEnabled()
      ? '이 링크나 코드를 받은 사람은 같은 여행을 함께 보고 편집할 수 있습니다.'
      : '⚠ Supabase 가 설정되지 않아 아직 이 기기 밖으로는 공유되지 않습니다. README 의 설정 절차를 마치면 활성화됩니다.'),
    h('div.list-actions',
      h('button.btn', { onclick: () => { navigator.clipboard.writeText(url).then(() => toast('링크를 복사했습니다')); } }, '링크 복사'),
      h('button.btn', { onclick: () => { navigator.clipboard.writeText(store.code).then(() => toast('코드를 복사했습니다')); } }, '코드 복사'),
      navigator.share ? h('button.btn.primary', {
        onclick: () => navigator.share({ title: store.doc.meta.title, url }).catch(() => { }),
      }, '공유하기') : null,
    ),
    h('hr'),
    h('div.list-actions',
      h('button.btn.small', { onclick: exportJson }, 'JSON 백업 내보내기'),
      h('button.btn.small', { onclick: importJson }, 'JSON 불러오기'),
    ),
  );
  modal({ title: '여행 공유', body, actions: [{ label: '닫기' }] });
});

function exportJson() {
  const blob = new Blob([JSON.stringify({ code: store.code, doc: store.doc }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${store.doc.meta.title || 'trip'}.json` });
  document.body.append(a); a.click(); a.remove();
}

function importJson() {
  const f = h('input', { type: 'file', accept: '.json,application/json' });
  f.addEventListener('change', async () => {
    const file = f.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = data.doc || data;
      if (!incoming || !incoming.meta) throw new Error('형식이 다릅니다');
      store.update(d => Object.assign(d, mergeDoc(d, incoming)));
      toast('불러왔습니다');
    } catch (e) { toast('불러오기 실패: ' + e.message); }
  });
  f.click();
}

// ── 설정 ──────────────────────────────────────────────────
$('#btnSettings').addEventListener('click', () => {
  const meta = store.doc.meta;
  const fTitle = input({ value: meta.title || '' });
  const fStart = input({ type: 'date', value: meta.start || '' });
  const fEnd = input({ type: 'date', value: meta.end || '' });
  const fPeople = input({ type: 'number', min: '1', value: meta.people || 1 });
  const fCurLabel = input({ value: meta.curLabel || '', placeholder: 'TWD' });
  const fCurRate = input({ type: 'number', step: '0.01', value: meta.curRate || '', placeholder: '44.5' });
  const fMemo = h('textarea.inp', { rows: 3, placeholder: '숙소 주소, 항공편, 비상 연락처 등' }, meta.memo || '');

  modal({
    title: '여행 설정',
    body: h('div.form',
      field('여행 이름', fTitle),
      h('div.row2', field('시작일', fStart), field('종료일', fEnd)),
      field('인원', fPeople, '예산 탭에서 1인당 금액을 계산할 때 씁니다'),
      h('div.row2',
        field('현지 통화', fCurLabel),
        field('환율 (1단위 = ?원)', fCurRate),
      ),
      field('메모', fMemo),
      h('hr'),
      h('div.list-actions',
        h('button.btn.danger.small', {
          onclick: async () => {
            if (await confirmDialog('여행 비우기', '이 여행의 일정·준비물·비용을 모두 지울까요? 되돌릴 수 없습니다.', '전부 지우기')) {
              store.update(d => { d.items = {}; d.checks = {}; d.costs = {}; });
              toast('비웠습니다');
            }
          },
        }, '이 여행 내용 전부 지우기'),
      ),
    ),
    actions: [
      { label: '취소' },
      {
        label: '저장', primary: true,
        onClick: () => {
          if (fStart.value && fEnd.value && fEnd.value < fStart.value) { toast('종료일이 시작일보다 빠릅니다'); return false; }
          store.setMeta({
            title: fTitle.value.trim() || '여행',
            start: fStart.value,
            end: fEnd.value,
            people: Math.max(1, Number(fPeople.value) || 1),
            curLabel: fCurLabel.value.trim().toUpperCase(),
            curRate: Number(fCurRate.value) || 0,
            memo: fMemo.value.trim(),
          });
          toast('저장했습니다');
        },
      },
    ],
  });
});

// ── 시작 ──────────────────────────────────────────────────
async function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const fromLink = hash.get('trip');
  const code = fromLink || lastTripCode();

  if (code) {
    const ok = await openTrip(code);
    if (ok) return;
  }
  render();
  if (!listTrips().length) openNewTrip();
  else openTripList();
}

window.addEventListener('hashchange', () => {
  const code = new URLSearchParams(location.hash.slice(1)).get('trip');
  if (code && code !== store.code) openTrip(code);
});
window.addEventListener('pagehide', () => store.flush());

boot();

// ── 서비스 워커 (PWA) ─────────────────────────────────────
// 새 배포는 sw.js 의 VERSION 한 줄만 올리면 전 기기가 자동 새로고침된다.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  }).catch(() => { });
}
