import {
  h, nonEmpty, hasItems, para, section, list, priorityBadge, statusBadge, statusSelect, answerBox, collapsible, createTimer, tabLabel,
} from '../app.js';
import * as store from '../store.js';

function listView({ data }) {
  const items = data.pressure ?? [];
  return h('div', { class: 'pressure' },
    h('h1', null, tabLabel('pressure')),
    h('p', { class: 'count-line' }, `${items.length}개`),
    h('ul', { class: 'item-list' }, items.map((p) => h('li', null, h('a', { class: 'item', href: `#/pressure/${encodeURIComponent(p.id)}` },
      h('span', { class: 'item-id' }, p.id),
      h('span', { class: 'item-main' }, h('span', { class: 'item-title' }, p.title)),
      h('span', { class: 'item-meta' }, priorityBadge(p.priority), statusBadge(store.pressureStatus(p.id))))))));
}

function prevNext(p, items) {
  const i = items.findIndex((x) => x.id === p.id);
  const link = (target, word, cls) => (target
    ? h('a', { class: cls, href: `#/pressure/${encodeURIComponent(target.id)}` }, h('span', { class: 'small faint' }, word), h('span', null, `${target.id} ${target.title}`))
    : h('span', { class: cls }));
  return h('nav', { class: 'prev-next', 'aria-label': '이전·다음 문항' }, link(items[i - 1], '이전', 'prev'), link(items[i + 1], '다음', 'next'));
}

function detailView({ data, param }) {
  const items = data.pressure ?? [];
  const p = items.find((x) => x.id === param);
  if (!p) {
    return h('div', null, h('h1', null, tabLabel('pressure')), h('p', null, `문항 ${param}을(를) 찾을 수 없습니다.`), h('a', { href: '#/pressure' }, '목록으로'));
  }
  const base = `pressure-${p.id}`;
  const statusCtl = statusSelect(store.pressureStatus(p.id), (v) => store.setPressure(p.id, { status: v }));
  const onInput = (v) => {
    store.setPressure(p.id, { text: v });
    if (v.trim() && store.pressureStatus(p.id) === 'todo') {
      store.setPressure(p.id, { status: 'draft' });
      statusCtl.set('draft');
    }
  };
  return h('article', { class: 'detail pressure-detail' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/pressure' }, tabLabel('pressure')), ` / ${p.id}`),
    h('header', { class: 'detail-head', id: `${base}-title` },
      h('p', { class: 'eyebrow' }, p.id),
      h('h1', null, p.title),
      h('div', { class: 'meta-row' }, priorityBadge(p.priority))),
    nonEmpty(p.prompt) ? h('blockquote', { class: 'prompt', id: `${base}-prompt` }, p.prompt) : null,
    hasItems(p.material) ? collapsible('재료 보기', list(p.material, { idPrefix: `${base}-material-` }), { id: `${base}-material`, cls: 'material' }) : null,
    section({ title: '힌트', id: `${base}-hint` }, para(p.hint)),
    hasItems(p.caution) ? section({ title: '⚠ 주의', cls: 'warn' }, list(p.caution, { idPrefix: `${base}-caution-` })) : null,
    section({ title: '내 답변', id: `${base}-answer` },
      answerBox({ value: store.pressure(p.id)?.text ?? '', onInput, rows: 6, label: `${p.id} 내 답변`, check: p.id }),
      h('div', { class: 'answer-tools' }, statusCtl.el, createTimer({ presets: [60, 90, 120] }).el)),
    prevNext(p, items));
}

export function render(ctx) {
  return ctx.param ? detailView(ctx) : listView(ctx);
}
