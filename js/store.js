// ─────────────────────────────────────────────────────────────
// 상태 저장소 + 동기화 엔진
//
// 문서 모델은 "엔티티별 최종수정시각(mt) 기반 병합"을 쓴다.
// 항목/체크리스트/기타비용은 전부 id 를 키로 하는 맵이고, 각 레코드에 mt(수정시각)와
// del(삭제 표식)이 붙는다. 두 기기가 동시에 편집해도 병합은 다음 규칙으로 끝난다.
//   같은 id 가 양쪽에 있으면 → mt 가 큰 쪽 채택
//   한쪽에만 있으면        → 그대로 채택
// 덕분에 "A는 1일차를 고치고 B는 준비물을 고쳤는데 나중에 저장한 쪽이 상대 작업을 날림"
// 같은 사고가 생기지 않는다. 같은 항목의 같은 필드를 동시에 고친 경우만 나중 값이 이긴다.
// ─────────────────────────────────────────────────────────────
import {
  remoteEnabled, fetchTrip, createTrip, pushTrip,
  fetchMyTrips, upsertMyTrip, removeMyTrip,
} from './supabase.js';
import { isLoggedIn, currentUser } from './auth.js';
import { POLL_MS, PUSH_DEBOUNCE_MS } from './config.js';

const LS_TRIPS = 'tp.trips';        // 내 기기에 등록된 여행 목록
const LS_DOC = code => 'tp.doc.' + code;
const LS_LAST = 'tp.last';          // 마지막으로 연 여행 코드

export const now = () => Date.now();
export const uid = () => Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-4);

/** 사람이 불러주기 쉬운 공유 코드 (헷갈리는 0/O/1/I 제외) */
export function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}

export const CATEGORIES = [
  { id: 'sight', label: '관광', icon: '📍', color: '#5aa9ff' },
  { id: 'food', label: '식사', icon: '🍽', color: '#ff9f5a' },
  { id: 'move', label: '이동', icon: '🚃', color: '#8f8fff' },
  { id: 'stay', label: '숙소', icon: '🛏', color: '#5ad1a5' },
  { id: 'shop', label: '쇼핑', icon: '🛍', color: '#ff6fa8' },
  { id: 'etc', label: '기타', icon: '✨', color: '#9aa4ad' },
];
export const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[5];

/** 일차별 지도 핀·시간표 색상 */
export const DAY_COLORS = ['#5aa9ff', '#ff9f5a', '#5ad1a5', '#ff6fa8', '#c08bff', '#ffd75a', '#4ecdc4', '#f97b7b'];
export const dayColor = i => DAY_COLORS[i % DAY_COLORS.length];

// ── 빈 문서 ────────────────────────────────────────────────
/**
 * @param stamp 각 meta 필드의 최종수정시각. 기본은 "지금"(= 사용자가 방금 만든 여행).
 *   원격 문서를 받기 전의 임시 껍데기로 쓸 때는 반드시 0 을 넘겨야 한다.
 *   그러지 않으면 이 기본값들이 서버 값보다 최신으로 판정돼 남의 여행 제목·날짜를 덮어쓴다.
 */
export function emptyDoc(title = '새 여행', stamp = now()) {
  const t = stamp;
  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const end = new Date(today); end.setDate(end.getDate() + 2);
  return {
    v: 1,
    meta: {
      title,
      start: iso(today),
      end: iso(end),
      people: 1,
      curLabel: '',   // 현지 통화 표기 (예: TWD). 비우면 원화만 사용
      curRate: 0,     // 현지통화 1단위 = ? 원
      memo: '',
    },
    metaMt: { title: t, start: t, end: t, people: t, curLabel: t, curRate: t, memo: t },
    items: {},   // 일정
    checks: {},  // 준비물
    costs: {},   // 일정에 안 붙는 비용(항공권·숙소 등)
    notes: {},   // 일차별 메모 (id = 'day-0' 형태)
  };
}

