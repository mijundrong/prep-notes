import { h, nonEmpty, para, table, shuffle, tabLabel } from '../app.js';

const filter = { q: '' };
const drillState = { on: false, order: [], pos: 0, revealed: false };

const FIELDS = ['topic', 'no', 'yes', 'why'];
const HEAD = ['주제', '❌ 하지 않을 말', '✅ 이렇게 말한다', '이유'];

const matches = (row) => {
  const q = filter.q.trim().toLowerCase();
  return !q || FIELDS.some((f) => (row[f] ?? '').toLowerCase().includes(q));
};

function drillPanel(rows, visible, rerender) {
  if (!drillState.order.length) {
    return h('div', { class: 'drill-box' }, h('p', { class: 'empty' }, '드릴할 항목이 없습니다. 검색어를 바꿔 보세요.'));
  }
  const row = rows[drillState.order[drillState.pos]];
  const step = (delta) => {
    drillState.pos = (drillState.pos + delta + drillState.order.length) % drillState.order.length;
    drillState.revealed = false;
    rerender();
  };
  return h('div', { class: 'drill-box', 'aria-live': 'polite' },
    h('p', { class: 'small faint' }, `방어선 드릴 · ${drillState.pos + 1} / ${drillState.order.length}`),
    h('p', { class: 'defense-no' }, h('span', { class: 'mark-no' }, '❌'), ' ', row.no),
    h('p', { class: 'drill-ask' }, '어떻게 고쳐 말할까?'),
    drillState.revealed
      ? h('div', { class: 'drill-reveal' },
        nonEmpty(row.topic) ? h('p', { class: 'small faint' }, `주제: ${row.topic}`) : null,
        nonEmpty(row.yes) ? h('p', { class: 'defense-yes' }, h('span', { class: 'mark-yes' }, '✅'), ' ', row.yes) : null,
        para(row.why, { class: 'muted' }))
      : null,
    h('div', { class: 'row' },
      drillState.revealed
        ? h('button', { type: 'button', class: 'btn primary', onclick: () => step(1) }, '다음')
        : h('button', { type: 'button', class: 'btn primary', onclick: () => { drillState.revealed = true; rerender(); } }, '보기'),
      h('button', { type: 'button', class: 'btn', onclick: () => step(-1) }, '이전'),
      h('button', { type: 'button', class: 'btn', onclick: () => { drillState.order = shuffle(visible); drillState.pos = 0; drillState.revealed = false; rerender(); } }, '다시 섞기')));
}

export function render({ data, focus }) {
  const rows = data.defense ?? [];
  if (focus) {
    filter.q = '';
    drillState.on = false;
  }
  const search = h('input', { type: 'search', class: 'filter-input', value: filter.q, placeholder: '주제·표현 검색', 'aria-label': '방어선 검색' });
  const drillBtn = h('button', { type: 'button', class: 'btn' });
  const countLine = h('p', { class: 'count-line' });
  const tbl = table({
    head: HEAD,
    wide: true,
    cls: 'defense-table',
    rows: rows.map((r, i) => ({ id: `defense-${i}`, cells: [nonEmpty(r.topic) ? h('strong', null, r.topic) : '', r.no, r.yes, r.why] })),
  });
  const trs = tbl ? [...tbl.querySelectorAll('tbody tr')] : [];
  const drillHost = h('div');

  const refresh = () => {
    const visible = rows.map((r, i) => i).filter((i) => matches(rows[i]));
    countLine.textContent = `${rows.length}개 중 ${visible.length}개`;
    trs.forEach((tr, i) => { tr.hidden = !visible.includes(i); });
    drillBtn.textContent = drillState.on ? '드릴 끝내기' : '드릴';
    drillBtn.setAttribute('aria-pressed', String(drillState.on));
    if (tbl) tbl.hidden = drillState.on;
    if (drillState.on) {
      const stale = drillState.order.some((i) => !visible.includes(i)) || drillState.order.length !== visible.length;
      if (stale) Object.assign(drillState, { order: shuffle(visible), pos: 0, revealed: false });
      drillHost.replaceChildren(drillPanel(rows, visible, refresh));
    } else drillHost.replaceChildren();
  };

  search.addEventListener('input', () => {
    filter.q = search.value;
    refresh();
  });
  drillBtn.addEventListener('click', () => {
    drillState.on = !drillState.on;
    drillState.order = [];
    refresh();
  });
  refresh();

  return h('div', { class: 'defense' },
    h('h1', null, tabLabel('defense')),
    h('div', { class: 'filters' }, h('div', { class: 'row' }, search, drillBtn)),
    countLine,
    drillHost,
    tbl);
}
