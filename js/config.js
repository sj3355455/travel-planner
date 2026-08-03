// ─────────────────────────────────────────────────────────────
// Supabase 연결 설정
//
// 아직 비워두면 앱은 "로컬 전용 모드"로 동작한다(브라우저에만 저장, 기기 간 공유 X).
// Supabase 프로젝트를 만든 뒤 아래 두 값을 채우고 schema.sql 을 SQL Editor 에서 실행하면
// 그때부터 기기·사람 간 동기화가 켜진다. 자세한 절차는 README.md 참고.
//
// SB_KEY 는 "anon public"(= Publishable) 키다. 브라우저에 노출되는 것이 정상이며,
// 실제 접근 통제는 schema.sql 의 RLS + security definer 함수가 담당한다.
// ─────────────────────────────────────────────────────────────
export const SB_URL = 'https://cxchfovxtrkveaihumbx.supabase.co';
export const SB_KEY = 'sb_publishable_iCFaCNKRMjg3P1qtanAaRA_dSBYrHCO';

// 원격 변경사항을 확인하는 주기(ms). 탭이 화면에 보일 때만 돈다.
export const POLL_MS = 4000;

// 로컬 변경을 서버로 밀어올리기 전 기다리는 시간(ms) — 타이핑 중 과도한 요청 방지
export const PUSH_DEBOUNCE_MS = 700;
