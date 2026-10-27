import {
  h, nonEmpty, hasItems, section, list, table, kvTable, priorityBadge, statusBadge, statusSelect,
  answerBox, collapsible, chipRow, autosize, tabLabel, aiBox, onCleanup,
} from '../app.js';
import * as ai from '../ai.js';
import * as store from '../store.js';
import * as comment from '../comment.js';

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

const when = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? store.formatStamp(new Date(iso)) : '');

// 문항마다 제출하기. 제출본은 카드 코멘트와 자료 모음이 쓴다. 제출 뒤 고치면 다시 제출할 수 있다.
function submitRow(c, q, onSubmit) {
  const btn = h('button', { type: 'button', class: 'btn small' });
  const note = h('span', { class: 'submit-note' });
  const paint = () => {
    const text = store.answerText(c.id, q.key);
    const sent = store.submitted(c.id, q.key);
    const same = Boolean(sent) && sent.text === text;
    btn.disabled = !text.trim() || same;
    btn.textContent = same ? '제출됨' : sent ? '다시 제출하기' : '제출하기';
    note.textContent = sent ? `${when(sent.updatedAt)} 제출${same ? '' : ' · 그 뒤로 고쳤습니다'}` : '';
    note.classList.toggle('changed', Boolean(sent) && !same);
  };
  btn.addEventListener('click', () => {
    store.submitAnswer(c.id, q.key);
    paint();
    onSubmit();
  });
  paint();
  return { el: h('div', { class: 'submit-row' }, btn, note), paint };
}

// "입사 후" 문항 아래: 렌즈가 이 카드에 짚은 재료(JD 업무 일부와 쓰일 수 있는 이유). 접어 두고, 답 칸에는 아무것도 넣지 않는다.
function lensMaterial(c) {
  const items = (store.lens()?.result?.apply_material ?? []).filter((m) => m.cardId === c.id);
  if (!items.length) return null;
  return collapsible(`직무 렌즈 재료 ${items.length}개`, aiBox('Claude 렌즈',
    h('p', { class: 'small faint' }, '이 경험이 닿는 JD 업무와 그 이유를 짚은 재료입니다. 답은 내가 씁니다.'),
    h('ul', { class: 'lens-material' }, items.map((m) => h('li', null,
      h('p', null, h('span', { class: 'label' }, 'JD'), ` “${m.jd}”`),
      nonEmpty(m.why) ? h('p', { class: 'small' }, m.why) : null)))), { cls: 'hint lens-hint ai-only', id: `card-${c.id}-lens` });
}

function questionsBlock(c, statusCtl, onSubmit) {
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
  return section('4문', questions.map((q) => {
    const row = submitRow(c, q, onSubmit);
    return h('div', { class: 'question', id: `card-${c.id}-q-${q.key}` },
      h('h3', null, q.label),
      nonEmpty(q.hint) ? collapsible('재료 보기', h('p', null, q.hint), { id: `card-${c.id}-hint-${q.key}`, cls: 'hint' }) : null,
      answerBox({
        value: store.answerText(c.id, q.key),
        onInput: (v) => {
          store.setAnswer(c.id, q.key, v);
          suggest();
          row.paint();
        },
        rows: 4,
        label: `${c.id} ${q.label}`,
        check: c.id,
      }),
      row.el,
      q.key === 'apply' ? lensMaterial(c) : null);
  }));
}

const labelOf = (c, key) => c.questions?.find((q) => q.key === key)?.label ?? key;

// 카드 코멘트(Claude, 사실 대조) 내용. 자료 모음도 같은 모양으로 보여 준다.
export function commentView(data, c, saved, { stale = false } = {}) {
  const r = saved.result;
  const yes = (topic) => (data.defense ?? []).find((d) => d.topic === topic)?.yes;
  const mine = (x) => h('p', { class: 'ai-quote' }, h('span', { class: 'label' }, labelOf(c, x.q)), ' “', x.quote, '”');
  const groups = [
    [`확정 사실·주의와 어긋나는 곳 ${r.facts.length}`, r.facts.map((f) => h('li', null,
      mine(f),
      h('p', { class: 'small' }, h('span', { class: 'label' }, f.kind === 'fact' ? '확정 사실' : '주의'), ' “', f.against, '”'),
      nonEmpty(f.note) ? h('p', { class: 'small' }, f.note) : null))],
    [`방어선 ${r.defense.length}`, r.defense.map((d) => h('li', null,
      mine(d),
      h('p', { class: 'small' }, h('span', { class: 'label' }, '방어선'), ` ${d.topic}`, yes(d.topic) ? [' → 이렇게 말한다: ', yes(d.topic)] : ''),
      nonEmpty(d.note) ? h('p', { class: 'small' }, d.note) : null))],
    [`4문끼리 부딪히는 곳 ${r.conflicts.length}`, r.conflicts.map((x) => h('li', null,
      mine(x.a), mine(x.b),
      nonEmpty(x.note) ? h('p', { class: 'small' }, x.note) : null))],
  ].filter(([, items]) => items.length);
  return aiBox('Claude 코멘트 — 사실 대조',
    h('p', { class: 'small faint' }, `${when(saved.at)} · 제출본 기준`, stale ? ' · 그 뒤로 다시 제출한 문항이 있습니다' : ''),
    groups.length
      ? groups.map(([title, items]) => [h('h4', null, title), h('ul', { class: 'comment-list' }, items)])
      : h('p', null, '확정 사실·주의·방어선과 어긋나는 곳, 4문끼리 부딪히는 곳을 찾지 못했습니다.'));
}

