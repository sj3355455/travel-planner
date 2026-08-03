// Supabase 접근 계층 — SDK 없이 fetch 만 쓴다.
//
// 테이블(trips)에는 RLS 를 켜고 정책을 하나도 두지 않아 anon 키로는 직접 접근이 막혀 있다.
// 대신 schema.sql 이 만드는 security definer 함수 3개(trip_get/trip_create/trip_save)만 호출한다.
// → 공유 코드를 정확히 아는 사람만 그 여행 하나에 접근할 수 있고,
//   anon 키가 노출돼도 전체 여행 목록을 긁어갈 수는 없다.
import { SB_URL, SB_KEY } from './config.js';

export const remoteEnabled = () => Boolean(SB_URL && SB_KEY);

async function rpc(fn, args) {
  if (!remoteEnabled()) throw new Error('Supabase 미설정');
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
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
export async function createTrip(code, doc) {
  return await rpc('trip_create', { p_code: code, p_doc: doc }) === true;
}

/** 문서 전체 덮어쓰기 (필드 단위 병합은 store.mergeDoc 가 이미 끝낸 상태). */
export async function pushTrip(code, doc) {
  return rpc('trip_save', { p_code: code, p_doc: doc });
}
