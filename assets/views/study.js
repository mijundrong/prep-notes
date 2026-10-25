import { h, nonEmpty, progressRow, answerBox, tabLabel } from '../app.js';
import * as store from '../store.js';

export function render({ data }) {
  const items = data.study ?? [];
  const progress = h('div', { class: 'progress-list' });
  const done = (s) => store.study(s.id)?.done === true;
  const updateProgress = () => {
    const p1 = items.filter((s) => s.priority === 1);
    progress.replaceChildren(progressRow({
      label: tabLabel('study'), word: '완료', done: items.filter(done).length, total: items.length,
      extra: `우선순위 1 중 ${p1.filter(done).length} / ${p1.length}`,
    }));
  };
  updateProgress();

  const item = (s) => {
    const saved = store.study(s.id);
    const box = h('input', {
      type: 'checkbox',
      checked: saved?.done === true,
      onchange: (e) => {
        store.setStudy(s.id, { done: e.target.checked });
        updateProgress();
      },
    });
    return h('li', { class: 'study-item', id: `study-${s.id}` },
      h('label', { class: 'check' }, box, h('span', null, h('span', { class: 'mono' }, s.id), ' ', h('strong', null, s.title))),
      nonEmpty(s.what) ? h('p', null, s.what) : null,
      nonEmpty(s.why) ? h('p', { class: 'muted' }, h('span', { class: 'label' }, '왜'), ' ', s.why) : null,
      nonEmpty(s.where) ? h('p', { class: 'small faint' }, h('span', { class: 'label' }, '어디서'), ' ', s.where) : null,
      h('div', { class: 'study-note' },
        answerBox({ value: saved?.note ?? '', onInput: (v) => store.setStudy(s.id, { note: v }), rows: 1, compact: true, label: `${s.id} 메모`, placeholder: '메모' })));
  };

  const groups = [1, 2, 3].map((p) => [p, items.filter((s) => s.priority === p)]).filter(([, list]) => list.length);
  return h('div', { class: 'study' },
    h('h1', null, tabLabel('study')),
    progress,
    groups.map(([p, list]) => h('section', { class: 'block' },
      h('h2', null, `우선순위 ${p}`, h('span', { class: 'count' }, ` ${list.length}개`)),
      h('ul', { class: 'study-list' }, list.map(item)))));
}