/** 병합 대상이 되는 컬렉션 — 여기에 추가하면 병합·정리에 자동 반영된다 */
const COLLS = ['items', 'checks', 'costs', 'notes'];

// ── 병합 ──────────────────────────────────────────────────
function mergeMap(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    if (!x) out[k] = y;
    else if (!y) out[k] = x;
    else out[k] = (y.mt || 0) > (x.mt || 0) ? y : x;
  }
  return out;
}

export function mergeDoc(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const meta = {}, metaMt = {};
  for (const k of new Set([...Object.keys(local.meta || {}), ...Object.keys(remote.meta || {})])) {
    const lt = (local.metaMt || {})[k] || 0;
    const rt = (remote.metaMt || {})[k] || 0;
    const useRemote = rt > lt;
    meta[k] = useRemote ? remote.meta[k] : local.meta[k];
    metaMt[k] = Math.max(lt, rt);
  }
  const out = { v: 1, meta, metaMt };
  for (const c of COLLS) out[c] = mergeMap(local[c], remote[c]);
  return out;
}

/** 오래된 삭제 표식 정리 — 30일 지난 tombstone 은 버린다 */
function gc(doc) {
  const cutoff = now() - 30 * 864e5;
  for (const key of COLLS) {
    if (!doc[key]) { doc[key] = {}; continue; }
    for (const [id, r] of Object.entries(doc[key])) {
      if (r.del && (r.mt || 0) < cutoff) delete doc[key][id];
    }
  }
  return doc;
}

// ── 여행 목록 ──────────────────────────────────────────────
// 목록은 항상 로컬(localStorage)에 두고 즉시 렌더한다.
// 로그인한 경우에만 서버(user_trips)와 양방향으로 맞춘다 → 다른 기기에서도 같은 목록이 보인다.
export function listTrips() {
  try { return JSON.parse(localStorage.getItem(LS_TRIPS) || '[]'); } catch { return []; }
}
function saveTrips(list) {
  localStorage.setItem(LS_TRIPS, JSON.stringify(list));
}

export function rememberTrip(code, title) {
  const list = listTrips().filter(t => t.code !== code);
  list.unshift({ code, title, opened: now() });
  saveTrips(list.slice(0, 50));

  if (isLoggedIn()) {
    const me = currentUser();
    upsertMyTrip(me.id, code, title).catch(e => console.warn('[account] 목록 저장 실패', e));
  }
}

export function forgetTrip(code) {
  saveTrips(listTrips().filter(t => t.code !== code));
  localStorage.removeItem(LS_DOC(code));
  if (localStorage.getItem(LS_LAST) === code) localStorage.removeItem(LS_LAST);

  if (isLoggedIn()) removeMyTrip(code).catch(e => console.warn('[account] 목록 삭제 실패', e));
}

/**
 * 로그인 직후 / 앱 시작 시 서버 목록과 로컬 목록을 합친다.
 *  · 서버에만 있는 여행 → 로컬에 추가 (다른 기기에서 만든 것)
 *  · 로컬에만 있는 여행 → 서버에 올림 (로그인 전에 이 기기에서 만든 것)
 * 반환: 합쳐진 목록
 */
export async function syncTripList() {
  if (!isLoggedIn() || !remoteEnabled()) return listTrips();

  const local = listTrips();
  let remote = [];
  try {
    remote = (await fetchMyTrips()) || [];
  } catch (e) {
    console.warn('[account] 목록 불러오기 실패', e);
    return local;
  }

  const byCode = new Map();
  for (const r of remote) {
    byCode.set(r.code, { code: r.code, title: r.title || '', opened: new Date(r.opened_at).getTime() });
  }

  const me = currentUser();
  const uploads = [];
  for (const l of local) {
    const r = byCode.get(l.code);
    if (!r) {
      // 로그인 전에 이 기기에서 만든 여행 → 계정에 편입
      byCode.set(l.code, l);
      uploads.push(upsertMyTrip(me.id, l.code, l.title));
    } else if (l.opened > r.opened) {
      byCode.set(l.code, l);   // 이 기기에서 더 최근에 열었으면 그 제목·시각을 채택
    }
  }
  await Promise.allSettled(uploads);

  const merged = [...byCode.values()].sort((a, b) => (b.opened || 0) - (a.opened || 0)).slice(0, 50);
  saveTrips(merged);
  return merged;
}

