// 앱 셸 — 탭 전환, 여행 열기/만들기/공유, 설정, 동기화 표시
import { h, $, modal, toast, input, field, confirmDialog } from './ui.js';
import { store, listTrips, forgetTrip, lastTripCode, fmtDate, tripDays, mergeDoc, catOf } from './store.js';
import { remoteEnabled } from './supabase.js';
import { tripToMarkdown } from './exportMd.js';
import { openItemEditor } from './itemEditor.js';
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
    local: ['이 기기에만 저장됨 (Supabase 미설정)', '#98a2b0'],
    idle: ['동기화됨', '#12a37a'],
    pushing: ['저장 중…', '#e0a800'],
    pulling: ['불러오는 중…', '#e0a800'],
    error: ['동기화 실패 — 로컬에는 저장됨', '#dc2f38'],
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

// ── 테마 (라이트 기본 / 다크 토글) ────────────────────────
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('tp.theme', t); } catch { }
  $('#btnTheme').textContent = t === 'dark' ? '☀️' : '🌙';
  // 모바일 주소창 색까지 맞춰준다
  const meta = $('#metaTheme');
  if (meta) meta.content = t === 'dark' ? '#0e1114' : '#ffffff';
}
$('#btnTheme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
applyTheme(document.documentElement.dataset.theme || 'light');

// ── 앱 설치 (PWA) ─────────────────────────────────────────
// 크롬/엣지 계열은 beforeinstallprompt 를 잡아 우리 버튼으로 설치를 띄운다.
// iOS 사파리는 그 이벤트가 없어서 "공유 → 홈 화면에 추가" 안내만 보여준다.
let installPrompt = null;

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;

const ua = navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isFirefox = () => /Firefox/i.test(ua);

function updateInstallBtn() {
  // 이미 설치해서 앱으로 실행 중이면 버튼을 숨긴다
  $('#btnInstall').hidden = isStandalone() || !(installPrompt || isIOS() || isFirefox());
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();          // 브라우저 기본 배너 대신 우리 버튼을 쓴다
  installPrompt = e;
  updateInstallBtn();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  updateInstallBtn();
  toast('앱으로 설치했습니다 🎉');
});

$('#btnInstall').addEventListener('click', async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    updateInstallBtn();
    if (outcome !== 'accepted') toast('설치를 취소했습니다');
    return;
  }
  showInstallHelp();
});

/** 프로그램적으로 설치를 띄울 수 없는 브라우저용 수동 안내 */
function showInstallHelp() {
  const steps = isIOS()
    ? ['사파리 아래쪽 <b>공유 버튼</b>(↑ 네모)을 누릅니다.',
       '메뉴를 내려서 <b>“홈 화면에 추가”</b>를 누릅니다.',
       '오른쪽 위 <b>“추가”</b>를 누르면 끝입니다.']
    : isFirefox()
      ? ['주소창 오른쪽 <b>⋮ 메뉴</b>를 엽니다.',
         '<b>“설치”</b> 또는 <b>“홈 화면에 추가”</b>를 누릅니다.']
      : ['주소창 오른쪽의 <b>설치 아이콘</b>(⊕ 또는 모니터 모양)을 누릅니다.',
         '없다면 <b>⋮ 메뉴 → 앱 → 이 사이트 설치</b>를 누릅니다.'];

  modal({
    title: '앱으로 설치하기',
    body: h('div.form',
      h('p.muted.small', '설치하면 주소창 없이 앱처럼 실행되고, 홈 화면·시작 메뉴에서 바로 열 수 있습니다. 오프라인에서도 열립니다.'),
      h('ol.help-steps', ...steps.map(s => h('li', { html: s }))),
      isIOS() ? h('p.muted.small', '※ iOS 는 <b>사파리</b>에서만 설치할 수 있습니다. 크롬으로 보고 있다면 사파리로 이 주소를 열어주세요.') : null,
    ),
    actions: [{ label: '닫기', primary: true }],
  });
}

// ── 전역 검색 ─────────────────────────────────────────────
$('#btnSearch').addEventListener('click', openSearch);

