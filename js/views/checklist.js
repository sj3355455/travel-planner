// 준비물 탭 — 그룹으로 묶인 체크리스트
import { h, toast, confirmDialog, input } from '../ui.js';
import { store, uid } from '../store.js';

const DEFAULT_GROUPS = ['필수', '의류', '전자기기', '세면·화장', '기타'];

const TEMPLATE = {
  '필수': ['여권', '항공권(모바일)', '숙소 예약 확인서', '여행자보험', '현금 환전', '해외결제 카드', '유심/이심'],
  '의류': ['상의', '하의', '속옷', '양말', '겉옷', '잠옷', '신발', '우산/우비'],
  '전자기기': ['휴대폰 충전기', '보조배터리', '멀티 어댑터', '이어폰', '카메라'],
  '세면·화장': ['칫솔·치약', '샴푸·바디워시', '선크림', '스킨케어', '수건'],
  '기타': ['상비약', '물티슈', '지퍼백', '에코백'],
};

export function renderChecklist(root) {
  const checks = store.all('checks');
  const done = checks.filter(c => c.done).length;

  // ── 진행률 ──────────────────────────────────────────────
  root.append(h('div.progress-card',
    h('div.progress-head',
      h('strong', `준비물 ${done} / ${checks.length}`),
      h('span.muted.small', checks.length ? Math.round(done / checks.length * 100) + '%' : ''),
    ),
    h('div.bar-track', h('div.bar-fill', {
      style: { width: (checks.length ? done / checks.length * 100 : 0) + '%', background: '#5ad1a5' },
    })),
  ));

  // ── 빠른 추가 ───────────────────────────────────────────
  const quick = input({ placeholder: '준비물 입력 후 Enter' });
  const groupSel = h('select.inp.narrow');
  const groups = [...new Set([...DEFAULT_GROUPS, ...checks.map(c => c.group).filter(Boolean)])];
  for (const g of groups) groupSel.append(h('option', { value: g }, g));

  const add = () => {
    const text = quick.value.trim();
    if (!text) return;
    // 쉼표로 여러 개를 한 번에
    for (const t of text.split(',').map(s => s.trim()).filter(Boolean)) {
      store.put('checks', { group: groupSel.value, text: t, done: false });
    }
    quick.value = '';
    setTimeout(() => document.querySelector('.quick-add .inp')?.focus(), 30);
  };
  quick.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });

  root.append(h('div.quick-add', groupSel, quick, h('button.btn.primary.small', { onclick: add }, '추가')));

  if (!checks.length) {
    root.append(h('div.empty',
      h('strong', '체크리스트가 비어 있습니다'),
      h('p.muted', '위에서 직접 추가하거나, 기본 준비물 목록을 한 번에 불러오세요.'),
      h('button.btn.primary', { onclick: loadTemplate }, '기본 준비물 불러오기'),
    ));
    return;
  }

  // ── 그룹별 목록 ─────────────────────────────────────────
  const byGroup = new Map();
  for (const c of checks) {
    const g = c.group || '기타';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(c);
  }
  const order = g => { const i = DEFAULT_GROUPS.indexOf(g); return i === -1 ? 99 : i; };

  for (const [g, list] of [...byGroup.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))) {
    const gd = list.filter(c => c.done).length;
    const box = h('div.section',
      h('div.section-title', g, h('span.muted.small', ` ${gd}/${list.length}`)),
    );
    list.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    for (const c of list) box.append(checkRow(c));
    root.append(box);
  }

  root.append(h('div.foot-actions',
    h('button.linkbtn', { onclick: loadTemplate }, '기본 준비물 추가'),
    h('button.linkbtn.danger', {
      onclick: async () => {
        if (!checks.some(c => c.done)) { toast('체크된 항목이 없습니다'); return; }
        if (await confirmDialog('완료 항목 정리', '체크된 항목을 모두 지울까요?', '지우기')) {
          store.update(d => { for (const c of Object.values(d.checks)) if (!c.del && c.done) { d.checks[c.id] = { id: c.id, del: true, mt: Date.now() }; } });
          toast('정리했습니다');
        }
      },
    }, '체크된 항목 지우기'),
  ));
}

function checkRow(c) {
  const box = h('input', {
    type: 'checkbox', checked: !!c.done,
    onchange: e => store.put('checks', { id: c.id, done: e.target.checked }),
    onclick: e => e.stopPropagation(),
  });
  return h('label', { class: 'check-row' + (c.done ? ' done' : '') },
    box,
    h('span.grow', c.text),
    h('button.x', {
      onclick: e => { e.preventDefault(); e.stopPropagation(); store.del('checks', c.id); },
    }, '✕'),
  );
}

function loadTemplate() {
  const existing = new Set(store.all('checks').map(c => (c.group || '') + '|' + c.text));
  let n = 0;
  store.update(d => {
    for (const [group, list] of Object.entries(TEMPLATE)) {
      for (const text of list) {
        if (existing.has(group + '|' + text)) continue;
        const id = uid();
        d.checks[id] = { id, group, text, done: false, mt: Date.now() };
        n++;
      }
    }
  });
  toast(n ? `${n}개를 추가했습니다` : '이미 모두 들어 있습니다');
}