/** 로그아웃 시 이 기기의 목록을 비운다 (여행 데이터 자체는 서버에 그대로 남는다) */
export function clearLocalTripList() {
  saveTrips([]);
  localStorage.removeItem(LS_LAST);
}

// ── 스토어 본체 ────────────────────────────────────────────
class Store extends EventTarget {
  constructor() {
    super();
    this.code = null;
    this.doc = emptyDoc();
    this.sync = remoteEnabled() ? 'idle' : 'local';  // local | idle | pushing | pulling | error
    this.dirty = false;
    // 편집이 일어날 때마다 1 증가. 전송 중에 편집이 끼어들었는지 판별하는 유일한 근거다.
    // update() 는 doc 을 제자리에서 고치므로 객체 동일성 비교로는 변경을 알 수 없다.
    this.rev = 0;
    this._pushTimer = null;
    this._pollTimer = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, fn); }

  setSync(s) { if (this.sync !== s) { this.sync = s; this.emit('sync'); } }

  // ── 열기/만들기 ─────────────────────────────────────────
  async open(rawCode) {
    // 서버(trip_get)는 코드를 대문자로 맞춰 조회한다. 로컬 저장 키도 같이 맞춰야
    // 소문자 링크로 들어왔을 때 사본이 둘로 갈라지지 않는다.
    const code = String(rawCode || '').trim().toUpperCase();
    this.code = code;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(LS_DOC(code)) || 'null'); } catch { }
    // 로컬 사본도 없고 서버도 못 쓰면 열 수 있는 게 없다(공유 링크를 로컬 전용 모드에서 연 경우)
    if (!local && !remoteEnabled()) return { notFound: true, offline: true };

    // 아직 원격을 못 받았으므로 mt 를 0 으로 둔다 → 서버 값이 무조건 이긴다
    this.doc = local || emptyDoc('여행', 0);
    localStorage.setItem(LS_LAST, code);
    this.emit('change');

    if (remoteEnabled()) {
      try {
        const row = await fetchTrip(code);
        if (row) {
          this.doc = gc(mergeDoc(this.doc, row.doc));
          this._persist();
          this.emit('change');
          // 로컬에만 있던 내용이 있었다면 서버에도 반영
          if (local) this._schedulePush();
        } else if (local) {
          await createTrip(code, this.doc);   // 서버에서 지워졌던 경우 복구
        } else {
          this.setSync('error');
          return { notFound: true };
        }
        this.setSync('idle');
      } catch (e) {
        console.warn('[sync] open 실패', e);
        this.setSync('error');
        if (!local) return { notFound: true, offline: true };
      }
    }
    rememberTrip(code, this.doc.meta.title);
    this._startPolling();
    return { ok: true };
  }

  async create(title) {
    const doc = emptyDoc(title);
    let code = makeCode();
    if (remoteEnabled()) {
      for (let i = 0; i < 5; i++) {
        try {
          if (await createTrip(code, doc)) break;
          code = makeCode();          // 코드 충돌 — 다시 뽑는다
        } catch (e) {
          console.warn('[sync] create 실패 — 로컬로만 생성', e);
          this.setSync('error');
          break;
        }
      }
    }
    this.code = code;
    this.doc = doc;
    this._persist();
    localStorage.setItem(LS_LAST, code);
    rememberTrip(code, title);
    this.emit('change');
    this._startPolling();
    return code;
  }

  // ── 변경 ────────────────────────────────────────────────
  /** fn(doc) 안에서 문서를 직접 수정한다. mt 갱신은 아래 헬퍼들이 담당. */
  update(fn) {
    fn(this.doc);
    this.rev++;
    this._persist();
    this.emit('change');
    this._schedulePush();
  }

  setMeta(patch) {
    this.update(d => {
      const t = now();
      for (const [k, v] of Object.entries(patch)) { d.meta[k] = v; d.metaMt[k] = t; }
    });
    if (patch.title) rememberTrip(this.code, patch.title);
  }

  put(coll, rec) {
    const id = rec.id || uid();
    this.update(d => {
      if (!d[coll]) d[coll] = {};   // 이 컬렉션이 없던 시절에 만들어진 문서 대비
      d[coll][id] = { ...(d[coll][id] || {}), ...rec, id, mt: now() };
    });
    return id;
  }

  /** 삭제. 되돌리기 함수를 반환하므로 토스트의 "실행취소" 에 그대로 연결하면 된다. */
  del(coll, id) {
    const prev = this.doc[coll] && this.doc[coll][id];
    this.update(d => {
      if (!d[coll]) d[coll] = {};
      d[coll][id] = { id, del: true, mt: now() };
    });
    return () => {
      if (!prev || prev.del) return;
      this.update(d => { d[coll][id] = { ...prev, mt: now() }; });
    };
  }

  /** 삭제 표식을 뺀 실제 레코드 배열 */
  all(coll) {
    return Object.values(this.doc[coll] || {}).filter(r => !r.del);
  }

  _persist() {
    if (!this.code) return;
    try { localStorage.setItem(LS_DOC(this.code), JSON.stringify(this.doc)); }
    catch (e) { console.warn('로컬 저장 실패', e); }
  }

  // ── 동기화 ──────────────────────────────────────────────
  _schedulePush() {
    if (!remoteEnabled() || !this.code) return;
    this.dirty = true;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this._push(), PUSH_DEBOUNCE_MS);
  }

  async _push(opts = {}) {
    if (!remoteEnabled() || !this.code || !this.dirty) return;
    this.setSync('pushing');
    const snapshot = this.doc;
    try {
      // 밀어올리기 직전에 원격을 한 번 더 합친다(다른 기기 변경 유실 방지)
      const row = await fetchTrip(this.code);
      const merged = gc(mergeDoc(snapshot, row ? row.doc : null));
      this.doc = mergeDoc(merged, this.doc);   // push 대기 중 생긴 로컬 변경까지 반영
      this._persist();

      // 전송 직전의 편집 횟수를 기억한다.
      // 요청이 오가는 동안 사용자가 또 편집하면 그 내용은 이번 요청 본문에 없는데,
      // 그때 dirty 를 지워버리면 다음 편집이 있을 때까지 서버에 안 올라간다.
      const sentRev = this.rev;
      if (!row) await createTrip(this.code, this.doc, opts);
      else await pushTrip(this.code, this.doc, opts);

      if (this.rev === sentRev) {
        this.dirty = false;
        this.setSync('idle');
      } else {
        this._schedulePush();   // 전송 중에 생긴 변경을 이어서 올린다
      }
      this.emit('change');
    } catch (e) {
      console.warn('[sync] push 실패', e);
      this.setSync('error');
      setTimeout(() => this._schedulePush(), 5000);   // 오프라인이면 다시 시도
    }
  }

  async _pull() {
    if (!remoteEnabled() || !this.code || this.dirty) return;
    try {
      const row = await fetchTrip(this.code);
      if (!row) return;
      const before = JSON.stringify(this.doc);
      const merged = gc(mergeDoc(this.doc, row.doc));
      if (JSON.stringify(merged) !== before) {
        this.doc = merged;
        this._persist();
        this.emit('change');
      }
      if (this.sync === 'error') this.setSync('idle');
    } catch (e) {
      this.setSync('error');
    }
  }

  _startPolling() {
    if (!remoteEnabled()) return;
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this._pull();
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._pull();
    });
    window.addEventListener('online', () => { this._pull(); this._schedulePush(); });
  }

  /**
   * 앱을 닫기 직전 남은 변경을 즉시 밀어올린다.
   * keepalive 를 켜야 페이지가 사라진 뒤에도 요청이 완주한다.
   */
  flush() {
    clearTimeout(this._pushTimer);
    if (this.dirty) this._push({ keepalive: true });
  }
}

