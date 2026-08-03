// 여행 전체를 Obsidian 마크다운 노트로 뽑아낸다.
// Vault 의 기존 여행 노트(대만 여행 일정.md)와 같은 모양 — callout + 일차별 표 + 체크리스트.
import { store, tripDays, catOf, toKRW, spentKRW, hasSpent, won, dayNoteId } from './store.js';

export function tripToMarkdown() {
  const meta = store.doc.meta;
  const days = tripDays(meta);
  const items = store.all('items');
  const checks = store.all('checks');
  const costs = store.all('costs');
  const notes = store.doc.notes || {};
  const people = Math.max(1, Number(meta.people) || 1);

  const L = [];
  L.push(`# ✈️ ${meta.title || '여행'}`, '');

  // ── 개요 callout ────────────────────────────────────────
  L.push('> [!info] 여행 개요');
  if (meta.start) {
    const nights = Math.max(0, days.length - 1);
    L.push(`> - **기간**: ${meta.start} ~ ${meta.end || meta.start} · ${nights}박 ${days.length}일`);
  }
  L.push(`> - **인원**: ${people}명`);
  if (meta.curLabel && Number(meta.curRate) > 0) {
    L.push(`> - **환율**: 1 ${meta.curLabel} ≈ ${meta.curRate}원`);
  }
  const total = [...items, ...costs].reduce((s, r) => s + toKRW(r, meta), 0);
  L.push(`> - **예상 총 비용**: ${won(total)} (1인당 ${won(total / people)})`);
  if (store.code) L.push(`> - **공유 코드**: \`${store.code}\``);
  L.push('');

  // ── 일차별 표 ───────────────────────────────────────────
  for (const d of days) {
    const list = items.filter(i => (i.day || 0) === d.index)
      .sort((a, b) => (a.start || '99:99') < (b.start || '99:99') ? -1 : 1);

    L.push('---', '', `## 📅 ${d.label} · ${d.sub}`, '');

    const note = notes[dayNoteId(d.index)];
    if (note && !note.del && note.text) {
      L.push(`> [!note] 메모`, ...note.text.split('\n').map(x => '> ' + x), '');
    }

    if (!list.length) {
      L.push('_일정 없음_', '');
      continue;
    }

    L.push('| 시간 | 일정 | 장소 | 예상 |', '|:--:|:--|:--|--:|');
    for (const it of list) {
      const time = it.start ? (it.end ? `${it.start}–${it.end}` : it.start) : '';
      const c = catOf(it.cat);
      const place = it.placeName || '';
      const cost = toKRW(it, meta);
      L.push(`| ${time} | ${c.icon} ${esc(it.title)} | ${esc(place)} | ${cost ? won(cost) : ''} |`);
    }
    L.push('');

    // 메모가 있는 일정은 표 밑에 따로 (표 안에 줄바꿈이 안 들어가서)
    const memos = list.filter(i => i.memo);
    for (const it of memos) {
      L.push(`- **${esc(it.title)}**: ${esc(it.memo.replace(/\n/g, ' / '))}`);
    }
    if (memos.length) L.push('');

    const dayTotal = list.reduce((s, i) => s + toKRW(i, meta), 0);
    if (dayTotal) L.push(`**${d.label} 합계**: ${won(dayTotal)}`, '');
  }

  // ── 비용 ────────────────────────────────────────────────
  L.push('---', '', '## 💰 예산', '');
  if (costs.length) {
    L.push('| 항목 | 예상 | 실제 |', '|:--|--:|--:|');
    for (const c of costs) {
      L.push(`| ${esc(c.label)} | ${won(toKRW(c, meta))} | ${hasSpent(c) ? won(spentKRW(c, meta)) : ''} |`);
    }
    L.push('');
  }
  const spent = [...items, ...costs].reduce((s, r) => s + spentKRW(r, meta), 0);
  L.push(`- **예상 총액**: ${won(total)}`);
  if (spent) L.push(`- **실제 지출**: ${won(spent)}`);
  L.push(`- **1인당**: ${won(total / people)}`, '');

  // ── 준비물 ──────────────────────────────────────────────
  if (checks.length) {
    L.push('---', '', '## ✅ 준비물', '');
    const groups = new Map();
    for (const c of checks) {
      const g = c.group || '기타';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    for (const [g, list] of groups) {
      L.push(`### ${g}`);
      for (const c of list) L.push(`- [${c.done ? 'x' : ' '}] ${esc(c.text)}`);
      L.push('');
    }
  }

  if (meta.memo) L.push('---', '', '## 📌 메모', '', meta.memo, '');

  L.push('---', '', `_여행 플래너에서 내보냄 · ${new Date().toLocaleString('ko-KR')}_`);
  return L.join('\n');
}

/** 표 안에서 | 가 칸을 깨뜨리지 않게 */
const esc = s => String(s || '').replace(/\|/g, '\\|');
