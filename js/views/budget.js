// 예산 탭 — 일정에 적은 예상 금액 + 일정 밖 비용(항공권·숙소 등)을 합쳐 총액을 낸다
import { h, modal, input, select, field, toast, confirmDialog } from '../ui.js';
import { store, tripDays, catOf, CATEGORIES, toKRW, won, dayColor } from '../store.js';

export function renderBudget(root) {
  const meta = store.doc.meta;
  const days = tripDays(meta);
  const items = store.all('items');
  const extras = store.all('costs');

  const itemTotal = items.reduce((s, i) => s + toKRW(i, meta), 0);
  const extraTotal = extras.reduce((s, c) => s + toKRW(c, meta), 0);
  const total = itemTotal + extraTotal;
  const people = Math.max(1, Number(meta.people) || 1);

  // ── 총액 카드 ───────────────────────────────────────────
  root.append(h('div.total-card',
    h('span.muted.small', '예상 총 비용'),
    h('div.total-num', won(total)),
    h('div.total-sub',
      h('span', `1인당 ${won(total / people)}`),
      h('span.muted', ` · ${people}명`),
      meta.curLabel && Number(meta.curRate) > 0
        ? h('span.muted', ` · ${Math.round(total / Number(meta.curRate)).toLocaleString()} ${meta.curLabel}`)
        : null,
    ),
    h('div.total-split',
      h('span', `일정 ${won(itemTotal)}`),
      h('span', `기타 ${won(extraTotal)}`),
    ),
  ));

  // ── 분류별 ──────────────────────────────────────────────
  const byCat = new Map();
  for (const i of items) byCat.set(i.cat || 'etc', (byCat.get(i.cat || 'etc') || 0) + toKRW(i, meta));
  for (const c of extras) byCat.set(c.cat || 'etc', (byCat.get(c.cat || 'etc') || 0) + toKRW(c, meta));
  const catRows = [...byCat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  if (catRows.length) {
    const max = catRows[0][1];
    const box = h('div.section', h('div.section-title', '분류별'));
    for (const [cid, v] of catRows) {
      const c = catOf(cid);
      box.append(h('div.bar-row',
        h('span.bar-label', `${c.icon} ${c.label}`),
        h('div.bar-track', h('div.bar-fill', { style: { width: (v / max * 100) + '%', background: c.color } })),
        h('span.bar-val', won(v)),
      ));
    }
    root.append(box);
  }

  // ── 일차별 ──────────────────────────────────────────────
  if (days.length) {
    const dayTotals = days.map(d => items.filter(i => (i.day || 0) === d.index).reduce((s, i) => s + toKRW(i, meta), 0));
    const max = Math.max(1, ...dayTotals);
    const box = h('div.section', h('div.section-title', '일차별 (일정 비용만)'));
    days.forEach(d => {
      const v = dayTotals[d.index];
      box.append(h('div.bar-row',
        h('span.bar-label', h('strong', d.label), h('span.muted.small', ' ' + d.sub)),
        h('div.bar-track', h('div.bar-fill', { style: { width: (v / max * 100) + '%', background: dayColor(d.index) } })),
        h('span.bar-val', v ? won(v) : '–'),
      ));
    });
    root.append(box);
  }

  // ── 기타 비용 ───────────────────────────────────────────
  const box = h('div.section',
    h('div.section-title', '일정 밖 비용', h('button.linkbtn', { onclick: () => openCostEditor(null) }, '+ 추가')),
  );
  if (!extras.length) {
    box.append(h('p.muted.small', '항공권, 숙소, 환전 수수료처럼 특정 일정에 붙지 않는 비용을 여기에 넣으세요.'));
  } else {
    for (const c of extras.sort((a, b) => toKRW(b, meta) - toKRW(a, meta))) {
      const cat = catOf(c.cat);
      box.append(h('div.line-row', { onclick: () => openCostEditor(c) },
        h('span.cat-dot', { style: { background: cat.color } }, cat.icon),
        h('span.grow', c.label || '(이름 없음)'),
        h('strong', won(toKRW(c, meta))),
      ));
    }
  }
  root.append(box);
}

function openCostEditor(existing) {
  const meta = store.doc.meta;
  const rec = existing || { cat: 'etc', cur: 'krw' };
  const fLabel = input({ value: rec.label || '', placeholder: '예: 왕복 항공권' });
  const fAmt = input({ type: 'number', inputmode: 'decimal', min: '0', value: rec.amount ?? '', placeholder: '0' });
  const fCur = select(
    [{ value: 'krw', label: '원' }, ...(meta.curLabel ? [{ value: 'loc', label: meta.curLabel }] : [])],
    rec.cur || 'krw',
  );
  const fCat = select(CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` })), rec.cat || 'etc');
  const fPer = h('input', { type: 'checkbox', checked: !!rec.perPerson });

  const actions = [];
  if (existing) actions.push({
    label: '삭제', danger: true,
    onClick: () => setTimeout(async () => {
      if (await confirmDialog('비용 삭제', `"${rec.label}"을(를) 삭제할까요?`)) { store.del('costs', rec.id); toast('삭제했습니다'); }
    }, 200),
  });
  actions.push({ label: '취소' });
  actions.push({
    label: '저장', primary: true,
    onClick: () => {
      if (!fLabel.value.trim()) { toast('항목 이름을 입력하세요'); return false; }
      const people = Math.max(1, Number(meta.people) || 1);
      const raw = Number(fAmt.value || 0);
      store.put('costs', {
        id: rec.id,
        label: fLabel.value.trim(),
        amount: fPer.checked ? raw * people : raw,
        cur: fCur.value,
        cat: fCat.value,
        perPerson: fPer.checked,
      });
      toast('저장했습니다');
    },
  });

  modal({
    title: existing ? '비용 편집' : '비용 추가',
    body: h('div.form',
      field('항목', fLabel),
      h('div.row2', field('금액', fAmt), field('통화', fCur)),
      field('분류', fCat),
      h('label.check-inline', fPer, h('span', `1인 기준 금액으로 입력 (× ${Math.max(1, Number(meta.people) || 1)}명)`)),
    ),
    actions,
  });
}