export const store = new Store();
export const lastTripCode = () => localStorage.getItem(LS_LAST);

/**
 * 다음에 앱을 열 때 자동으로 열릴 여행을 지정한다.
 * 설치 게이트에서 쓴다 — 설치 과정에서 URL 의 #trip=코드 가 사라지기 때문에,
 * 미리 저장해 두어야 설치 후 첫 실행에서 공유받은 여행이 열린다.
 */
export const setLastTripCode = code => {
  try { localStorage.setItem(LS_LAST, code); } catch { }
};

// ── 날짜 유틸 ──────────────────────────────────────────────
const WD = ['일', '월', '화', '수', '목', '금', '토'];

export function parseDate(s) {
  const [y, m, d] = (s || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function fmtDate(s) {
  if (!s) return '';
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
/** 여행 일자 배열 — [{ index, date:'YYYY-MM-DD', label:'1일차', sub:'11/5(목)' }] */
export function tripDays(meta) {
  const out = [];
  if (!meta.start) return out;
  const s = parseDate(meta.start);
  const e = meta.end ? parseDate(meta.end) : s;
  const n = Math.max(0, Math.round((e - s) / 864e5));
  for (let i = 0; i <= Math.min(n, 60); i++) {
    const d = new Date(s); d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ index: i, date: iso, label: `${i + 1}일차`, sub: `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})` });
  }
  return out;
}

// ── 시간 유틸 ──────────────────────────────────────────────
/** 'HH:MM' → 분. 값이 없으면 null. */
export function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
/** 분 → '1시간 20분' */
export function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
}
/** 일차별 메모의 고정 id */
export const dayNoteId = day => 'day-' + day;

