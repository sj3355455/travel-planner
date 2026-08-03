// 앱 셸 — 탭 전환, 여행 열기/만들기/공유, 설정, 동기화 표시
import { h, $, modal, toast, input, field, confirmDialog } from './ui.js';
import {
  store, listTrips, forgetTrip, lastTripCode, fmtDate, tripDays, mergeDoc, catOf,
  syncTripList, clearLocalTripList,
} from './store.js';
import {
  isLoggedIn, currentUser, signIn, signUp, signOut, refreshSession, onAuthChange, ID_RULE, ID_HINT,
} from './auth.js';
import { remoteEnabled } from './supabase.js';
import { tripToMarkdown } from './exportMd.js';
import { openItemEditor } from './itemEditor.js';
import {
  isStandalone, isIOS, isFirefox, hasPrompt, onInstallChange, runInstall,
  showInstallHelp, shouldGate, renderGate,
} from './install.js';
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

// ── 앱 설치 버튼 (주로 데스크톱용) ────────────────────────
// 휴대폰은 접속 즉시 설치 화면만 띄우므로(install.js 의 게이트) 이 버튼은 PC 에서 주로 쓰인다.
function updateInstallBtn() {
  $('#btnInstall').hidden = isStandalone() || !(hasPrompt() || isIOS() || isFirefox());
}

onInstallChange(() => {
  updateInstallBtn();
  if (isStandalone()) toast('앱으로 설치했습니다 🎉');
});

$('#btnInstall').addEventListener('click', async () => {
  if (hasPrompt()) {
    if (!(await runInstall())) toast('설치를 취소했습니다');
    return;
  }
  showInstallHelp();
});

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

  body.append(accountBar(() => { m.close(); openTripList(); }));

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

// ── 계정 ──────────────────────────────────────────────────
/** 여행 목록 위에 붙는 로그인 상태 줄 */
function accountBar(reopen) {
  if (!remoteEnabled()) {
    return h('p.muted.small', { style: { marginBottom: '12px' } },
      'Supabase 가 설정되지 않아 계정 기능을 쓸 수 없습니다.');
  }

  if (!isLoggedIn()) {
    return h('div.account-bar',
      h('div.grow',
        h('strong', '로그인하면 기기가 바뀌어도 목록이 그대로'),
        h('div.muted.small', '지금은 이 기기에만 저장됩니다'),
      ),
      h('button.btn.small.primary', { onclick: () => openAuth(reopen) }, '로그인'),
    );
  }

  const me = currentUser();
  return h('div.account-bar',
    h('div.grow',
      h('strong', `${me.loginId} 님`),
      h('div.muted.small', '여행 목록이 계정에 저장됩니다'),
    ),
    h('button.btn.small', {
      onclick: async () => {
        if (!await confirmDialog('로그아웃',
          '이 기기의 여행 목록이 지워집니다.\n여행 내용은 서버에 그대로 남아 있어, 다시 로그인하면 복구됩니다.', '로그아웃')) return;
        signOut();
        clearLocalTripList();
        toast('로그아웃했습니다');
        reopen();
      },
    }, '로그아웃'),
  );
}

/** 로그인 / 가입 모달 (탭 전환형) */
function openAuth(onDone) {
  let mode = 'in';   // 'in' | 'up'

  const fId = input({ placeholder: '아이디', autocapitalize: 'none', autocorrect: 'off', spellcheck: false });
  const fPw = input({ type: 'password', placeholder: '비밀번호', autocomplete: 'current-password' });
  const fPw2 = input({ type: 'password', placeholder: '비밀번호 확인', autocomplete: 'new-password' });
  const pw2Field = field('비밀번호 확인', fPw2);
  const hint = h('p.muted.small');
  const tabs = h('div.auth-tabs');

  const paint = () => {
    tabs.innerHTML = '';
    for (const [k, label] of [['in', '로그인'], ['up', '회원가입']]) {
      tabs.append(h('button', {
        class: 'auth-tab' + (mode === k ? ' on' : ''),
        onclick: () => { mode = k; paint(); },
      }, label));
    }
    pw2Field.hidden = mode === 'in';
    hint.textContent = mode === 'up'
      ? `아이디는 ${ID_HINT}, 비밀번호는 6자 이상.`
      : '가입한 아이디와 비밀번호를 입력하세요.';
    okBtn.textContent = mode === 'in' ? '로그인' : '가입하고 시작';
  };

  const okBtn = h('button.btn.primary', { onclick: () => submit() }, '로그인');

  const submit = async () => {
    const id = fId.value.trim();
    const pw = fPw.value;

    if (!ID_RULE.test(id)) { toast(`아이디는 ${ID_HINT}`); return; }
    if (pw.length < 6) { toast('비밀번호는 6자 이상이어야 합니다'); return; }
    if (mode === 'up' && pw !== fPw2.value) { toast('비밀번호가 서로 다릅니다'); return; }

    okBtn.disabled = true;
    okBtn.textContent = mode === 'in' ? '로그인 중…' : '가입 중…';
    try {
      if (mode === 'in') await signIn(id, pw);
      else await signUp(id, pw);

      toast(`${id} 님으로 로그인했습니다`);
      m.close();
      await syncTripList();     // 다른 기기에서 만든 여행을 이 기기로 가져온다
      onDone && onDone();
    } catch (e) {
      toast(e.message);
      okBtn.disabled = false;
      paint();
    }
  };

  fPw.addEventListener('keydown', e => { if (e.key === 'Enter' && mode === 'in') submit(); });
  fPw2.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  const m = modal({
    title: '계정',
    body: h('div.form',
      tabs,
      field('아이디', fId),
      field('비밀번호', fPw),
      pw2Field,
      hint,
      h('p.muted.small', '※ 이메일이 아니라 아이디로 가입합니다. 비밀번호를 잊으면 복구할 수 없으니 잘 기억해 주세요.'),
    ),
    actions: [{ label: '취소' }, { label: '로그인', primary: true, onClick: () => { submit(); return false; } }],
  });

  // modal 이 만든 기본 버튼 대신 우리 버튼을 쓰려고 교체
  const foot = m.el.querySelector('.modal-foot');
  foot.lastChild.replaceWith(okBtn);

  paint();
  setTimeout(() => fId.focus(), 100);
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
  // 휴대폰 + 미설치 = 앱 UI 대신 설치 화면만 보여준다.
  // 여행 데이터를 불러오기 전에 끊어서 불필요한 네트워크 요청도 막는다.
  if (shouldGate()) { renderGate(); return; }

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

/**
 * 로그인 상태라면 토큰을 한 번 갱신하고 목록을 서버와 맞춘다.
 * 앱을 며칠 만에 열어도 만료된 토큰 때문에 목록이 빈 채로 보이지 않게 하려는 것.
 */
async function bootAccount() {
  if (!isLoggedIn() || !remoteEnabled()) return;
  await refreshSession();
  if (isLoggedIn()) await syncTripList();
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

// 계정 동기화는 앱 표시를 막지 않도록 백그라운드로 돌린다
bootAccount().catch(e => console.warn('[account] 초기화 실패', e));
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
