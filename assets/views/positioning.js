import {
  h, nonEmpty, hasItems, para, section, list, table, badge, warnBox, collapsible, chipRow, answerBox, createTimer, tabLabel, go,
} from '../app.js';
import * as store from '../store.js';
import { versionId as domId } from '../weave-model.js';
import { spineLines } from './home.js';

const GRADES = ['강', '중~강', '중', '약', '없음'];
const GRADE_CLASS = { 강: 'grade-strong', '중~강': 'grade-midstrong', 중: 'grade-mid', 약: 'grade-weak', 없음: 'grade-none' };
const SCRIPTS = [
  { key: 'intro60', label: '자기소개 60초', seconds: 60 },
  { key: 'whyme90', label: 'Why Me 90초', seconds: 90 },
];
const gradeFilter = new Set();

const emph = (text, id) => (nonEmpty(text) ? h('p', { class: 'emph', id }, text) : null);
const gradeBadge = (grade) => badge(grade, `grade ${GRADE_CLASS[grade] ?? 'grade-none'}`);

// 엮기의 "포지셔닝과 대조"에서 받아들인 내 버전이 있으면 위에, 원문은 접어서 아래에 둔다. 원문 JSON은 그대로다.
// back: 되돌린 뒤 보여 줄 자리 (내 버전 블록은 되돌리면 없어진다)
function originalPart(target, back, node) {
  return h('div', { class: 'original-row' },
    collapsible('원문 보기', node, { cls: 'original' }),
    h('button', {
      type: 'button', class: 'btn small',
      onclick: () => {
        store.setMyPositioning(target, '');
        go('#/positioning', back);
      },
    }, '원문으로 되돌리기'));
}

function versioned(target, original, show, back) {
  const mine = store.myPositioning(target);
  if (!mine || !nonEmpty(original)) return show(original);
  return h('div', { class: 'my-version', id: domId(target) }, h('p', { class: 'mine-label' }, '내 버전'), show(mine.text), originalPart(target, back, show(original)));
}

function spineBlock(spine) {
  if (!spine) return null;
  return section('경계와 증거', nonEmpty(spine.headline) ? h('p', { class: 'headline' }, spine.headline) : null, spineLines(spine.lines));
}

function navalBlock(v) {
  if (!v) return null;
  return section('함정 체계 엔지니어란',
    emph(v.one_line),
    table({
      head: ['성질', '무슨 뜻', 'SE에게 필요한 것'],
      rows: (v.difficulties ?? []).map((d) => [d.trait, d.meaning, d.need]),
    }),
    para(v.junior_note, { class: 'muted' }));
}

function companyNowBlock(v) {
  if (!v) return null;
  return section('한화시스템의 지금',
    para(v.identity),
    table({ head: ['축', '무슨 일', '근거'], rows: (v.axes ?? []).map((a) => [a.axis, a.what, nonEmpty(a.src) ? h('span', { class: 'small' }, a.src) : '']) }),
    emph(v.compressed),
    nonEmpty(v.caution) ? warnBox(h('p', null, v.caution)) : null);
}

function needsBlock(items) {
  if (!items?.length) return null;
  return section('그래서 필요한 사람',
    table({ head: ['흐름', '왜', '필요한 사람'], rows: items.map((n) => [nonEmpty(n.theme) ? h('strong', null, n.theme) : '', n.why, n.person]) }));
}

function thesisBlock(v) {
  if (!v) return null;
  return section({ title: '한 줄 명제', id: 'pos-thesis' },
    versioned('thesis.core', v.core, (t) => emph(t), 'pos-thesis'),
    versioned('thesis.layer', v.layer, (t) => para(t), 'pos-thesis'),
    para(v.note, { class: 'small faint' }));
}

function evidenceBlock(items) {
  if (!items?.length) return null;
  const tbl = table({
    head: ['필요 역량', '내 증거', '등급'],
    rows: items.map((e) => [e.need, e.evidence, gradeBadge(e.grade)]),
  });
  const rows = tbl.querySelectorAll('tbody tr');
  const apply = () => rows.forEach((tr, i) => {
    tr.hidden = gradeFilter.size > 0 && !gradeFilter.has(items[i].grade);
  });
  const options = GRADES.map((g) => ({ value: g, text: g, count: items.filter((e) => e.grade === g).length })).filter((o) => o.count);
  apply();
  return section('필요 역량 → 내 증거', chipRow({ label: '등급', options, selected: gradeFilter, onChange: apply }), tbl);
}

function whyNowBlock(items, line) {
  return section({ title: 'Why Now', id: 'pos-why-now' },
    table({ head: ['지금', '필요한 사람', '나'], rows: (items ?? []).map((w) => [w.now, w.need, w.me]) }),
    versioned('why_now_line', line, (t) => emph(t), 'pos-why-now'));
}

