import { h, nonEmpty, hasItems, tabLabel } from '../app.js';

// "미확인 — 단정 금지" 같은 섹션은 경고 스타일로 보여 준다.
const isCaution = (key) => key.includes('미확인') || key.includes('단정 금지');

export function render({ data }) {
  const sections = Object.entries(data.company ?? {}).map(([key, values], si) => {
    if (!hasItems(values)) return null;
    return h('section', { class: isCaution(key) ? 'block warn-block' : 'block', id: `company-${si}` },
      h('h2', null, key),
      h('ul', null, values.map((text, i) => (nonEmpty(text) ? h('li', { id: `company-${si}-${i}` }, text) : null))));
  });
  return h('div', { class: 'company' }, h('h1', null, tabLabel('company')), sections);
}
