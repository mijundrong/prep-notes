import { h, nonEmpty, para, progressRow, statusBadge, tabLabel, focusLink } from '../app.js';
import * as store from '../store.js';

export function spineLines(lines) {
  const usable = (lines ?? []).filter((l) => nonEmpty(l.label) || nonEmpty(l.text));
  if (!usable.length) return null;
  return h('ul', { class: 'spine-lines' }, usable.map((l) => h('li', null,
    nonEmpty(l.label) ? h('strong', null, l.label) : null,
    nonEmpty(l.label) && nonEmpty(l.text) ? ' ' : null,
    nonEmpty(l.text) ? l.text : null)));
}

export function render({ data }) {
  const spine = data.positioning?.spine ?? {};
  const cards = data.cards ?? [];
  const pressure = data.pressure ?? [];
  const studies = data.study ?? [];
  const confirms = data.positioning?.to_confirm ?? [];

  const cardDone = (c) => store.cardStatus(c.id) === 'done';
  const studyDone = (s) => store.study(s.id)?.done === true;
  const p1Cards = cards.filter((c) => c.priority === 1);
  const p1Study = studies.filter((s) => s.priority === 1);
  const confirmDone = confirms.filter((_, i) => store.toConfirm(i)?.done === true).length;

  const nextCards = p1Cards.filter((c) => !cardDone(c)).slice(0, 3);
  const nextStudy = p1Study.filter((s) => !studyDone(s)).slice(0, 3);

  return h('div', { class: 'home' },
    nonEmpty(spine.headline) ? h('h1', { class: 'headline' }, spine.headline) : h('h1', null, tabLabel('home')),
    spineLines(spine.lines),

    h('section', { class: 'block' },
      h('h2', null, '진행도'),
      progressRow({
        label: tabLabel('cards'), word: '완성', done: cards.filter(cardDone).length, total: cards.length,
        extra: `우선순위 1 중 완성 ${p1Cards.filter(cardDone).length} / ${p1Cards.length}`,
      }),
      progressRow({
        label: tabLabel('pressure'), word: '완성',
        done: pressure.filter((p) => store.pressureStatus(p.id) === 'done').length, total: pressure.length,
      }),
      progressRow({
        label: tabLabel('study'), word: '완료', done: studies.filter(studyDone).length, total: studies.length,
        extra: `우선순위 1 중 ${p1Study.filter(studyDone).length} / ${p1Study.length}`,
      }),
      confirms.length ? progressRow({ label: '확인할 것', word: '완료', done: confirmDone, total: confirms.length }) : null),

    h('section', { class: 'block' },
      h('h2', null, '다음에 할 것'),
      h('h3', null, `${tabLabel('cards')} — 우선순위 1 미완성`),
      nextCards.length
        ? h('ul', { class: 'next-list' }, nextCards.map((c) => h('li', null,
          h('a', { href: `#/cards/${encodeURIComponent(c.id)}` }, h('span', { class: 'mono' }, c.id), ' ', c.title),
          ' ', statusBadge(store.cardStatus(c.id)))))
        : h('p', { class: 'muted' }, '우선순위 1 카드를 모두 완성했습니다.'),
      h('h3', null, `${tabLabel('study')} — 우선순위 1 미완료`),
      nextStudy.length
        ? h('ul', { class: 'next-list' }, nextStudy.map((s) => h('li', null,
          focusLink('#/study', `study-${s.id}`, h('span', { class: 'mono' }, s.id), ' ', s.title))))
        : h('p', { class: 'muted' }, '우선순위 1 공부 항목을 모두 끝냈습니다.')),

    h('footer', { class: 'home-notes' },
      para(data.meta?.deadline_note, { class: 'small faint' }),
      para(data.meta?.principle, { class: 'small faint' })),
  );
}
