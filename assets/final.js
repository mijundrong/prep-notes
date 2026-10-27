// 최종 보고서 — 면접 전날·당일 30분 안에 읽는 내 공부 문서(독자는 나 혼자). claude.ai판에서만 만든다.
// Claude 호출은 한 번(complex, sample.json, cache 없음). Claude는 섹션별 필드(s1~s8)로 근거·짧은 정리·질문·할 일만 내고,
// Markdown은 코드가 조립한다. 1·5섹션의 내 문단과 3섹션의 내 메모는 저장된 원문을 코드가 그대로 끼워 넣는다.
// Claude가 쓰거나 고른 부분은 "Claude 보고서" 보라색 칸으로 묶어 내 글·자료 원문과 구분한다.
// 인용은 모두 내 답의 부분 문자열인지 확인하고, 없는 카드 id·없는 근거를 가리킨 것은 버린다.
// 분량(인쇄 6~8쪽)은 섹션마다 개수·글자 수 상한으로 코드가 맞춘다 — 내 문단과 메모만은 자르지 않는다.
// DOM을 모른다 — 화면은 views/final.js.

import * as ai from './ai.js';
import * as store from './store.js';
import * as weave from './weave.js';
import { locateIn } from './quote.js';
import {
  AXES, AXIS_INFO, IDENTITY_KEYS, IDENTITY_LABEL, liveClusters, clusterName, positioningTargets, hashText,
} from './weave-model.js';

