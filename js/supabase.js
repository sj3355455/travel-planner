// Supabase 접근 계층 — SDK 없이 fetch 만 쓴다.
//
// 테이블(trips)에는 RLS 를 켜고 정책을 하나도 두지 않아 anon 키로는 직접 접근이 막혀 있다.
// 대신 schema.sql 이 만드는 security definer 함수 3개(trip_get/trip_create/trip_save)만 호출한다.
// → 공유 코드를 정확히 아는 사람만 그 여행 하나에 접근할 수 있고,
//   anon 키가 노출돼도 전체 여행 목록을 긁어갈 수는 없다.
import { SB_URL, SB_KEY } from './config.js';
import { accessToken, refreshSession } from './auth.js';

export const remoteEnabled = () => Boolean(SB_URL && SB_KEY);

/** 로그인했으면 사용자 토큰을, 아니면 공개 키를 쓴다(익명도 공유 코드로 접근 가능해야 하므로) */
const authHeader = () => 'Bearer ' + (accessToken() || SB_KEY);

/**
 * @param opts.keepalive 페이지가 닫히는 중에도 요청을 끝까지 보낸다.
 *   pagehide 에서 보내는 마지막 저장에 필요하다 — 없으면 브라우저가 요청을 취소해
 *   앱을 끄기 직전 편집이 서버에 도달하지 못한다. (본문 64KB 제한)
 */
async function rpc(fn, args, opts = {}) {
  if (!remoteEnabled()) throw new Error('Supabase 미설정');
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    keepalive: Boolean(opts.keepalive),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.msg || body.hint)) || `오류 ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, body });
  }
  return body;
}

/** 공유 코드로 문서 조회. 없으면 null. */
export async function fetchTrip(code) {
  const doc = await rpc('trip_get', { p_code: code });
  return doc ? { code, doc } : null;
}

/** 새 여행 생성. 코드가 이미 있으면 false 를 돌려준다. */
export async function createTrip(code, doc, opts) {
  return await rpc('trip_create', { p_code: code, p_doc: doc }, opts) === true;
}

/** 문서 전체 덮어쓰기 (필드 단위 병합은 store.mergeDoc 가 이미 끝낸 상태). */
export async function pushTrip(code, doc, opts) {
  return rpc('trip_save', { p_code: code, p_doc: doc }, opts);
}

// ── 내 여행 목록 (로그인 사용자 전용) ──────────────────────
// user_trips 테이블은 RLS 로 자기 행만 접근 가능하다. 반드시 사용자 토큰이 필요하므로
// 로그인 상태가 아니면 호출하지 않는다.
async function restFetch(path, opts = {}, retry = true) {
  const res = await fetch(SB_URL + '/rest/v1' + path, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  // 토큰 만료 → 한 번만 갱신하고 재시도
  if (res.status === 401 && retry && await refreshSession()) {
    return restFetch(path, opts, false);
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.hint)) || `오류 ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, body });
  }
  return body;
}

/** 서버에 저장된 내 여행 목록 */
export function fetchMyTrips() {
  return restFetch('/user_trips?select=code,title,opened_at&order=opened_at.desc');
}

/** 내 목록에 추가/갱신 (같은 코드가 있으면 덮어쓴다) */
export function upsertMyTrip(userId, code, title) {
  return restFetch('/user_trips', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, code, title: title || '', opened_at: new Date().toISOString() }),
  });
}

/** 내 목록에서 제거 (여행 자체는 남는다) */
export function removeMyTrip(code) {
  return restFetch(`/user_trips?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE' });
}
