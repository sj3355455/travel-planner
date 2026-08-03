// 계정 — Supabase Auth 를 SDK 없이 REST 로 직접 쓴다.
//
// 지원 방식
//   · 이메일 + 비밀번호
//   · 소셜 로그인(카카오·구글) — OAuth 리디렉트 방식
//
// 소셜 로그인은 /auth/v1/authorize 로 보냈다가 돌아올 때 URL 해시에 토큰이 실려 온다.
// 이 앱은 해시를 #trip=코드 로도 쓰기 때문에, 나갈 때 원래 해시를 sessionStorage 에
// 넣어두고 돌아와서 되돌린다(consumeOAuthRedirect).
import { SB_URL, SB_KEY } from './config.js';

const LS_AUTH = 'tp.auth';
const SS_BACK = 'tp.oauthBack';

/** 소셜 로그인 버튼 목록. 대시보드에서 켜 둔 것만 실제로 동작한다. */
export const PROVIDERS = [
  { id: 'kakao', label: '카카오로 계속하기', bg: '#FEE500', fg: '#191600', icon: '🗨️' },
  { id: 'google', label: 'Google로 계속하기', bg: '#ffffff', fg: '#1f1f1f', icon: 'G', border: true },
];

export const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
export const accessToken = () => (session ? session.token : null);
export const currentUser = () =>
  (session ? { id: session.userId, name: session.name, email: session.email, provider: session.provider } : null);

/** 화면에 보여줄 이름 — 소셜은 닉네임, 이메일 가입은 @ 앞부분 */
export function displayName() {
  if (!session) return '';
  return session.name || String(session.email || '').split('@')[0] || '사용자';
}

// ── 공통 요청 ──────────────────────────────────────────────
async function authFetch(path, body, method = 'POST') {
  const res = await fetch(SB_URL + path, {
    method,
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translate(d.msg || d.error_description || d.message || d.error || `오류 ${res.status}`));
  return d;
}

function translate(msg) {
  const m = String(msg);
  if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 틀렸습니다';
  if (/already registered|already exists|User already/i.test(m)) return '이미 가입된 이메일입니다. 로그인해 주세요';
  if (/Password should be at least/i.test(m)) return '비밀번호는 6자 이상이어야 합니다';
  if (/Email not confirmed/i.test(m)) return '이메일 인증이 필요합니다. 받은 메일의 링크를 눌러주세요';
  if (/Unable to validate email|invalid format/i.test(m)) return '이메일 형식이 올바르지 않습니다';
  if (/provider is not enabled/i.test(m)) return '이 소셜 로그인은 아직 켜져 있지 않습니다';
  if (/rate limit|too many|For security purposes/i.test(m)) return '요청이 너무 잦습니다. 잠시 후 다시 시도하세요';
  if (/signups not allowed|Signups not allowed/i.test(m)) return '현재 가입이 막혀 있습니다';
  return m;
}

/** 응답의 토큰을 세션으로 굳힌다 */
function adopt(d) {
  if (!d || !d.access_token) return false;
  const u = d.user || {};
  const meta = u.user_metadata || {};
  save({
    token: d.access_token,
    refresh: d.refresh_token,
    userId: u.id || (session && session.userId) || null,
    email: u.email || (session && session.email) || '',
    name: meta.name || meta.full_name || meta.nickname || (session && session.name) || '',
    provider: (u.app_metadata && u.app_metadata.provider) || 'email',
  });
  return true;
}

// ── 이메일 ────────────────────────────────────────────────
/**
 * 가입. 프로젝트에서 "Confirm email" 이 켜져 있으면 세션 없이 끝나고,
 * 사용자는 메일의 링크를 눌러야 한다. 그 경우 needsConfirm 을 돌려준다.
 */
export async function signUpEmail(email, password) {
  const d = await authFetch('/auth/v1/signup', {
    email: email.trim(),
    password,
    options: { emailRedirectTo: appUrl() },
  });
  if (!d.access_token) return { needsConfirm: true, email: email.trim() };
  adopt(d);
  return { user: currentUser() };
}

export async function signInEmail(email, password) {
  const d = await authFetch('/auth/v1/token?grant_type=password', { email: email.trim(), password });
  adopt(d);
  return currentUser();
}

/** 비밀번호 재설정 메일. 프로젝트에 SMTP 가 설정돼 있어야 실제로 도착한다. */
export function sendPasswordReset(email) {
  return authFetch('/auth/v1/recover', { email: email.trim(), options: { redirectTo: appUrl() } });
}

// ── 소셜 (OAuth) ──────────────────────────────────────────
/** 리디렉트가 돌아올 주소. Supabase 의 Redirect URLs 허용 목록에 등록돼 있어야 한다. */
const appUrl = () => location.origin + location.pathname;

export function startOAuth(provider) {
  // 로그인하러 나간 사이에 #trip=코드 가 날아가지 않도록 보관
  try { sessionStorage.setItem(SS_BACK, location.hash || ''); } catch { }
  const url = `${SB_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}`
    + `&redirect_to=${encodeURIComponent(appUrl())}`;
  location.href = url;
}

/**
 * OAuth 리디렉트로 돌아온 직후 URL 해시의 토큰을 흡수한다.
 * boot() 가 해시에서 #trip= 을 읽기 "전에" 호출해야 한다.
 * @returns 'ok' | 'none'  (실패 시 예외)
 */
export function consumeOAuthRedirect() {
  const raw = location.hash.slice(1);
  if (!raw) return 'none';
  const p = new URLSearchParams(raw);
  const token = p.get('access_token');
  const err = p.get('error_description') || p.get('error');
  if (!token && !err) return 'none';

  // 나가기 전 해시(#trip=…)를 되살리고 토큰은 주소창에서 지운다
  let back = '';
  try { back = sessionStorage.getItem(SS_BACK) || ''; sessionStorage.removeItem(SS_BACK); } catch { }
  history.replaceState(null, '', location.pathname + location.search + back);

  if (err) throw new Error(translate(decodeURIComponent(err.replace(/\+/g, ' '))));

  save({ token, refresh: p.get('refresh_token'), userId: null, email: '', name: '', provider: 'oauth' });
  return 'ok';
}

/** 토큰만 받은 상태에서 사용자 정보를 채운다 (소셜 로그인 직후) */
export async function loadProfile() {
  if (!isLoggedIn()) return null;
  const res = await fetch(SB_URL + '/auth/v1/user', {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + session.token },
  });
  if (!res.ok) return null;
  const u = await res.json();
  const meta = u.user_metadata || {};
  save({
    ...session,
    userId: u.id,
    email: u.email || '',
    name: meta.name || meta.full_name || meta.nickname || meta.preferred_username || '',
    provider: (u.app_metadata && u.app_metadata.provider) || session.provider,
  });
  return currentUser();
}

// ── 공통 ──────────────────────────────────────────────────
export function signOut() {
  save(null);
}

/** 액세스 토큰 갱신. 실패하면 로그아웃 처리한다. */
export async function refreshSession() {
  if (!session || !session.refresh) return false;
  try {
    const d = await authFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh });
    const ok = adopt(d);
    if (ok && !session.userId) await loadProfile();
    return ok;
  } catch {
    save(null);
    return false;
  }
}
