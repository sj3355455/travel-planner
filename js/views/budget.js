// 예산 탭 — 일정에 적은 예상 금액 + 일정 밖 비용(항공권·숙소 등)을 합쳐 총액을 낸다.
// 실제 지출을 입력하면 예상 대비 차액까지 같이 보여준다.
import { h, modal, input, select, field, toast, confirmDialog } from '../ui.js';
import {
  store, tripDays, catOf, CATEGORIES, toKRW, spentKRW, hasSpent, won, wonDiff, dayColor, peopleOf,
} from '../store.js';

export function renderBudget(root) {
  const meta = store.doc.meta;
  const days = tripDays(meta);
  const items = store.all('items');
  const extras = store.all('costs');
  const all = [...items, ...extras];

  const itemTotal = items.reduce((s, i) => s + toKRW(i, meta), 0);
  const extraTotal = extras.reduce((s, c) => s + toKRW(c, meta), 0);
  const total = itemTotal + extraTotal;
  const people = peopleOf(meta);

  const spentTotal = all.reduce((s, r) => s + spentKRW(r, meta), 0);
  const anySpent = all.some(hasSpent);
  // 실제 지출을 입력한 항목만 골라 "그 항목들의 예상액"과 비교해야 공정하다
  const spentPlanned = all.filter(hasSpent).reduce((s, r) => s + toKRW(r, meta), 0);
  const diff = spentTotal - spentPlanned;

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
    anySpent ? h('div.spent-row',
      h('div',
        h('span.muted.small', '실제 지출 '),
        h('strong', won(spentTotal)),
      ),
      h('span', {
        class: diff > 0 ? 'over' : diff < 0 ? 'under' : 'muted',
      }, diff === 0 ? '예상과 동일' : `예상 대비 ${wonDiff(diff)}`),
    ) : null,
  ));

  if (!anySpent) {
    root.append(h('p.muted.small', { style: { margin: '-6px 2px 16px' } },
      '💡 일정이나 비용을 열어 "실제 지출"을 넣으면 예산 대비 차액이 여기에 표시됩니다.'));
  }

  // ── 분류별 ──────────────────────────────────────────────
  const byCat = new Map();
  for (const r of all) {
    const k = r.cat || 'etc';
    byCat.set(k, (byCat.get(k) || 0) + toKRW(r, meta));
  }
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
    for (const c of [...extras].sort((a, b) => toKRW(b, meta) - toKRW(a, meta))) {
      const cat = catOf(c.cat);
      const est = toKRW(c, meta);
      box.append(h('div.line-row', { onclick: () => openCostEditor(c) },
        h('span.cat-dot', { style: { background: cat.color + '26', color: cat.color } }, cat.icon),
        h('div.grow',
          h('div', c.label || '(이름 없음)'),
          h('div.muted.small',
            c.perPerson ? `1인 ${won(toKRW(c, meta) / people)} × ${people}명` : null,
            c.perPerson && hasSpent(c) ? ' · ' : null,
            hasSpent(c) ? `실제 ${won(spentKRW(c, meta))}` : null,
          ),
        ),
        h('strong.money', won(est)),
      ));
    }
  }
  root.append(box);
}

function openCostEditor(existing) {
  const meta = store.doc.meta;
  const people = peopleOf(meta);
  const rec = existing || { cat: 'etc', cur: 'krw' };

  // 옛 레코드(perPerson 인데 ppRaw 없음)는 amount 가 이미 총액이라 1인당 값으로 되돌려 보여준다
  const legacyTotal = rec.perPerson && !rec.ppRaw;
  const asEntered = v => (v == null || v === '' ? '' : legacyTotal ? Number(v) / people : v);

  const fLabel = input({ value: rec.label || '', placeholder: '예: 왕복 항공권' });
  const fAmt = input({ type: 'number', inputmode: 'decimal', min: '0', value: asEntered(rec.amount), placeholder: '0' });
  const fSpent = input({ type: 'number', inputmode: 'decimal', min: '0', value: asEntered(rec.spent), placeholder: '아직 안 씀' });
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
      if (await confirmDialog('비용 삭제', `"${rec.label}"을(를) 삭제할까요?`)) {
        const undo = store.del('costs', rec.id);
        toast('삭제했습니다', { label: '실행취소', onClick: undo });
      }
    }, 200),
  });
  actions.push({ label: '취소' });
  actions.push({
    label: '저장', primary: true,
    onClick: () => {
      if (!fLabel.value.trim()) { toast('항목 이름을 입력하세요'); return false; }
      store.put('costs', {
        id: rec.id,
        label: fLabel.value.trim(),
        // 입력값을 그대로 저장한다. 인원 곱하기는 표시할 때만(store.toKRW).
        amount: Number(fAmt.value || 0),
        spent: fSpent.value === '' ? null : Number(fSpent.value),
        cur: fCur.value,
        cat: fCat.value,
        perPerson: fPer.checked,
        ppRaw: true,
      });
      toast('저장했습니다');
    },
  });

  modal({
    title: existing ? '비용 편집' : '비용 추가',
    body: h('div.form',
      field('항목', fLabel),
      h('div.row2', field('예상 금액', fAmt), field('통화', fCur)),
      field('실제 지출', fSpent, '실제로 결제한 금액'),
      field('분류', fCat),
      h('label.check-inline', fPer, h('span', `1인 기준 금액으로 입력 (× ${people}명으로 합산)`)),
    ),
    actions,
  });
}
