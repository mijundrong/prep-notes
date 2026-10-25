import {
  h, nonEmpty, hasItems, section, list, table, kvTable, priorityBadge, statusBadge, statusSelect,
  answerBox, collapsible, chipRow, autosize, tabLabel,
} from '../app.js';
import * as store from '../store.js';

// 목록 필터는 화면을 오가도 유지한다 (이전/다음 이동이 이 기준을 따른다).
const filters = { group: new Set(), priority: new Set(), status: new Set() };

const PROFILE_FIELDS = [
  ['이름', 'name'], ['학교', 'school'], ['기간', 'period'], ['성적', 'gpa'],
  ['어학', 'language'], ['병역', 'military'], ['지원', 'target'], ['정체성', 'identity'],
];
const LOW_GRADE = /\s(B0|B\+)$/;

function filtered(all) {
  return all.filter((c) =>
    (!filters.group.size || filters.group.has(c.group)) &&
    (!filters.priority.size || filters.priority.has(c.priority)) &&
    (!filters.status.size || filters.status.has(store.cardStatus(c.id))));
}

const filtersActive = () => filters.group.size + filters.priority.size + filters.status.size > 0;

function courses(text) {
  if (!nonEmpty(text)) return '';
  return h('span', { class: 'courses' },
    text.split(' · ').map((c) => h('span', { class: LOW_GRADE.test(c) ? 'course low' : 'course' }, c)));
}

function profileBlock(p) {
  if (!p) return null;
  const kv = kvTable(PROFILE_FIELDS.map(([label, key]) => [label, p[key]]));
  const transcript = table({
    head: ['학기', '평점', '과목'],
    cls: 'transcript',
    rows: (p.transcript ?? []).map((t) => [t.term, t.gpa, courses(t.courses)]),
  });
  if (!kv && !transcript) return null;
  return collapsible('내 서류 원본', [
    kv,
    transcript ? [h('h3', null, '성적표'), h('p', { class: 'small faint' }, 'B0·B+ 과목은 옅게 표시'), transcript] : null,
  ], { cls: 'profile-src' });
}

function cardRow(c) {
  const total = (c.questions ?? []).length;
  return h('li', null, h('a', { class: 'item', href: `#/cards/${encodeURIComponent(c.id)}` },
    h('span', { class: 'item-id' }, c.id),
    h('span', { class: 'item-main' },
      h('span', { class: 'item-title' }, c.title),
      nonEmpty(c.period) ? h('span', { class: 'item-sub' }, c.period) : null),
    h('span', { class: 'item-meta' },
      priorityBadge(c.priority),
      statusBadge(store.cardStatus(c.id)),
      h('span', { class: 'n4', title: '4문 중 작성한 개수' }, `${store.answeredCount(c.id)}/${total}`))));
}

function listView({ data }) {
  const all = data.cards ?? [];
  const groups = [...new Set(all.map((c) => c.group))];
  const priorities = [1, 2, 3].filter((p) => all.some((c) => c.priority === p));
  const countLine = h('p', { class: 'count-line' });
  const listEl = h('ul', { class: 'item-list' });

  const refresh = () => {
    const shown = filtered(all);
    countLine.textContent = `${all.length}개 중 ${shown.length}개`;
    listEl.replaceChildren(...shown.map(cardRow));
    if (!shown.length) listEl.append(h('li', { class: 'empty' }, '조건에 맞는 카드가 없습니다.'));
  };
  refresh();

  return h('div', { class: 'cards' },
    h('h1', null, tabLabel('cards')),
    profileBlock(data.profile),
    h('div', { class: 'filters' },
      chipRow({
        label: '그룹',
        options: groups.map((g) => ({ value: g, text: g, count: all.filter((c) => c.group === g).length })),
        selected: filters.group,
        onChange: refresh,
      }),
      chipRow({
        label: '우선순위',
        options: priorities.map((p) => ({ value: p, text: String(p), count: all.filter((c) => c.priority === p).length })),
        selected: filters.priority,
        onChange: refresh,
      }),
      chipRow({
        label: '상태',
        options: store.STATUSES.map((s) => ({ value: s, text: store.STATUS_LABEL[s], count: all.filter((c) => store.cardStatus(c.id) === s).length })),
        selected: filters.status,
        onChange: refresh,
      })),
    countLine,
    listEl);
}

function factsBlock(c) {
  if (!hasItems(c.facts)) return null;
  return section({ title: '확정 사실', cls: 'facts-block' },
    h('p', { class: 'small faint' }, '고칠 수 없는 사실'),
    list(c.facts, { cls: 'facts', idPrefix: `card-${c.id}-fact-` }));
}