function pillarsBlock(pillars) {
  if (!pillars?.length) return null;
  return section('다섯 기둥', h('ol', { class: 'pillars' }, pillars.map((p) => {
    const inputId = `pillar-input-${p.n}`;
    const titleTarget = `pillars[${p.n}].title`;
    const myTitle = nonEmpty(p.title) ? store.myPositioning(titleTarget) : null;
    return h('li', { class: 'pillar', id: `pillar-${p.n}` },
      h('p', { class: 'pillar-head' },
        h('span', { class: 'pillar-n' }, store.circled(p.n)), ' ',
        nonEmpty(p.title) ? h('strong', null, myTitle ? myTitle.text : p.title) : null, ' ',
        badge(p.role, 'role'),
        myTitle ? [' ', badge('내 버전', 'mine-badge')] : null),
      myTitle ? h('div', { id: domId(titleTarget) }, originalPart(titleTarget, `pillar-${p.n}`, h('p', null, p.title))) : null,
      para(p.evidence),
      versioned(`pillars[${p.n}].line`, p.line, (t) => (nonEmpty(t) ? h('blockquote', { class: 'quote' }, t) : null), `pillar-${p.n}`),
      h('label', { class: 'input-label', for: inputId }, '내 문장으로'),
      answerBox({
        id: inputId,
        value: store.pillarText(p.n),
        onInput: (v) => store.setPillar(p.n, v),
        rows: 2,
        label: `기둥 ${p.n} 내 문장`,
        check: true,
      }));
  })));
}

function rediscoveredBlock(items) {
  if (!items?.length) return null;
  return section('경험 재탐색', table({
    head: ['경험', '기존', '새로 보인 것'],
    rows: items.map((r) => ({
      cls: r.confirm === true ? 'confirm' : null,
      cells: [
        [r.exp, r.confirm === true ? [h('br'), badge('⚠ 확인 필요', 'warn-badge')] : null],
        r.before,
        r.after,
      ],
    })),
  }));
}

function mastersBlock(v) {
  if (!v) return null;
  const pairs = [['전제', v.premise], ['석사 지원자가 가져오는 것', v.they_bring], ['관점 전환', v.shift]].filter(([, t]) => nonEmpty(t));
  return section('석사 지원자와의 관계',
    pairs.length ? h('dl', { class: 'pairs' }, pairs.map(([k, t]) => [h('dt', null, k), h('dd', null, t)])) : null,
    hasItems(v.i_bring) ? [h('h3', null, '내가 가져오는 것'), list(v.i_bring)] : null,
    nonEmpty(v.never) ? warnBox(h('p', null, h('strong', null, '하지 않을 말'), ' ', v.never)) : null,
    v.must_answer?.length
      ? [h('h3', null, '답할 수 있어야 하는 것'), table({ head: ['주제', '답할 수 있어야 하는 것', '연결'], rows: v.must_answer.map((m) => [m.topic, m.what, m.link]) })]
      : null);
}

function weaknessBlock(items) {
  if (!items?.length) return null;
  return section('약점 선제 대응', table({ head: ['약점', '대응'], rows: items.map((w) => [nonEmpty(w.weak) ? h('strong', null, w.weak) : '', w.response]) }));
}

function scriptsBlock(scripts) {
  if (!scripts) return null;
  const parts = SCRIPTS.filter((s) => nonEmpty(scripts[s.key])).map(({ key, label, seconds }) => {
    const inputId = `script-input-${key}`;
    return h('div', { class: 'script', id: `script-${key}` },
      h('h3', null, label),
      collapsible('뼈대 원문', h('p', null, scripts[key]), { open: true, cls: 'skeleton' }),
      h('label', { class: 'input-label', for: inputId }, '내 버전'),
      answerBox({
        id: inputId,
        value: store.scriptText(key),
        onInput: (v) => store.setScript(key, v),
        rows: 6,
        label: `${label} 내 버전`,
        check: true,
      }),
      createTimer({ presets: [seconds] }).el);
  });
  return section('말하기 뼈대', nonEmpty(scripts.note) ? warnBox(h('p', null, scripts.note)) : null, parts);
}

function confirmBlock(items) {
  if (!hasItems(items)) return null;
  return section('확인할 것', h('ul', { class: 'checklist' }, items.map((text, i) => {
    if (!nonEmpty(text)) return null;
    const saved = store.toConfirm(i);
    return h('li', { class: 'check-item', id: `confirm-${i}` },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: saved?.done === true, onchange: (e) => store.setToConfirm(i, { done: e.target.checked }) }),
        h('span', null, text)),
      answerBox({ value: saved?.note ?? '', onInput: (v) => store.setToConfirm(i, { note: v }), rows: 1, compact: true, label: `메모: ${text}`, placeholder: '메모' }));
  })));
}

export function render({ data }) {
  const p = data.positioning ?? {};
  return h('div', { class: 'positioning' },
    h('h1', null, tabLabel('positioning')),
    spineBlock(p.spine),
    navalBlock(p.naval_se),
    companyNowBlock(p.company_now),
    needsBlock(p.company_needs),
    thesisBlock(p.thesis),
    evidenceBlock(p.evidence_map),
    whyNowBlock(p.why_now, p.why_now_line),
    pillarsBlock(p.pillars),
    section('나만의 조합', para(p.combination)),
    rediscoveredBlock(p.rediscovered),
    mastersBlock(p.vs_masters),
    weaknessBlock(p.weaknesses),
    scriptsBlock(p.scripts),
    confirmBlock(p.to_confirm));
}