function openSearch() {
  const days = tripDays(store.doc.meta);
  const q = input({ placeholder: '일정 · 장소 · 메모 · 준비물 · 비용 검색' });
  const results = h('div');

  const run = () => {
    const kw = q.value.trim().toLowerCase();
    results.innerHTML = '';
    if (!kw) { results.append(h('p.muted.small', '검색어를 입력하세요.')); return; }

    const hits = [];
    const match = (...fields) => fields.some(f => String(f || '').toLowerCase().includes(kw));

    for (const it of store.all('items')) {
      if (match(it.title, it.placeName, it.memo)) {
        const d = days[it.day || 0];
        hits.push({
          kind: '일정', icon: catOf(it.cat).icon, title: it.title,
          sub: [d ? d.label : '', it.start, it.placeName].filter(Boolean).join(' · '),
          go: () => openItemEditor(it),
        });
      }
    }
    for (const c of store.all('checks')) {
      if (match(c.text, c.group)) {
        hits.push({
          kind: '준비물', icon: c.done ? '✅' : '⬜', title: c.text, sub: c.group || '',
          go: () => { tab = 'checklist'; render(); },
        });
      }
    }
    for (const c of store.all('costs')) {
      if (match(c.label)) {
        hits.push({
          kind: '비용', icon: catOf(c.cat).icon, title: c.label, sub: '일정 밖 비용',
          go: () => { tab = 'budget'; render(); },
        });
      }
    }
    for (const n of store.all('notes')) {
      if (match(n.text)) {
        const d = days[n.day || 0];
        hits.push({
          kind: '메모', icon: '📝', title: n.text.slice(0, 40), sub: d ? d.label : '',
          go: () => { tab = 'plan'; render(); },
        });
      }
    }

    if (!hits.length) { results.append(h('p.muted.small', `"${q.value.trim()}" 검색 결과가 없습니다.`)); return; }
    results.append(h('p.muted.small', `${hits.length}건`));
    for (const hit of hits.slice(0, 40)) {
      results.append(h('button.search-hit', {
        onclick: () => { m.close(); setTimeout(hit.go, 150); },
      },
        h('span', hit.icon),
        h('div.grow', h('div', hit.title), hit.sub ? h('div.muted.small', hit.sub) : null),
        h('span.kind', hit.kind),
      ));
    }
  };

  q.addEventListener('input', run);
  run();

  const m = modal({
    title: '검색',
    body: h('div.form', q, results),
    actions: [{ label: '닫기' }],
  });
  setTimeout(() => q.focus(), 100);
}

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
    h('div.section-title', 'Obsidian 노트로 내보내기'),
    h('div.list-actions',
      h('button.btn.small', { onclick: copyMarkdown }, '📋 마크다운 복사'),
      h('button.btn.small', { onclick: downloadMarkdown }, '⬇ .md 파일'),
    ),
    h('hr'),
    h('div.section-title', '백업'),
    h('div.list-actions',
      h('button.btn.small', { onclick: exportJson }, 'JSON 내보내기'),
      h('button.btn.small', { onclick: importJson }, 'JSON 불러오기'),
    ),
  );
  modal({ title: '여행 공유', body, actions: [{ label: '닫기' }] });
});

/** Vault 에 그대로 붙여넣을 수 있는 마크다운 */
function copyMarkdown() {
  navigator.clipboard.writeText(tripToMarkdown())
    .then(() => toast('마크다운을 복사했습니다 — Obsidian 에 붙여넣으세요'))
    .catch(() => toast('복사 실패'));
}

function downloadMarkdown() {
  const name = (store.doc.meta.title || 'trip').replace(/[\\/:*?"<>|]/g, '');
  saveFile(tripToMarkdown(), `${name}.md`, 'text/markdown');
  toast('.md 파일을 저장했습니다');
}

function saveFile(text, filename, type) {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const name = (store.doc.meta.title || 'trip').replace(/[\\/:*?"<>|]/g, '');
  saveFile(JSON.stringify({ code: store.code, doc: store.doc }, null, 2), `${name}.json`, 'application/json');
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
              store.update(d => { d.items = {}; d.checks = {}; d.costs = {}; d.notes = {}; });
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
  updateInstallBtn();

  const hash = new URLSearchParams(location.hash.slice(1));
  const fromLink = hash.get('trip');
  // manifest 의 앱 바로가기(#tab=checklist 등)로 실행된 경우
  const wantTab = hash.get('tab');
  const code = fromLink || lastTripCode();

  if (code) {
    const ok = await openTrip(code);
    if (ok) {
      if (wantTab && VIEWS[wantTab]) { tab = wantTab; render(); }
      return;
    }
  }
  if (wantTab && VIEWS[wantTab]) tab = wantTab;
  render();
  if (!listTrips().length) openNewTrip();
  else openTripList();
}

// 해시만 바뀌면 페이지가 다시 로드되지 않으므로(=boot 이 안 돎) 여기서 직접 처리한다.
// 앱 바로가기(#tab=budget)를 이미 열려 있는 창이 받아내는 경우가 여기에 해당.
window.addEventListener('hashchange', () => {
  const p = new URLSearchParams(location.hash.slice(1));
  const code = p.get('trip');
  if (code && code !== store.code) { openTrip(code); return; }
  const wantTab = p.get('tab');
  if (wantTab && VIEWS[wantTab] && wantTab !== tab) { tab = wantTab; render(); }
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
