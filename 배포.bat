@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ─────────────────────────────────────────────────────────────
REM  트래블 플래너 배포 스크립트
REM
REM  하는 일 3가지:
REM   1) sw.js 의 VERSION 을 자동으로 +1 (v10 → v11)
REM      → 설치된 전 기기가 다음 실행 때 자동으로 새 버전을 받고 1회 새로고침된다
REM   2) 전체 변경을 커밋
REM   3) 현재 브랜치를 origin 으로 push → GitHub Pages 가 반영
REM
REM  사용법:  그냥 더블클릭     (커밋 메시지는 날짜로 자동)
REM           배포.bat "메모 기능 수정"   (메시지 직접 지정)
REM ─────────────────────────────────────────────────────────────

echo.
echo   ── 트래블 플래너 배포 ──
echo.

REM ── git 사용 가능한지 / 리포 안인지 확인 ─────────────────────
where git >nul 2>nul
if errorlevel 1 (
  echo   [중단] git 을 찾을 수 없습니다. Git for Windows 를 설치하세요.
  goto :end
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo   [중단] 여기는 git 저장소가 아닙니다: %CD%
  goto :end
)

REM ── 바뀐 게 있는지 확인 (없으면 버전도 올리지 않는다) ────────
set "DIRTY="
for /f "delims=" %%s in ('git status --porcelain') do set "DIRTY=1"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"

REM 커밋은 됐는데 push 가 안 된 게 남아 있는지 (지난번 push 실패 등)
set "AHEAD=0"
for /f "delims=" %%a in ('git rev-list --count @{u}..HEAD 2^>nul') do set "AHEAD=%%a"

if not defined DIRTY (
  if "!AHEAD!"=="0" (
    echo   바뀐 파일이 없습니다. 배포할 것이 없어요.
    goto :end
  )
  echo   바뀐 파일은 없지만, push 안 된 커밋이 !AHEAD!개 있습니다.
  echo   ^(지난번에 push 가 실패했을 때 이렇게 됩니다^)
  echo.
  choice /c YN /n /m "  push 만 다시 할까요? (Y/N) "
  if errorlevel 2 (
    echo   취소했습니다.
    goto :end
  )
  echo.
  git push origin HEAD
  if errorlevel 1 goto :pushfail
  echo   push 완료 ^(origin/!BRANCH!^)
  goto :end
)

echo   브랜치: !BRANCH!
echo   바뀐 파일:
git -c core.quotepath=false status --short
echo.

choice /c YN /n /m "  이대로 배포할까요? (Y/N) "
if errorlevel 2 (
  echo   취소했습니다.
  goto :end
)
echo.

REM ── 1) sw.js VERSION 올리기 ──────────────────────────────────
set "NEWVER="
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "$f='%~dp0sw.js'; $t=[IO.File]::ReadAllText($f); if($t -match 'VERSION = ''v(\d+)'''){ $n=[int]$Matches[1]+1; [IO.File]::WriteAllText($f, ($t -replace 'VERSION = ''v\d+''', ('VERSION = ''v'+$n+''''))); Write-Output $n } else { Write-Output ERR }"`) do set "NEWVER=%%v"

if "!NEWVER!"=="" (
  echo   [중단] sw.js 버전을 읽지 못했습니다.
  goto :end
)
if "!NEWVER!"=="ERR" (
  echo   [중단] sw.js 에서 "const VERSION = 'v숫자'" 줄을 찾지 못했습니다.
  goto :end
)
echo   [1/3] 캐시 버전 → v!NEWVER!

REM ── 2) 커밋 ──────────────────────────────────────────────────
set "MSG=%~1"
if "!MSG!"=="" set "MSG=배포 v!NEWVER! (%DATE%)"

git add -A
if errorlevel 1 goto :fail
git commit -m "!MSG!" >nul
if errorlevel 1 goto :fail
echo   [2/3] 커밋 완료 — !MSG!

REM ── 3) push ──────────────────────────────────────────────────
git push origin HEAD
if errorlevel 1 goto :pushfail
echo   [3/3] push 완료 (origin/!BRANCH!)
echo.
echo   배포했습니다. GitHub Pages 반영에 1~2분 걸립니다.
echo   기기에서 앱을 열면 새 버전을 받고 한 번 자동 새로고침됩니다.
goto :end

:pushfail
echo.
echo   [실패] push 를 못 했습니다. 위 오류 메시지를 확인하세요.
echo   커밋은 이미 끝났으니, 인터넷/로그인을 확인한 뒤 다시 실행하면
echo   push 만 이어서 진행합니다.
goto :end

:fail
echo.
echo   [실패] 위 오류 메시지를 확인하세요.
echo   sw.js 버전은 이미 올라간 상태라, 고친 뒤 다시 실행하면 됩니다.

:end
echo.
pause
endlocal
