// 작은 DOM / 모달 / 토스트 헬퍼 — 프레임워크 없이 쓰기 위한 최소 도구
export function h(tag, attrs, ...kids) {
  // 두 번째 인자를 생략하고 바로 자식을 넘길 수 있게 한다: h('strong', '제목'), h('div', el)
  if (attrs != null && (attrs instanceof Node || Array.isArray(attrs) || typeof attrs !== 'object')) {
    kids.unshift(attrs);
    attrs = {};
  }
  // 'div#leafmap.mapbox' 처럼 태그·id·클래스를 한 문자열로 받는다
  const [head, ...classes] = tag.split('.');
  const [name, id] = head.split('#');
  const e = document.createElement(name || 'div');
  if (id) e.id = id;
  if (classes.length) e.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className += (e.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && k !== 'list' && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export const $ = sel => document.querySelector(sel);

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/**
 * 시트형 모달. body 는 HTMLElement, actions 는 [{label, primary, danger, onClick}].
 * onClick 이 false 를 반환하면 닫히지 않는다(검증 실패 시 사용).
 */
export function modal({ title, body, actions = [], onClose }) {
  const root = $('#modalRoot');
  const close = () => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 180); onClose && onClose(); };

  const btns = actions.map(a => h('button', {
    class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
    onclick: () => { if (a.onClick && a.onClick() === false) return; close(); },
  }, a.label));

  const wrap = h('div.modal-wrap', { onclick: e => { if (e.target === wrap) close(); } },
    h('div.modal',
      h('div.modal-head', h('strong', title), h('button.icon-btn', { onclick: close }, '✕')),
      h('div.modal-body', body),
      btns.length ? h('div.modal-foot', ...btns) : null,
    ),
  );
  root.append(wrap);
  setTimeout(() => wrap.classList.add('in'), 0);   // rAF 는 탭이 숨겨져 있으면 안 돌아 setTimeout 사용
  return { close, el: wrap };
}

export function confirmDialog(title, message, confirmLabel = '삭제') {
  return new Promise(resolve => {
    let done = false;
    modal({
      title,
      body: h('p.muted', message),
      actions: [
        { label: '취소', onClick: () => { done = true; resolve(false); } },
        { label: confirmLabel, danger: true, onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/** label + input 한 줄 */
export function field(label, input, hint) {
  return h('label.field', {}, h('span.field-label', label), input, hint ? h('span.field-hint', hint) : null);
}

export function input(attrs = {}) { return h('input.inp', { type: 'text', ...attrs }); }
export function select(options, value, attrs = {}) {
  const s = h('select.inp', attrs);
  for (const o of options) s.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  return s;
}