// ── 금액 유틸 ──────────────────────────────────────────────
/** 금액 하나를 원화로 환산. cur 이 'loc' 이면 설정된 환율을 곱한다. */
export function amountKRW(amount, cur, meta) {
  const amt = Number(amount || 0);
  if (!amt) return 0;
  if (cur === 'loc' && Number(meta.curRate) > 0) return amt * Number(meta.curRate);
  return amt;
}

export const peopleOf = meta => Math.max(1, Number(meta.people) || 1);

/**
 * "1인 기준" 비용의 인원 배수.
 *
 * ppRaw 는 amount/spent 가 "1인당 금액"으로 저장됐다는 표식이다.
 * 예전에는 저장 시점에 인원을 곱해 총액을 넣었는데, 그러면 같은 항목을 다시 열어
 * 저장할 때마다 인원수가 또 곱해졌다(2명이면 10만 → 20만 → 40만).
 * 이제는 입력값을 그대로 두고 화면에 보여줄 때만 곱한다.
 * ppRaw 가 없는 옛 레코드는 이미 총액이므로 곱하지 않는다.
 */
const perPersonFactor = (rec, meta) => (rec.perPerson && rec.ppRaw ? peopleOf(meta) : 1);

/** 레코드의 "예상" 금액 (items 는 cost, costs 는 amount) */
export function toKRW(rec, meta) {
  return amountKRW(rec.cost ?? rec.amount, rec.cur, meta) * perPersonFactor(rec, meta);
}

/** 레코드의 "실제 지출" 금액. 입력 안 했으면 0. */
export function spentKRW(rec, meta) {
  return amountKRW(rec.spent, rec.cur, meta) * perPersonFactor(rec, meta);
}

/** 실제 지출을 한 번이라도 입력했는지 (0원 지출과 미입력을 구분) */
export const hasSpent = rec => rec.spent != null && rec.spent !== '';

export const won = n => Math.round(n).toLocaleString('ko-KR') + '원';

/** 부호를 붙인 차액 표기 — 예산 대비 절약/초과 */
export const wonDiff = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