export const SECTIONS = ['나는 어떤 사람인가', '경험 지도', '직무 커버리지 지도', '회사와 나의 접점', '왜 이 직무 / 왜 이 회사 / 왜 나', '면접관이 먼저 파고들 곳 10개', '면접 전에 할 일', '포지셔닝'];
const QUESTIONS = 10;
const IDENTITY_SECTION5 = ['whyJob', 'whyCompany', 'whyMe'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
// 한 줄로, n자를 넘으면 자르고 말줄임표
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => {
  const t = Array.from(one(s));
  return t.length > n ? `${t.slice(0, n - 1).join('')}…` : t.join('');
};
// Markdown 기호 이스케이프 (표·목록·굵게·링크가 깨지지 않게). 원문 그대로 넣는 내 글은 인용 블록에 이스케이프 없이 넣는다.
const esc = (s) => one(s).replace(/[\\`*_[\]|<>#]/g, '\\$&');

// ---- 재료 ----

export function readiness() {
  const missing = [];
  if (!AXES.every((axis) => store.weaveDim(axis)?.at) || !store.weaveThread()) missing.push('엮기 결과');
  if (!store.lens()?.result) missing.push('렌즈 결과');
  const empty = IDENTITY_KEYS.filter((k) => !store.identityText(k).trim());
  if (empty.length) missing.push(`정의하기 ${empty.map((k) => IDENTITY_LABEL[k]).join('·')}`);
  return { ready: !missing.length, missing };
}

// 받아들인 내 버전이 있으면 그것, 없으면 원문
function positioningNow(data) {
  return positioningTargets(data).map((t) => ({ ...t, mine: Boolean(store.myPositioning(t.target)), text: store.myPositioning(t.target)?.text ?? t.text }));
}

// 보고서가 본 재료의 지문 — 바뀌면 화면에 "이 보고서 이후 바뀐 재료가 있습니다"
export function basisNow(data) {
  return hashText(JSON.stringify([
    AXES.map((axis) => store.weaveDim(axis)?.at ?? null),
    store.weaveThread()?.at ?? null,
    store.lens()?.at ?? null,
    Object.entries(store.lens()?.myNotes ?? {}).map(([k, v]) => [k, v.text]),
    IDENTITY_KEYS.map((k) => store.identityText(k)),
    positioningNow(data).filter((t) => t.mine).map((t) => [t.target, t.text]),
    (data.pressure ?? []).map((p) => hashText(store.pressure(p.id)?.text ?? '')),
    (data.cards ?? []).map((c) => [c.id, store.cardStatus(c.id), store.answeredCount(c.id)]),
    (data.positioning?.to_confirm ?? []).map((_, i) => Boolean(store.toConfirm(i)?.done)),
  ]));
}

export function finalContext(data) {
  const lens = store.lens()?.result ?? { coverage: [], company_touch: [], apply_material: [] };
  const thread = store.weaveThread()?.result ?? { chains: [], timeline: [], gaps: [] };
  const now = data.positioning?.company_now ?? {};
  // 근거 번호: J(JD 업무) · G(엮기의 빈 곳) · K(회사 축) · T(확인할 것)
  const refs = new Map();
  lens.coverage.forEach((r, i) => refs.set(`J${i + 1}`, { kind: 'jd', text: r.jd }));
  thread.gaps.forEach((g, i) => refs.set(`G${i + 1}`, { kind: 'gap', text: g.note }));
  lens.company_touch.forEach((t, i) => refs.set(`K${i + 1}`, { kind: 'axis', text: t.axis }));
  const toConfirm = (data.positioning?.to_confirm ?? []).map((text, i) => ({ id: `T${i + 1}`, text, done: Boolean(store.toConfirm(i)?.done) }));
  for (const t of toConfirm) refs.set(t.id, { kind: 'confirm', text: t.text });
  return {
    data,
    lens,
    thread,
    refs,
    toConfirm,
    clusters: Object.fromEntries(AXES.map((axis) => [axis, liveClusters(store.weaveDim(axis))])),
    identity: Object.fromEntries(IDENTITY_KEYS.map((k) => [k, store.identityText(k)])),
    notes: Object.fromEntries(lens.coverage.map((r) => [r.jd, store.lensNote(r.jd)])),
    pressure: (data.pressure ?? []).map((p) => ({ id: p.id, title: p.title ?? '', answer: store.pressure(p.id)?.text ?? '' })).filter((p) => p.answer.trim()),
    answerTexts: weave.answerTextsOf(data),
    chainNames: new Set(thread.chains.map((c) => c.name)),
    jdTexts: [...(data.job?.jd_raw ?? []), ...(data.job?.jd_translated ?? []).map((t) => t.jd)].filter(nonEmpty),
    companyTexts: [...(now.axes ?? []).flatMap((a) => [a.axis, a.what]), now.compressed].filter(nonEmpty),
    axisWhat: new Map((now.axes ?? []).map((a) => [a.axis, a.what ?? ''])),
    defenseTopics: new Set((data.defense ?? []).map((d) => d.topic).filter(nonEmpty)),
    positioning: positioningNow(data),
    basisHash: basisNow(data),
  };
}

// ---- 지시문 ----

export function finalPrompt(ctx, pressure = ctx.pressure) {
  const { data } = ctx;
  const head = [
    '너는 한 지원자가 면접 전날과 당일 30분 안에 읽을 자기 공부 문서를 함께 정리하는 정리자다. 독자는 그 사람 혼자다. 공백·약점·하지 말 말도 솔직하게 짚는다.',
    '그의 경험을 평가하거나 고쳐 쓰지 않고, 그의 경험의 의미를 대신 쓰지 않는다. [내 정의 — 지원자가 쓴 네 문단]은 고치거나 요약하거나 다시 쓰지 마라 — 그 문단은 문서에 원문 그대로 들어간다. 너는 각 문단을 받치는 근거(인용·흐름·자료)만 고른다.',
    '인용은 그의 글에서 글자 그대로 가져온다. 그의 글에 없는 사실·수치·역할을 만들지 않는다. 지정된 JSON만 출력하라.',
  ].join(' ');
  const rules = [
    '[섹션별로 쓸 것]',
    '- s1 (나는 어떤 사람인가): chains에는 첫 문단을 받치는 반복 흐름 이름([흐름]의 name 그대로, 3개 이내), evidence에는 근거 경험 인용(4개 이내), note에는 문단과 근거를 잇는 짧은 정리(150자 이내).',
    '- s2·s3·s4 (경험 지도·직무 커버리지 지도·회사와 나의 접점): 표는 코드가 만든다. note에 표를 읽기 전에 볼 요약 한두 문장(150자 이내)만.',
    '- s5 (왜 이 직무 / 왜 이 회사 / 왜 나): whyJob·whyCompany·whyMe 각각 그 문단을 받치는 근거만. evidence(3개 이내), whyJob.jd에는 [JD 업무]·[JD 원문]의 문장 일부 그대로(2개 이내), whyCompany.company에는 [회사 축]·[회사 국면 요약]의 문장 일부 그대로(2개 이내), whyMe.chains에는 흐름 이름. note 110자 이내.',
    `- s6 (면접관이 가장 먼저 파고들 곳): 질문 ${QUESTIONS}개, 먼저 나올 순서로. q는 면접관이 실제로 할 말투로 60자 이내, why는 왜 여기를 파고드는지 60자 이내. refs에는 근거가 된 번호(J: JD 업무, G: 빈 곳, K: 회사 축, T: 확인할 것). evidence에는 그 질문을 부르는 그의 답 인용(2개 이내). refs와 evidence가 모두 비거나 틀리면 그 질문은 버려진다. answered에는 그가 이 질문에 쓸 답을 이미 써 둔 곳 — 카드면 {"id":"A1","q":"why|what|learned|apply"}, 압박 문항이면 {"id":"P1"} — 없으면 null. defense에는 이 질문에 답할 때 걸리기 쉬운 [방어선]의 주제 이름 그대로(2개 이내, 없으면 빈 배열).`,
    '- s7 (면접 전에 할 일): fill에는 면접 전에 메울 공백(what 60자 이내, refs). confirm에는 [빈 곳]에서 확인할 것의 G번호(3개 이내). practice에는 s6 질문 번호(1부터)를 말로 연습할 순서대로.',
    '- s8 (포지셔닝): note에 [포지셔닝]과 위 내용이 이어지는 곳 한두 문장(110자 이내).',
  ].join('\n');
  const format = [
    '[출력 형식] JSON 객체 하나만. 설명이나 코드 울타리 없이.',
    JSON.stringify({
      s1: { chains: ['(흐름 이름)'], evidence: [{ cardId: 'A1', quote: '(그대로)' }], note: '(150자 이내)' },
      s2: { note: '(150자 이내)' },
      s3: { note: '(150자 이내)' },
      s4: { note: '(150자 이내)' },
      s5: {
        whyJob: { evidence: [{ cardId: 'A1', quote: '(그대로)' }], jd: ['(JD 문장 일부 그대로)'], note: '(110자 이내)' },
        whyCompany: { evidence: [{ cardId: 'A1', quote: '(그대로)' }], company: ['(회사 자료 문장 일부 그대로)'], note: '(110자 이내)' },
        whyMe: { evidence: [{ cardId: 'A1', quote: '(그대로)' }], chains: ['(흐름 이름)'], note: '(110자 이내)' },
      },
      s6: { questions: [{ q: '(60자 이내)', why: '(60자 이내)', refs: ['J3', 'G1'], evidence: [{ cardId: 'A1', quote: '(그대로)' }], answered: { id: 'A1', q: 'apply' }, defense: ['(방어선 주제)'] }] },
      s7: { fill: [{ what: '(60자 이내)', refs: ['J3'] }], confirm: ['G1'], practice: [3, 1, 2] },
      s8: { note: '(110자 이내)' },
    }),
  ].join('\n');
  const identity = IDENTITY_KEYS.map((k) => `### ${IDENTITY_LABEL[k]}\n"""\n${ctx.identity[k]}\n"""`).join('\n\n');
  const clusters = AXES.map((axis) => {
    const lines = ctx.clusters[axis].map((c) => JSON.stringify({
      name: clusterName(c),
      ...(c.myMeaning.trim() ? { myMeaning: cut(c.myMeaning, 300) } : {}),
      members: c.members.map((m) => ({ cardId: m.cardId, quote: weave.memberQuote(axis, m) })),
    }));
    return `## ${AXIS_INFO[axis].label} (${weave.questionLabel(data, axis)} · ${AXIS_INFO[axis].meaning})\n${lines.join('\n') || '(묶음 없음)'}`;
  }).join('\n');
  const chains = ctx.thread.chains.map((c) => JSON.stringify({ name: c.name, pattern: c.pattern, cards: c.cards })).join('\n') || '(없음)';
  const timeline = ctx.thread.timeline.map((t) => `- ${t.stage} (${t.cards.join(', ')}): 달라진 것 ${t.shift || '—'} / 그대로인 것 ${t.kept || '—'}`).join('\n') || '(없음)';
  const gaps = ctx.thread.gaps.map((g, i) => `G${i + 1}. [${g.kind}] ${g.note} (${g.cards.join(', ')})`).join('\n') || '(없음)';
  const coverage = ctx.lens.coverage.map((r, i) => [
    `J${i + 1}. ${r.jd} — ${r.strength}`,
    r.evidence.length ? `    근거: ${r.evidence.map((q) => `${q.cardId} "${q.quote}"`).join(' / ')}` : '',
    r.next_question ? `    이어질 질문: ${r.next_question}` : '',
    r.gap_note ? `    모르는 것: ${r.gap_note}` : '',
    ctx.notes[r.jd]?.trim() ? `    지원자 메모: ${cut(ctx.notes[r.jd], 300)}` : '',
  ].filter(Boolean).join('\n')).join('\n') || '(없음)';
  const touch = ctx.lens.company_touch.map((t, i) => `K${i + 1}. ${t.axis}: ${ctx.axisWhat.get(t.axis) ?? ''} — ${t.touch}${t.note ? ` (${t.note})` : ''}`).join('\n') || '(없음)';
  const answers = pressure.map((p) => `### ${p.id} · ${p.title}\n"""\n${p.answer}\n"""`).join('\n\n') || '(없음)';
  const cards = (data.cards ?? []).map((c) => `- ${c.id} ${c.title ?? ''}: ${store.STATUS_LABEL[store.cardStatus(c.id)]}, 쓴 문항 ${store.answeredCount(c.id)}/${(c.questions ?? []).length}`).join('\n');
  const confirm = ctx.toConfirm.map((t) => `${t.id}. ${t.text} (${t.done ? '끝남' : '안 끝남'})`).join('\n') || '(없음)';
  const defense = (data.defense ?? []).map((d) => `- ${d.topic}: ❌ ${d.no} / ✅ ${d.yes}`).join('\n') || '(없음)';
  const positioning = ctx.positioning.map((t) => `- ${t.label}${t.mine ? ' (지원자가 받아들인 내 버전)' : ''}: ${t.text}`).join('\n') || '(없음)';
  return [
    head, rules, format,
    `[내 정의 — 지원자가 쓴 네 문단. 고치지 말 것]\n${identity}`,
    `[묶음 — 축별]\n${clusters}`,
    `[흐름]\n${chains}`,
    `[시간순]\n${timeline}`,
    `[빈 곳]\n${gaps}`,
    `[JD 업무 — 렌즈]\n${coverage}`,
    `[JD 원문]\n${(data.job?.jd_raw ?? []).map((t) => `- ${t}`).join('\n') || '(없음)'}`,
    `[회사 축 — 렌즈]\n${touch}`,
    `[회사 국면 요약]\n${data.positioning?.company_now?.compressed ?? '(없음)'}`,
    `[압박 문항 답]\n${answers}`,
    `[카드 상태]\n${cards}`,
    `[확인할 것]\n${confirm}`,
    `[방어선]\n${defense}`,
    `[포지셔닝]\n${positioning}`,
  ].join('\n\n');
}

// ---- 검증 ----

export function validateFinal(raw, ctx) {
  const obj = isObj(raw) ? raw : {};
  const dropped = { quotes: 0, refs: 0, questions: 0, other: 0 };
  const sec = (k) => (isObj(obj[k]) ? obj[k] : {});
  const quote = (q) => {
    const hit = isObj(q) && ctx.answerTexts.has(q.cardId) ? locateIn(ctx.answerTexts.get(q.cardId), q.quote) : null;
    if (!hit) dropped.quotes += 1;
    return hit ? { cardId: q.cardId, quote: hit } : null;
  };
  const quotes = (list, n) => arr(list).map(quote).filter(Boolean).slice(0, n);
  const chains = (list, n) => [...new Set(arr(list).filter((x) => {
    const ok = typeof x === 'string' && ctx.chainNames.has(x);
    if (!ok) dropped.other += 1;
    return ok;
  }))].slice(0, n);
  const fragments = (list, texts, n) => arr(list).map((x) => {
    const hit = locateIn(texts, str(x));
    if (!hit) dropped.other += 1;
    return hit;
  }).filter(Boolean).slice(0, n);
  const refs = (list) => [...new Set(arr(list).filter((x) => {
    const ok = typeof x === 'string' && ctx.refs.has(x);
    if (!ok) dropped.refs += 1;
    return ok;
  }))];
  const cards = new Map((ctx.data.cards ?? []).map((c) => [c.id, c]));
  const answered = (a) => {
    if (!isObj(a) || typeof a.id !== 'string') return null;
    if (cards.has(a.id)) {
      const keys = AXES.filter((k) => store.answerText(a.id, k).trim());
      if (!keys.length) return null;
      return { type: 'card', id: a.id, q: keys.includes(a.q) ? a.q : null };
    }
    return ctx.pressure.some((p) => p.id === a.id) ? { type: 'pressure', id: a.id } : null;
  };
  const topics = (list) => [...new Set(arr(list).filter((t) => typeof t === 'string' && ctx.defenseTopics.has(t)))].slice(0, 2);

  const s5 = {};
  for (const k of IDENTITY_SECTION5) {
    const p = isObj(sec('s5')[k]) ? sec('s5')[k] : {};
    s5[k] = {
      evidence: quotes(p.evidence, 3),
      jd: k === 'whyJob' ? fragments(p.jd, ctx.jdTexts, 2) : [],
      company: k === 'whyCompany' ? fragments(p.company, ctx.companyTexts, 2) : [],
      chains: k === 'whyMe' ? chains(p.chains, 2) : [],
      note: str(p.note),
    };
  }
  const questions = [];
  // Claude가 매긴 질문 번호(1부터) → 남은 질문 번호 (연습 순서를 옮길 때)
  const renumber = new Map();
  arr(sec('s6').questions).forEach((q, i) => {
    if (!isObj(q) || !str(q.q)) {
      dropped.questions += 1;
      return;
    }
    const r = refs(q.refs);
    const evidence = quotes(q.evidence, 2);
    if (!r.length && !evidence.length) {
      dropped.questions += 1;
      return;
    }
    if (questions.length >= QUESTIONS) return;
    questions.push({ q: str(q.q), why: str(q.why), refs: r, evidence, answered: answered(q.answered), defense: topics(q.defense) });
    renumber.set(i + 1, questions.length);
  });
  const result = {
    s1: { chains: chains(sec('s1').chains, 3), evidence: quotes(sec('s1').evidence, 4), note: str(sec('s1').note) },
    s2: { note: str(sec('s2').note) },
    s3: { note: str(sec('s3').note) },
    s4: { note: str(sec('s4').note) },
    s5,
    s6: { questions },
    s7: {
      fill: arr(sec('s7').fill).filter((f) => isObj(f) && str(f.what)).slice(0, 5).map((f) => ({ what: str(f.what), refs: refs(f.refs) })),
      gaps: refs(sec('s7').confirm).filter((id) => id.startsWith('G')).slice(0, 3),
      practice: [...new Set(arr(sec('s7').practice).map((n) => renumber.get(Number(n))).filter(Boolean))],
    },
    s8: { note: str(sec('s8').note) },
  };
  return { result, dropped };
}

// ---- Markdown 조립 ----

const lines = (...parts) => parts.flat(Infinity).filter((p) => p !== null && p !== undefined && p !== '');
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') : '');
// 내 글은 원문 그대로: 줄마다 "> "만 붙이고 아무것도 바꾸지 않는다
const verbatim = (text) => text.split('\n').map((l) => `> ${l}`).join('\n');
const quoted = (q, n) => `“${esc(cut(q.quote, n))}”(${esc(q.cardId)})`;
const noteLine = (text, n) => (nonEmpty(text) ? `**정리** ${esc(cut(text, n))}` : '');
// Claude가 쓰거나 고른 부분은 ":::claude … :::"로 감싼다 — 화면·HTML에서는 "Claude 보고서" 보라색 칸, Markdown 복사에서는 머리표 한 줄.
// 내 문단·메모(인용 블록)와 자료 원문은 칸 밖에 둔다. 비어 있으면 칸도 만들지 않는다.
export const CLAUDE_TAG = 'Claude 보고서';
const claude = (...parts) => {
  const body = lines(...parts);
  return body.length ? [':::claude', ...body, ':::'] : '';
};

function titleOf(ctx, id) {
  const c = (ctx.data.cards ?? []).find((x) => x.id === id) ?? (ctx.data.pressure ?? []).find((x) => x.id === id);
  return c ? cut(c.title ?? '', 24) : '';
}

function refLabel(ctx, id) {
  const r = ctx.refs.get(id);
  if (!r) return '';
  const head = { jd: 'JD', gap: '빈 곳', axis: '회사', confirm: '확인' }[r.kind];
  return `${head}: ${cut(r.text, r.kind === 'axis' ? 14 : 20)}`;
}

// 써 둔 답으로 가는 링크 (화면에서는 그 칸으로, Markdown 복사·HTML 저장에서는 글자만)
function answeredLink(a) {
  if (!a) return '없음';
  if (a.type === 'pressure') return `[${a.id} 압박 문항](#/pressure/${encodeURIComponent(a.id)})`;
  const label = a.q ? `${a.id} ${AXIS_INFO[a.q].label}` : `${a.id} 카드`;
  return `[${label}](#/cards/${encodeURIComponent(a.id)}${a.q ? ` "${a.q}"` : ''})`;
}

const when = (iso) => (iso ? store.formatStamp(new Date(iso)) : '—');

// 경험 지도에 올릴 묶음: 내 이름·내 의미가 있는 것 먼저, 그다음 경험이 많은 것 (축마다 4개까지)
function mapClusters(list) {
  const score = (c) => (c.myMeaning.trim() ? 2 : 0) + (c.myName.trim() ? 1 : 0);
  return [...list].sort((x, y) => score(y) - score(x) || y.members.length - x.members.length).slice(0, 4);
}

export function assemble(ctx, r, at = new Date()) {
  const { data } = ctx;
  const head = lines(
    `# 최종 보고서${nonEmpty(data.meta?.title) ? ` — ${esc(data.meta.title)}` : ''}`,
    `생성 ${store.formatStamp(at)} · 엮기 ${when(store.weaveThread()?.at)} · 렌즈 ${when(store.lens()?.at)} · 내 문단과 메모는 원문 그대로, 나머지는 Claude가 내 답과 자료에서 골라 정리한 것`,
  );
  const section = (n, ...body) => lines(`## ${n}. ${SECTIONS[n - 1]}`, ...body).join('\n\n');

  const chainsBy = new Map(ctx.thread.chains.map((c) => [c.name, c]));
  const s1 = section(1,
    verbatim(ctx.identity.whoAmI),
    claude(
      r.s1.chains.length ? ['**받치는 흐름**', r.s1.chains.map((name) => `- **${esc(name)}** — ${esc(cut(chainsBy.get(name)?.pattern ?? '', 70))}`).join('\n')] : '',
      r.s1.evidence.length ? ['**근거 경험**', r.s1.evidence.map((q) => `- ${quoted(q, 60)} ${esc(titleOf(ctx, q.cardId))}`).join('\n')] : '',
      noteLine(r.s1.note, 150)));

  const clusterRows = AXES.flatMap((axis) => mapClusters(ctx.clusters[axis]).map((c) => [
    AXIS_INFO[axis].label,
    esc(cut(clusterName(c), 20)) + (c.myName.trim() ? '' : ' (Claude 이름)'),
    c.myMeaning.trim() ? esc(cut(c.myMeaning, 50)) : '—',
    esc(c.members.slice(0, 6).map((m) => m.cardId).join(', ') + (c.members.length > 6 ? ` 외 ${c.members.length - 6}` : '')),
  ]));
  const s2 = section(2,
    claude(noteLine(r.s2.note, 150)),
    table(['축', '묶음', '내 의미', '경험'], clusterRows),
    claude(
      ctx.thread.chains.length ? ['**반복되는 흐름**', ctx.thread.chains.slice(0, 4).map((c) => `- **${esc(cut(c.name, 20))}** — ${esc(cut(c.pattern, 70))}`).join('\n')] : '',
      ctx.thread.timeline.length ? ['**시간에 따른 변화**', table(['시기', '달라진 것', '그대로인 것'], ctx.thread.timeline.slice(0, 5).map((t) => [esc(cut(t.stage, 12)), esc(cut(t.shift, 40)) || '—', esc(cut(t.kept, 40)) || '—']))] : ''));

  const coverageRows = ctx.lens.coverage.map((row) => [
    esc(row.jd),
    esc(row.strength),
    [row.evidence[0] ? quoted(row.evidence[0], 36) : '', nonEmpty(row.gap_note) ? `모르는 것: ${esc(cut(row.gap_note, 40))}` : ''].filter(Boolean).join(' · ') || '—',
    nonEmpty(row.next_question) ? esc(cut(row.next_question, 50)) : '—',
  ]);
  const noted = ctx.lens.coverage.filter((row) => nonEmpty(ctx.notes[row.jd]));
  const s3 = section(3,
    claude(noteLine(r.s3.note, 150), table(['JD 업무', '강도', '내 근거', '이어질 질문'], coverageRows)),
    noted.length ? ['**내 메모 — 이 공백을 어떻게 말할지**', ...noted.map((row) => [`**${esc(row.jd)}** — ${esc(row.strength)}`, verbatim(ctx.notes[row.jd])])] : '');

  const s4 = section(4,
    claude(noteLine(r.s4.note, 150), table(['회사 축', '닿음', '근거', '메모'], ctx.lens.company_touch.map((t) => [
      esc(t.axis), esc(t.touch), t.evidence[0] ? quoted(t.evidence[0], 36) : '—', nonEmpty(t.note) ? esc(cut(t.note, 40)) : '—',
    ]))));

  const s5 = section(5, ...IDENTITY_SECTION5.map((k) => {
    const p = r.s5[k];
    const support = [
      ...p.evidence.map((q) => `- ${quoted(q, 50)}`),
      ...p.jd.map((t) => `- JD “${esc(cut(t, 50))}”`),
      ...p.company.map((t) => `- 회사 자료 “${esc(cut(t, 50))}”`),
      ...p.chains.map((name) => `- 흐름 **${esc(name)}** — ${esc(cut(chainsBy.get(name)?.pattern ?? '', 50))}`),
    ];
    return [`### ${IDENTITY_LABEL[k]}`, verbatim(ctx.identity[k]), claude(support.length ? support.join('\n') : '', noteLine(p.note, 110))];
  }));

  const qs = r.s6.questions;
  const s6 = section(6, claude(
    qs.length < QUESTIONS ? `근거가 확인된 질문 ${qs.length}개 (근거가 없거나 맞지 않은 질문은 뺐습니다)` : '',
    table(['#', '질문', '왜·근거', '써 둔 답'], qs.map((q, i) => [
      String(i + 1),
      esc(cut(q.q, 60)),
      [nonEmpty(q.why) ? esc(cut(q.why, 60)) : '', ...q.refs.slice(0, 2).map((id) => esc(refLabel(ctx, id))), ...q.evidence.slice(0, 1).map((e) => quoted(e, 30))].filter(Boolean).join(' · '),
      answeredLink(q.answered),
    ])),
    qs.some((q) => q.defense.length) ? ['**방어선 확인** — 이 질문에 답할 때 걸리기 쉬운 주제 (방어선 탭에서 ✅ 문장 확인)', qs.map((q, i) => (q.defense.length ? `- ${i + 1}번: ${q.defense.map(esc).join(' · ')}` : '')).filter(Boolean).join('\n')] : ''));

  // 할 일 중 "확인할 것"의 미완료 항목은 자료 원문이라 칸 밖에, Claude가 고른 공백·빈 곳·연습 순서는 칸 안에
  const open = ctx.toConfirm.filter((t) => !t.done);
  const s7 = section(7,
    claude(
      r.s7.fill.length ? ['**메울 공백**', r.s7.fill.map((f) => `- ${esc(cut(f.what, 60))}${f.refs.length ? ` (${f.refs.slice(0, 2).map((id) => esc(refLabel(ctx, id))).join(' · ')})` : ''}`).join('\n')] : '',
      r.s7.gaps.length ? ['**확인할 사실 — 엮기의 빈 곳**', r.s7.gaps.map((id) => `- ${esc(cut(ctx.refs.get(id).text, 50))}`).join('\n')] : '',
      r.s7.practice.length ? ['**말로 연습할 순서**', r.s7.practice.map((n, i) => `${i + 1}. ${n}번 — ${esc(cut(qs[n - 1].q, 36))}`).join('\n')] : ''),
    open.length ? ['**확인할 사실 — 확인할 것 중 아직 안 끝난 것**', open.map((t) => `- ${esc(t.text)}`).join('\n')] : '');

  const mine = ctx.positioning.filter((t) => t.mine);
  const pillars = data.positioning?.pillars ?? [];
  const thesis = ctx.positioning.find((t) => t.target === 'thesis.core');
  const s8 = section(8,
    mine.length
      ? ['**받아들인 내 버전**', mine.map((t) => `- ${esc(t.label)}: ${esc(t.text)}`).join('\n')]
      : [thesis ? `**한 줄 명제** ${esc(thesis.text)}` : '', pillars.length ? pillars.map((p) => `- 기둥 ${store.circled(p.n)} ${esc(p.title)}`).join('\n') : ''],
    claude(noteLine(r.s8.note, 110)));

  return [head.join('\n\n'), s1, s2, s3, s4, s5, s6, s7, s8].join('\n\n') + '\n';
}

// ---- 실행 (한 번에 하나) ----

let job = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
weave.addBusyCheck(() => Boolean(job?.active));

export const state = () => job;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function start(data) {
  if (weave.busy() || !ai.available() || !readiness().ready) return false;
  const ctx = finalContext(data);
  job = { active: true, ctl: new AbortController(), error: null, startedAt: Date.now(), ms: null, chars: 0, dropped: null, cut: false };
  notify();
  Promise.resolve().then(() => {
    const { prompt, cut: shortened } = weave.fitPrompt((list) => finalPrompt(ctx, list), ctx.pressure);
    job.cut = shortened;
    return ai.askJson(prompt, { modelTier: 'complex', cache: false, signal: job.ctl.signal, onText: ({ text }) => { job.chars = text.length; notify(); } });
  }).then((raw) => {
    const checked = validateFinal(raw, ctx);
    job.dropped = checked.dropped;
    store.addReport({ basisHash: ctx.basisHash, markdown: assemble(ctx, checked.result) });
  }).catch((e) => {
    job.error = e?.code ?? 'upstream_error';
    if (!e?.code) console.error(e);
  }).finally(() => {
    job.active = false;
    job.ctl = null;
    job.ms = Date.now() - job.startedAt;
    notify();
  });
  return true;
}

export function stop() {
  job?.ctl?.abort();
}

// ---- 버전 비교: 섹션(## n.)마다 글이 달라졌는지 ----

export function sectionsOf(markdown) {
  const out = new Map();
  let n = 0;
  for (const line of markdown.split('\n')) {
    const m = /^## (\d+)\. /.exec(line);
    if (m) n = Number(m[1]);
    if (n) out.set(n, `${out.get(n) ?? ''}${line}\n`);
  }
  return out;
}

export function changedSections(markdown, previous) {
  if (!previous) return new Set();
  const a = sectionsOf(markdown);
  const b = sectionsOf(previous);
  return new Set(SECTIONS.map((_, i) => i + 1).filter((n) => (a.get(n) ?? '') !== (b.get(n) ?? '')));
}

// Markdown 복사용: 앱 안 링크는 글자만 남기고, Claude 칸은 머리표 한 줄로
export const plainMarkdown = (markdown) => markdown
  .replace(/^:::claude$/gm, `**[${CLAUDE_TAG}]**`)
  .replace(/^:::$\n?/gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\[([^\]\n]*)\]\(#\/[^)\n]*\)/g, '$1');
