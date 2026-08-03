// 계정 — Supabase Auth 를 SDK 없이 REST 로 직접 쓴다.
//
// 이메일 대신 "아이디"로 가입한다. 내부적으로는 아이디@travel-planner.app 이라는
// 가짜 이메일을 쓰고, 대시보드에서 이메일 확인(Confirm email)을 꺼 둔 것을 전제로 한다.
// 자세한 설정은 schema-auth.sql 의 주석 참고.
import { SB_URL, SB_KEY } from './config.js';

const LS_AUTH = 'tp.auth';
const EMAIL_DOMAIN = '@travel-planner.app';

/** 아이디 규칙 — 가짜 이메일의 로컬파트로 그대로 쓰이므로 ASCII 로 제한한다 */
export const ID_RULE = /^[a-zA-Z0-9._-]{3,20}$/;
export const ID_HINT = '영문·숫자·. _ - 조합 3~20자';

const toEmail = loginId => loginId.trim().toLowerCase() + EMAIL_DOMAIN;
const toLoginId = email => String(email || '').replace(EMAIL_DOMAIN, '');

let session = load();
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(LS_AUTH) || 'null'); } catch { return null; }
}
function save(s) {
  session = s;
  try {
    if (s) localStorage.setItem(LS_AUTH, JSON.stringify(s));
    else localStorage.removeItem(LS_AUTH);
  } catch { }
  listeners.forEach(fn => fn());
}

export const onAuthChange = fn => listeners.add(fn);
export const isLoggedIn = () => Boolean(session && session.token);
export const currentUser = () => (session ? { id: session.userId, loginId: session.loginId } : null);
export const accessToken = () => (session ? session.token : null);

/** 응답에서 세션을 뽑아 저장 */
function adopt(d) {
  if (!d || !d.access_token) return false;
  save({
    token: d.access_token,
    refresh: d.refresh_token,
    userId: d.user ? d.user.id : (session && session.userId),
    loginId: toLoginId(d.user ? d.user.email : ''),
  });
  return true;
}

async function authFetch(path, body) {
  const res = await fetch(SB_URL + path, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = d.msg || d.error_description || d.message || d.error || `오류 ${res.status}`;
    throw new Error(translate(raw, res.status));
  }
  return d;
}

/** Supabase 영어 오류를 한국어로 */
function translate(msg, status) {
  const m = String(msg);
  if (/Invalid login credentials/i.test(m)) return '아이디 또는 비밀번호가 틀렸습니다';
  if (/already registered|already exists/i.test(m)) return '이미 사용 중인 아이디입니다';
  if (/Password should be at least/i.test(m)) return '비밀번호는 6자 이상이어야 합니다';
  if (/Email not confirmed/i.test(m)) return '이메일 확인이 켜져 있습니다 — Supabase 설정에서 Confirm email 을 꺼주세요';
  if (/rate limit|too many/i.test(m)) return '요청이 너무 잦습니다. 잠시 후 다시 시도하세요';
  if (status === 0 || /fetch/i.test(m)) return '네트워크에 연결할 수 없습니다';
  return m;
}

export async function signUp(loginId, password) {
  const d = await authFetch('/auth/v1/signup', { email: toEmail(loginId), password });
  // 이메일 확인이 켜져 있으면 세션 없이 user 만 돌아온다 → 바로 알려준다
  if (!d.access_token) {
    throw new Error('가입은 됐지만 로그인 세션이 없습니다. Supabase 설정에서 “Confirm email”을 꺼주세요.');
  }
  adopt(d);
  return currentUser();
}

export async function signIn(loginId, password) {
  const d = await authFetch('/auth/v1/token?grant_type=password', { email: toEmail(loginId), password });
  adopt(d);
  return currentUser();
}

export function signOut() {
  save(null);
}

/** 액세스 토큰이 만료됐을 때 갱신. 실패하면 로그아웃 처리. */
export async function refreshSession() {
  if (!session || !session.refresh) return false;
  try {
    const d = await authFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh });
    return adopt(d);
  } catch {
    save(null);
    return false;
  }
}
