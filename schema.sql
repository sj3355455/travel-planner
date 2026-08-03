-- ─────────────────────────────────────────────────────────────
-- 여행 플래너 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번이면 끝.
--
-- 설계 요지: 로그인 없이 "공유 코드를 아는 사람만" 그 여행에 접근하게 한다.
--   · trips 테이블은 RLS 를 켜되 정책을 하나도 만들지 않는다 → anon 키로는 직접 접근 불가
--   · 대신 security definer 함수 3개만 anon 에 열어준다 → 코드를 정확히 알아야만 동작
--   · 따라서 anon 키가 노출돼도 전체 여행 목록을 긁어가거나 남의 여행을 지울 수 없다
--   · 반대로, 코드가 유출되면 그 여행은 누구나 편집할 수 있다(의도된 동작 — 링크 공유 방식)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.trips (
  code       text primary key,
  doc        jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trips enable row level security;
-- 정책을 만들지 않는다 = anon/authenticated 의 직접 접근은 전부 거부된다.
revoke all on table public.trips from anon, authenticated;

-- ── 조회 ─────────────────────────────────────────────────────
create or replace function public.trip_get(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select doc from public.trips where code = upper(p_code);
$$;

-- ── 생성 (코드 중복이면 false) ───────────────────────────────
create or replace function public.trip_create(p_code text, p_doc jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_code is null or length(p_code) < 4 then
    raise exception '코드가 너무 짧습니다';
  end if;
  insert into public.trips(code, doc)
  values (upper(p_code), coalesce(p_doc, '{}'::jsonb))
  on conflict (code) do nothing;
  return found;
end;
$$;

-- ── 저장 (문서 전체 덮어쓰기) ────────────────────────────────
create or replace function public.trip_save(p_code text, p_doc jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 문서가 통째로 비어 오는 사고를 막는 최소 방어선
  if p_doc is null or p_doc = '{}'::jsonb then
    raise exception '빈 문서는 저장하지 않습니다';
  end if;
  update public.trips
     set doc = p_doc, updated_at = now()
   where code = upper(p_code);
  return found;
end;
$$;

-- 함수 실행 권한만 열어준다
grant execute on function public.trip_get(text)            to anon, authenticated;
grant execute on function public.trip_create(text, jsonb)  to anon, authenticated;
grant execute on function public.trip_save(text, jsonb)    to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- (선택) 6개월 넘게 손대지 않은 여행 정리 — pg_cron 을 쓸 때만
-- select cron.schedule('trips-gc', '0 4 * * 0',
--   $$delete from public.trips where updated_at < now() - interval '180 days'$$);
-- ─────────────────────────────────────────────────────────────
