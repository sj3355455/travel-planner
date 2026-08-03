-- ─────────────────────────────────────────────────────────────
-- 여행 플래너 — 계정(로그인) 추가분
-- schema.sql 을 먼저 돌린 뒤, 이 파일을 SQL Editor 에 붙여넣고 Run.
--
-- 하는 일: 로그인한 사람의 "내 여행 목록"을 서버에 둔다.
--   · 여행 내용(trips)은 그대로 공유 코드로 접근한다 — 로그인 없이도 링크 공유가 계속 된다
--   · user_trips 는 "누가 어떤 코드를 갖고 있는지"만 기억한다
--   · 그래서 다른 기기에서 로그인하면 여행 목록이 그대로 따라온다
--
-- ⚠️ 먼저 대시보드에서 이메일 확인을 꺼야 한다:
--   Authentication → Sign In / Providers → Email → "Confirm email" 을 OFF
--   이 앱은 이메일이 아니라 아이디로 가입하므로(내부적으로 아이디@travel-planner.app),
--   확인 메일을 받을 주소가 없다. 켜져 있으면 가입은 되는데 로그인이 안 된다.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.user_trips (
  user_id   uuid        not null references auth.users(id) on delete cascade,
  code      text        not null,
  title     text        not null default '',
  opened_at timestamptz not null default now(),
  primary key (user_id, code)
);

create index if not exists user_trips_user_idx on public.user_trips (user_id, opened_at desc);

alter table public.user_trips enable row level security;

-- 자기 행만 읽고 쓸 수 있다. auth.uid() 는 로그인한 사용자의 id.
drop policy if exists "user_trips 내 것만 조회" on public.user_trips;
create policy "user_trips 내 것만 조회"
  on public.user_trips for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_trips 내 것만 추가" on public.user_trips;
create policy "user_trips 내 것만 추가"
  on public.user_trips for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_trips 내 것만 수정" on public.user_trips;
create policy "user_trips 내 것만 수정"
  on public.user_trips for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_trips 내 것만 삭제" on public.user_trips;
create policy "user_trips 내 것만 삭제"
  on public.user_trips for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.user_trips to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 확인용: 아래를 실행해 정책 4개가 보이면 정상
--   select policyname, cmd from pg_policies where tablename = 'user_trips';
-- ─────────────────────────────────────────────────────────────
