// PWA 설치 — 플랫폼 판별, 설치 프롬프트, 그리고 휴대폰 전용 "설치 안내 화면".
//
// 방침: 휴대폰에서는 웹으로 쓰지 않고 앱으로 설치해서 쓰게 한다.
// 따라서 폰 + 미설치 상태로 접속하면 앱 UI 대신 설치 화면만 보여준다(게이트).
// 단 인앱 브라우저(카카오톡·인스타 등)는 설치 자체가 불가능하므로 예외를 둔다.
import { h, modal } from './ui.js';
import { setLastTripCode } from './store.js';

const ua = navigator.userAgent;

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  matchMedia('(display-mode: minimal-ui)').matches ||
  navigator.standalone === true;

export const isIOS = () =>
  /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export const isFirefox = () => /Firefox/i.test(ua);

/** 휴대폰·태블릿인가 (데스크톱은 게이트 대상이 아니다) */
export const isMobile = () =>
  /Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
  (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

/**
 * 앱 안에 박혀 있는 브라우저(카카오톡·인스타·페북·라인·네이버 등).
 * 여기서는 "홈 화면에 추가"도 없고 beforeinstallprompt 도 안 뜬다 → 설치가 물리적으로 불가능.
 */
export const isInAppBrowser = () =>
  /KAKAOTALK|kakaostory|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER\(inapp|DaumApps|everytimeApp|wv\)|; wv/i.test(ua);

// ── 설치 프롬프트 ──────────────────────────────────────────
let installPrompt = null;
const listeners = new Set();

// 이 모듈이 로드되는 즉시 잡아야 이벤트를 놓치지 않는다
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();          // 브라우저 기본 배너 대신 우리 UI 를 쓴다
  installPrompt = e;
  listeners.forEach(fn => fn());
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  listeners.forEach(fn => fn());
});

export const hasPrompt = () => Boolean(installPrompt);
export const onInstallChange = fn => listeners.add(fn);

/** 설치 실행. 프롬프트가 없으면 false 를 돌려주고 호출부가 안내를 띄운다. */
export async function runInstall() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  listeners.forEach(fn => fn());
  return outcome === 'accepted';
}

/** 플랫폼별 수동 설치 절차 */
export function installSteps() {
  if (isInAppBrowser()) {
    return [
      '오른쪽 위 <b>⋮ / 공유 버튼</b>을 누릅니다.',
      '<b>“다른 브라우저로 열기”</b>(사파리 · 크롬)를 선택합니다.',
      '열린 브라우저에서 설치하면 됩니다.',
    ];
  }
  if (isIOS()) {
    return [
      '화면 아래쪽 <b>공유 버튼</b>(⬆︎ 네모)을 누릅니다.',
      '메뉴를 내려서 <b>“홈 화면에 추가”</b>를 누릅니다.',
      '오른쪽 위 <b>“추가”</b>를 누르면 끝입니다.',
    ];
  }
  if (isFirefox()) {
    return ['주소창 오른쪽 <b>⋮ 메뉴</b>를 엽니다.', '<b>“설치”</b> 또는 <b>“홈 화면에 추가”</b>를 누릅니다.'];
  }
  return [
    '주소창 오른쪽 <b>⋮ 메뉴</b>를 누릅니다.',
    '<b>“앱 설치”</b> 또는 <b>“홈 화면에 추가”</b>를 누릅니다.',
  ];
}

/** 데스크톱에서 📲 버튼을 눌렀는데 프롬프트가 없을 때의 안내 모달 */
export function showInstallHelp() {
  modal({
    title: '앱으로 설치하기',
    body: h('div.form',
      h('p.muted.small', '설치하면 주소창 없이 앱처럼 실행되고, 홈 화면·시작 메뉴에서 바로 열 수 있습니다. 오프라인에서도 열립니다.'),
      h('ol.help-steps', ...installSteps().map(s => h('li', { html: s }))),
      isIOS() ? h('p.muted.small', '※ iOS 는 <b>사파리</b>에서만 설치할 수 있습니다.') : null,
    ),
    actions: [{ label: '닫기', primary: true }],
  });
}

// ── 휴대폰 설치 게이트 ─────────────────────────────────────
/**
 * 앱 UI 대신 설치 화면을 보여줘야 하는가.
 * ?web=1 을 붙이면 우회할 수 있다(디버깅·예외 상황용).
 */
export function shouldGate() {
  if (new URLSearchParams(location.search).has('web')) return false;
  if (new URLSearchParams(location.search).has('gate')) return true;   // 데스크톱에서 미리보기용
  return isMobile() && !isStandalone();
}

/**
 * 설치 화면을 그린다. 앱 UI 는 CSS(body.gated)로 감춘다.
 * 공유 링크(#trip=코드)로 들어온 경우 코드를 저장해 두어, 설치 후 앱을 열면
 * 그 여행이 바로 열리게 한다 — 설치 과정에서 URL 해시가 사라지기 때문.
 */
export function renderGate() {
  const code = new URLSearchParams(location.hash.slice(1)).get('trip');
  if (code) setLastTripCode(code);

  document.body.classList.add('gated');

  const inApp = isInAppBrowser();
  const canPrompt = hasPrompt();

  const primaryBtn = h('button.btn.primary.gate-cta', {
    onclick: async () => {
      if (await runInstall()) return;      // 설치 진행되면 appinstalled 가 이어받는다
      stepsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }, '📲 앱 설치하기');

  const stepsBox = h('div.gate-steps',
    h('div.gate-steps-title', inApp ? '먼저 브라우저로 열어주세요' : '설치 방법'),
    h('ol.help-steps', ...installSteps().map(s => h('li', { html: s }))),
  );

  const gate = h('div.gate',
    h('img.gate-icon', { src: 'icon-192.png', alt: '', width: 96, height: 96 }),
    h('h1.gate-title', '여행 플래너'),
    h('p.gate-sub', { html: '휴대폰에서는 <b>앱으로 설치해서</b> 사용해 주세요.<br>설치는 몇 초면 끝납니다.' }),

    h('ul.gate-feats',
      h('li', '🏠 홈 화면에서 바로 실행'),
      h('li', '📱 주소창 없는 전체 화면'),
      h('li', '✈️ 비행기 모드·해외에서도 열림'),
    ),

    code ? h('div.gate-note', `설치 후 앱을 열면 공유받은 여행(${code})이 바로 열립니다.`) : null,

    // 설치 프롬프트를 띄울 수 있을 때만 버튼이 의미가 있다
    canPrompt && !inApp ? primaryBtn : null,
    stepsBox,

    // 인앱 브라우저는 설치가 불가능하므로 웹으로 볼 길을 열어준다.
    // 그러지 않으면 공유 링크를 받은 사람이 아무것도 못 보고 갇힌다.
    inApp ? h('a.gate-escape', { href: addWebParam() }, '설치가 어려우면 → 이대로 웹에서 보기') : null,
  );

  document.body.append(gate);

  // 설치 프롬프트가 늦게 도착하면 버튼을 그때 끼워 넣는다
  onInstallChange(() => {
    if (isStandalone()) { location.reload(); return; }
    if (hasPrompt() && !gate.contains(primaryBtn) && !inApp) stepsBox.before(primaryBtn);
  });
}

/** 현재 URL 에 ?web=1 을 붙인 주소 (해시 유지) */
function addWebParam() {
  const u = new URL(location.href);
  u.searchParams.set('web', '1');
  return u.toString();
}
