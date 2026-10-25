import { h, nonEmpty, hasItems, para, section, list, table, kvTable, tabLabel } from '../app.js';

function jdBlock(j) {
  const quotes = (j.jd_raw ?? []).map((text, i) => (nonEmpty(text) ? h('blockquote', { class: 'jd', id: `job-jd-${i}` }, text) : null));
  return section('JD 원문', quotes, kvTable(j.jd_meta, { id: 'job-meta' }));
}

function translatedBlock(items) {
  if (!items?.length) return null;
  return section('JD 문장 → 실제 업무', table({
    head: ['JD 문장', '실제로는', '신입은', '내 경험'],
    wide: true,
    cls: 'translated',
    rows: items.map((t, i) => ({
      id: `job-tr-${i}`,
      cls: (t.mine ?? '').includes('⭐') ? 'star' : null,
      cells: [nonEmpty(t.jd) ? h('strong', null, t.jd) : '', t.real, t.junior, t.mine],
    })),
  }));
}

function unmannedBlock(u) {
  if (!u) return null;
  return section('유·무인 확장',
    nonEmpty(u.headline) ? h('p', { class: 'emph', id: 'job-ux-headline' }, u.headline) : null,
    list(u.structure, { idPrefix: 'job-ux-s-' }),
    hasItems(u.experiment_2026_08) ? [h('h3', null, '2026.08 실험'), list(u.experiment_2026_08, { ordered: true, idPrefix: 'job-ux-e-' })] : null,
    nonEmpty(u.for_junior) ? [h('h3', null, '신입에게'), para(u.for_junior, { id: 'job-ux-junior' })] : null);
}

function vocabBlock(v) {
  if (!v) return null;
  return section('SE 실무 어휘 (경력직 공고 기준)',
    nonEmpty(v.source) ? h('p', { class: 'source small faint', id: 'job-vocab-source' }, '출처: ', v.source) : null,
    table({ head: ['용어', '내용'], rows: (v.items ?? []).map((it, i) => ({ id: `job-vocab-${i}`, cells: [nonEmpty(it.term) ? h('strong', null, it.term) : '', it.note] })) }));
}

function careerBlock(c) {
  if (!c) return null;
  const safeUrl = nonEmpty(c.url) && /^https?:\/\//i.test(c.url);
  const body = [
    nonEmpty(c.title) ? h('p', null, h('strong', null, c.title)) : null,
    para(c.known),
    safeUrl ? h('p', null, h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.url)) : para(c.url),
    para(c.missing, { class: 'small faint' }),
  ].filter(Boolean);
  if (!body.length) return null;
  return section({ title: '한화시스템 해양 무인체계 경력직 공고', id: 'job-career' }, body);
}

export function render({ data }) {
  const j = data.job ?? {};
  return h('div', { class: 'job' },
    h('h1', null, tabLabel('job')),
    jdBlock(j),
    translatedBlock(j.jd_translated),
    unmannedBlock(j.unmanned_extension),
    vocabBlock(j.se_practice_vocab),
    careerBlock(j.career_posting_hanwha_systems));
}
