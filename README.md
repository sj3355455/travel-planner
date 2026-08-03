# 여행 플래너

일정 · 시간표 · 지도 · 예산 · 준비물을 한 곳에서 관리하는 여행 계획 PWA.
컴퓨터와 폰에서 같이 쓰고, 공유 코드 하나로 일행과 함께 편집한다.

## 기능

| 탭 | 하는 일 |
|---|---|
| 🗓 **일정** | 일차별로 시간·장소·분류·예상금액·메모를 넣어 일정 구성 |
| 📊 **시간표** | 일차를 열, 시각을 행으로 놓은 시간표 자동 생성 (겹치는 일정은 나란히 배치) |
| 🗺 **지도** | 좌표가 있는 일정을 일차별 색상 핀으로 표시, 방문 순서를 점선으로 연결 |
| 💰 **예산** | 일정 비용 + 일정 밖 비용(항공권·숙소)을 합산, 분류별/일차별/1인당 집계 |
| ✅ **준비물** | 그룹별 체크리스트, 진행률, 기본 준비물 템플릿 |

- **장소 검색**: OpenStreetMap Nominatim (무료, 키 불필요)
- **지도**: Leaflet + OSM 타일 (무료, 키 불필요)
- **길찾기는 없음** — 유료 API가 필요해 뺐다. 대신 각 핀에서 구글맵·네이버지도 링크로 넘어간다.
- **환율**: 설정에 현지 통화와 환율을 넣으면 금액을 통화별로 입력하고 원화로 합산한다.
- **오프라인**: 서비스 워커가 앱을 캐시하고, 편집 내용은 localStorage에 먼저 저장된다. 온라인이 되면 자동으로 밀어올린다.

## 지금 바로 써보기

```bash
cd "C:\Users\1seoj\Documents\travel-planner" && python -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속. (`file://` 로 직접 열면 ES 모듈이 막혀서 동작하지 않는다.)

이 상태에서는 **Supabase 미설정 = 이 브라우저에만 저장**된다. 기기 간 공유는 아래 설정을 마쳐야 켜진다.

## Supabase 연결 (기기·일행 간 동기화)

**이미 연결 완료됨** — 프로젝트 `cxchfovxtrkveaihumbx`, `js/config.js`에 값이 들어가 있다.
다른 프로젝트로 옮길 때만 아래 절차를 다시 밟으면 된다.

1. [supabase.com](https://supabase.com)에서 프로젝트 생성 (무료 티어로 충분)
2. **SQL Editor** → [`schema.sql`](schema.sql) 전체를 붙여넣고 Run
3. **Project Settings → API** 에서 `Project URL` 과 **Publishable key**(예전 이름: anon public) 복사
4. [`js/config.js`](js/config.js) 의 `SB_URL`, `SB_KEY` 에 붙여넣기
5. 새로고침 → 상단 바 점이 초록색이면 연결됨

### 여행 삭제

앱에는 여행 자체를 지우는 기능이 없다(실수로 일행 것까지 날리는 걸 막으려고). 정말 지울 때는 SQL Editor에서:

```sql
delete from public.trips where code = 'ABCD-2345';
```

### 동기화 방식

- 여행마다 `ABCD-2345` 형태의 **공유 코드**가 생긴다. 코드나 링크(`#trip=코드`)를 받은 사람은 같은 여행을 함께 편집한다.
- 변경은 로컬에 즉시 저장하고 0.7초 뒤 서버로 올린다. 화면이 켜져 있는 동안 4초마다 원격 변경을 당겨온다 (`js/config.js` 에서 조정).
- 병합은 **항목 단위 최종수정시각(mt) 비교**다. 두 사람이 각각 다른 일정을 고치면 양쪽 다 살아남고, 같은 항목의 같은 필드를 동시에 고친 경우에만 나중 값이 이긴다.
- 삭제는 30일짜리 삭제 표식(tombstone)으로 처리해, 오프라인이던 기기가 돌아왔을 때 지운 항목이 되살아나지 않는다.

### 보안 모델

`trips` 테이블은 RLS를 켜고 **정책을 하나도 두지 않는다**. anon 키로는 테이블에 직접 접근할 수 없고, `schema.sql` 이 만드는 `trip_get` / `trip_create` / `trip_save` 함수 3개만 호출할 수 있다. 세 함수 모두 공유 코드를 인자로 받으므로:

- ✅ anon 키가 노출돼도 전체 여행 목록을 긁어가거나 남의 여행을 지울 수 없다
- ⚠️ 공유 코드가 유출되면 그 여행 하나는 누구나 편집할 수 있다 — 링크 공유 방식의 의도된 동작이다

## 배포 (GitHub Pages)

당동 앱과 같은 방식이다.

```bash
git init && git add -A && git commit -m "여행 플래너 초안"
```

리포를 만들어 push하고 Settings → Pages 에서 source를 `main`/`root` 로 두면 끝.
**패치를 낼 때는 `sw.js` 의 `const VERSION` 한 줄만 올리면** 설치된 전 기기가 자동으로 새로고침된다.

> `js/config.js` 에 anon 키가 들어간 채로 커밋된다. anon 키는 브라우저에 노출되는 게 정상이고 실제 통제는 위의 RLS + 함수 구조가 하므로 공개 리포여도 문제없다. 그래도 리포를 private으로 두고 싶으면 GitHub Pages는 유료 플랜이 필요하다.

## 파일 구조

```
index.html          앱 셸 (상단바 / 본문 / 하단 탭)
styles.css          다크 테마, 모바일 우선 + 860px 이상에서 사이드바 레이아웃
sw.js               서비스 워커 — VERSION 한 줄로 배포
schema.sql          Supabase 테이블 + 함수 + 권한
js/
  config.js         Supabase URL/키, 동기화 주기        ← 여기만 채우면 됨
  supabase.js       RPC 3종 래퍼
  store.js          문서 모델 · mt 기반 병합 · 동기화 엔진 · 날짜/금액 유틸
  ui.js             h() / 모달 / 토스트 헬퍼 (프레임워크 없음)
  geo.js            Nominatim 장소 검색, 외부 지도 링크
  itemEditor.js     일정 추가·편집 시트 (장소 검색 포함)
  views/
    plan.js         일정 탭
    timetable.js    시간표 탭 (레인 배치 알고리즘 포함)
    map.js          지도 탭 (Leaflet)
    budget.js       예산 탭
    checklist.js    준비물 탭
```

## 앞으로 붙일 만한 것

- 일정 드래그로 순서·시간 조정
- 실제 지출 입력 후 예산 대비 비교
- 이동 시간 자동 계산 (유료 라우팅 API 필요)
- 사진·영수증 첨부 (Supabase Storage)
- 여행 노트를 Obsidian 마크다운으로 내보내기