function optionsBlock(c) {
  const options = (c.options ?? []).filter((o) => nonEmpty(o.label));
  if (!options.length) return null;
  const name = `choice-${c.id}`;
  const current = store.card(c.id)?.choice ?? null;
  const radios = options.map((o) => h('input', {
    type: 'radio', name, value: o.label, checked: current === o.label,
    onchange: () => {
      store.setCardChoice(c.id, o.label);
      clearBtn.hidden = false;
    },
  }));
  const clearBtn = h('button', {
    type: 'button', class: 'btn small', hidden: !current,
    onclick: () => {
      store.setCardChoice(c.id, null);
      radios.forEach((r) => { r.checked = false; });
      clearBtn.hidden = true;
    },
  }, '선택 해제');
  return section({ title: '후보', cls: 'options-block', id: `card-${c.id}-options` },
    h('p', { class: 'small faint' }, '하나를 고르면 저장됩니다.'),
    h('div', { class: 'options', role: 'radiogroup', 'aria-label': '후보' }, options.map((o, i) => h('label', { class: 'option' },
      radios[i],
      h('span', { class: 'option-body' },
        h('strong', null, o.label),
        nonEmpty(o.detail) ? h('span', { class: 'option-detail' }, o.detail) : null)))),
    clearBtn);
}

function questionsBlock(c, statusCtl) {
  const questions = c.questions ?? [];
  if (!questions.length) return null;
  // 4문이 모두 채워지면 "미작성" → "초안". "완성"은 사용자가 직접 고른다.
  const suggest = () => {
    const allFilled = questions.every((q) => store.answerText(c.id, q.key).trim());
    if (allFilled && store.cardStatus(c.id) === 'todo') {
      store.setCardStatus(c.id, 'draft');
      statusCtl.set('draft');
    }
  };
  return section('4문', questions.map((q) => h('div', { class: 'question', id: `card-${c.id}-q-${q.key}` },
    h('h3', null, q.label),
    nonEmpty(q.hint) ? collapsible('재료 보기', h('p', null, q.hint), { id: `card-${c.id}-hint-${q.key}`, cls: 'hint' }) : null,
    answerBox({
      value: store.answerText(c.id, q.key),
      onInput: (v) => {
        store.setAnswer(c.id, q.key, v);
        suggest();
      },
      rows: 4,
      label: `${c.id} ${q.label}`,
    }))));
}

function followupsBlock(c, focus) {
  if (!hasItems(c.followups)) return null;
  return section('↪ 꼬리질문', h('ul', { class: 'followups' }, c.followups.map((q, i) => {
    if (!nonEmpty(q)) return null;
    const id = `card-${c.id}-fu-${i}`;
    const saved = store.followupText(c.id, i);
    const open = Boolean(saved.trim()) || focus?.id === id;
    const wrap = h('div', { class: 'fu-answer', hidden: !open },
      answerBox({ value: saved, onInput: (v) => store.setFollowup(c.id, i, v), rows: 2, label: `꼬리질문 답: ${q}` }));
    const toggle = h('button', { type: 'button', class: 'btn small', 'aria-expanded': String(open) }, open ? '접기' : '답 쓰기');
    toggle.addEventListener('click', () => {
      const show = wrap.hidden;
      wrap.hidden = !show;
      toggle.textContent = show ? '접기' : '답 쓰기';
      toggle.setAttribute('aria-expanded', String(show));
      if (show) {
        const area = wrap.querySelector('textarea');
        autosize(area);
        area.focus();
      }
    });
    return h('li', { class: 'followup', id }, h('div', { class: 'fu-row' }, h('span', { class: 'fu-q' }, q), toggle), wrap);
  })));
}

function prevNext(c, all) {
  const shown = filtered(all);
  const seq = shown.some((x) => x.id === c.id) ? shown : all;
  const i = seq.findIndex((x) => x.id === c.id);
  const link = (target, word, cls) => (target
    ? h('a', { class: cls, href: `#/cards/${encodeURIComponent(target.id)}` }, h('span', { class: 'small faint' }, word), h('span', null, `${target.id} ${target.title}`))
    : h('span', { class: cls }));
  return h('nav', { class: 'prev-next', 'aria-label': '이전·다음 카드' },
    link(seq[i - 1], '이전', 'prev'),
    link(seq[i + 1], '다음', 'next'),
    seq === shown && filtersActive() ? h('p', { class: 'small faint prev-next-note' }, `현재 필터 기준 ${i + 1} / ${seq.length}`) : null);
}

function detailView({ data, param, focus }) {
  const all = data.cards ?? [];
  const c = all.find((x) => x.id === param);
  if (!c) {
    return h('div', null, h('h1', null, tabLabel('cards')), h('p', null, `카드 ${param}을(를) 찾을 수 없습니다.`), h('a', { href: '#/cards' }, '목록으로'));
  }
  const statusCtl = statusSelect(store.cardStatus(c.id), (v) => store.setCardStatus(c.id, v));
  return h('article', { class: 'detail card-detail' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/cards' }, tabLabel('cards')), ` / ${c.id}`),
    h('header', { class: 'detail-head', id: `card-${c.id}-title` },
      h('p', { class: 'eyebrow' }, [c.group, c.id].filter(nonEmpty).join(' · ')),
      h('h1', null, c.title),
      nonEmpty(c.period) ? h('p', { class: 'period' }, c.period) : null,
      h('div', { class: 'meta-row' }, priorityBadge(c.priority), statusCtl.el)),
    factsBlock(c),
    optionsBlock(c),
    questionsBlock(c, statusCtl),
    hasItems(c.caution) ? section({ title: '⚠ 주의', cls: 'warn' }, list(c.caution, { idPrefix: `card-${c.id}-caution-` })) : null,
    followupsBlock(c, focus),
    prevNext(c, all));
}

export function render(ctx) {
  return ctx.param ? detailView(ctx) : listView(ctx);
}