// claude.ai판에서만 보인다 (ai-only).
function commentBlock(data, c) {
  const body = h('div', { class: 'card-comment-body' });
  let tick = null;
  const paint = () => {
    const job = comment.job(c.id);
    const saved = store.cardComment(c.id);
    const stale = Boolean(saved) && comment.isStale(c);
    const parts = [h('p', { class: 'small muted' }, '4문을 모두 제출하면 Claude가 제출본을 이 카드의 확정 사실·주의·방어선과 대조하고, 4문끼리 부딪히는 곳만 짚습니다. 평가하거나 고쳐 쓰지 않습니다.')];
    if (job?.active) {
      parts.push(h('div', { class: 'row' },
        h('span', { class: 'small muted', role: 'status' }, `${job.chars ? `쓰는 중… ${job.chars.toLocaleString()}자` : '확인하는 중… (보통 10~60초)'} · ${Math.round((Date.now() - job.startedAt) / 1000)}초`),
        h('button', { type: 'button', class: 'btn small', onclick: () => comment.stop(c.id) }, '중지')));
    } else if (!comment.allSubmitted(c)) {
      parts.push(h('p', { class: 'small faint' }, `제출 ${store.submittedCount(c.id)}/4`));
    } else {
      if (job?.error && job.error !== 'cancelled') parts.push(h('p', { class: 'small error', role: 'status' }, ai.errorText(job.error)));
      const label = !saved ? '코멘트 받기' : stale ? '지금 제출본으로 다시 받기' : '같은 제출본으로 다시 확인';
      parts.push(h('div', { class: 'row' }, h('button', {
        type: 'button', class: saved && !stale ? 'btn small' : 'btn small primary',
        onclick: () => comment.request(data, c, { force: Boolean(saved) && !stale }),
      }, label)));
    }
    if (job?.dropped?.quotes) parts.push(h('p', { class: 'small faint' }, `제출본·자료에 없는 인용 ${job.dropped.quotes}개를 버렸습니다.`));
    if (saved && !job?.active) parts.push(commentView(data, c, saved, { stale }));
    body.replaceChildren(...parts);
    if (job?.active && !tick) tick = setInterval(paint, 1000);
    if (!job?.active && tick) {
      clearInterval(tick);
      tick = null;
    }
  };
  onCleanup(comment.onChange(paint));
  onCleanup(() => clearInterval(tick));
  paint();
  return { el: section({ title: 'Claude 코멘트 — 이 카드', cls: 'ai-only card-comment', id: `card-${c.id}-comment` }, body), paint };
}

function followupsBlock(c, focus) {
  if (!hasItems(c.followups)) return null;
  return section('↪ 꼬리질문', h('ul', { class: 'followups' }, c.followups.map((q, i) => {
    if (!nonEmpty(q)) return null;
    const id = `card-${c.id}-fu-${i}`;
    const saved = store.followupText(c.id, i);
    const open = Boolean(saved.trim()) || focus?.id === id;
    const wrap = h('div', { class: 'fu-answer', hidden: !open },
      answerBox({
        value: saved,
        onInput: (v) => store.setFollowup(c.id, i, v),
        rows: 2,
        label: `꼬리질문 답: ${q}`,
        check: c.id,
      }));
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
  const commentCtl = commentBlock(data, c);
  // 마지막 문항을 제출해 4문이 다 모이면 코멘트를 받는다 (제출본이 바뀌었을 때만).
  const onSubmit = () => {
    comment.request(data, c);
    commentCtl.paint();
  };
  return h('article', { class: 'detail card-detail' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/cards' }, tabLabel('cards')), ` / ${c.id}`),
    h('header', { class: 'detail-head', id: `card-${c.id}-title` },
      h('p', { class: 'eyebrow' }, [c.group, c.id].filter(nonEmpty).join(' · ')),
      h('h1', null, c.title),
      nonEmpty(c.period) ? h('p', { class: 'period' }, c.period) : null,
      h('div', { class: 'meta-row' }, priorityBadge(c.priority), statusCtl.el)),
    factsBlock(c),
    optionsBlock(c),
    questionsBlock(c, statusCtl, onSubmit),
    commentCtl.el,
    hasItems(c.caution) ? section({ title: '⚠ 주의', cls: 'warn' }, list(c.caution, { idPrefix: `card-${c.id}-caution-` })) : null,
    followupsBlock(c, focus),
    prevNext(c, all));
}

export function render(ctx) {
  return ctx.param ? detailView(ctx) : listView(ctx);
}
