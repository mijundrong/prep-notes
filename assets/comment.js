// 카드 코멘트 (claude.ai판에서만): 4문을 모두 제출하면 Claude가 그 카드의 제출본을
// 확정 사실·주의·방어선과 대조하고, 4문끼리 부딪히는 곳만 짚는다. 평가·첨삭·조언·예시 문장은 쓰지 않는다.
// 인용은 코드로 원문(제출본·확정 사실·주의)의 부분 문자열인지 확인하고, 아니면 버린다.

import * as ai from './ai.js';
import * as store from './store.js';
import { locate, locateIn } from './quote.js';
import { hashText } from './weave-model.js';

const KEYS = ['why', 'what', 'learned', 'apply'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (s, n) => (Array.from(s).length > n ? Array.from(s).slice(0, n).join('') : s);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

export const allSubmitted = (c) => KEYS.every((k) => store.submitted(c.id, k));

// 지금 제출본 { why: 글, … }
const submittedTexts = (c) => Object.fromEntries(KEYS.map((k) => [k, store.submitted(c.id, k)?.text ?? '']));

// 제출본의 지문. 코멘트의 basis와 다르면 그 코멘트는 옛 제출본 기준이다.
export function basisOf(c, texts = submittedTexts(c)) {
  return Object.fromEntries(KEYS.map((k) => [k, hashText((texts[k] ?? '').trim())]));
}

export function isStale(c) {
  const comment = store.cardComment(c.id);
  if (!comment) return false;
  const now = basisOf(c);
  return KEYS.some((k) => comment.basis[k] !== now[k]);
}

const labelOf = (c, key) => c.questions?.find((q) => q.key === key)?.label ?? key;

export function commentPrompt(data, c, texts = submittedTexts(c)) {
  const bullets = (items) => (items ?? []).filter(nonEmpty).map((t) => `- ${t}`).join('\n') || '- (없음)';
  const defense = (data.defense ?? []).map((d) => `- ${d.topic}: ❌ ${d.no} / ✅ ${d.yes}`).join('\n');
  const answers = KEYS.map((k) => `### ${k} — ${labelOf(c, k)}\n"""\n${texts[k]}\n"""`).join('\n\n');
  return [
    '너는 면접 준비 서류의 사실 대조를 하는 검토자다. 지원자의 답을 평가하거나 고쳐 쓰거나 조언하지 않는다. 잘한 점, 아쉬운 점, 고칠 방향, 예시 문장을 쓰지 않는다.',
    '아래 카드에 지원자가 제출한 4문 답을 읽고 다음 세 가지만 찾는다. 없으면 빈 목록으로 둔다. 억지로 찾지 않는다.',
    [
      '1. facts: 답의 내용이 [확정 사실]이나 [주의]와 어긋나는 곳 — 사실·숫자·역할·기간이 다르게 말해졌거나, 주의에서 하지 말라고 한 말을 한 곳.',
      '2. defense: 답에 [방어선]의 ❌ 표현과 같은 뜻의 말이 있는 곳.',
      '3. conflicts: 4문의 답끼리 서로 부딪히는 곳 — 같은 일을 서로 다른 사실·순서·역할로 말한 곳.',
    ].join('\n'),
    [
      '[규칙]',
      '- q는 "why", "what", "learned", "apply" 중 하나로, 인용한 답의 문항이다.',
      '- quote는 지원자의 답에서, against는 [확정 사실]이나 [주의]의 한 줄에서 이어진 구간을 글자 하나 바꾸지 않고 복사한다. 고쳐 쓰거나 줄이거나 말줄임표를 넣지 않는다.',
      '- topic은 [방어선]의 주제를 그대로 쓴다.',
      '- note는 무엇이 어떻게 어긋나는지만 60자 이내로 쓴다. 좋다·나쁘다·약하다 같은 평가를 하지 않는다.',
    ].join('\n'),
    [
      '[출력 형식] JSON 객체 하나만. 설명이나 코드 울타리 없이.',
      JSON.stringify({
        facts: [{ q: 'why', quote: '(답에서 그대로)', against: '(확정 사실·주의에서 그대로)', note: '(60자 이내)' }],
        defense: [{ q: 'what', quote: '(답에서 그대로)', topic: '(방어선 주제 그대로)', note: '(60자 이내)' }],
        conflicts: [{ a: { q: 'why', quote: '(그대로)' }, b: { q: 'learned', quote: '(그대로)' }, note: '(60자 이내)' }],
      }),
    ].join('\n'),
    `[카드] ${[c.id, c.group, c.title].filter(nonEmpty).join(' · ')}${nonEmpty(c.period) ? ` (${c.period})` : ''}`,
    `[확정 사실]\n${bullets(c.facts)}`,
    `[주의]\n${bullets(c.caution)}`,
    `[방어선 — 주제: ❌ 하지 않을 말 / ✅ 이렇게 말한다]\n${defense}`,
    `[제출한 답]\n${answers}`,
  ].join('\n\n');
}

// texts: 요청을 보낼 때의 제출본. 받는 사이 다시 제출해도 그때 글로 확인한다.
export function validateComment(raw, data, c, texts = submittedTexts(c)) {
  const obj = isObj(raw) ? raw : {};
  const dropped = { quotes: 0 };
  const facts = (c.facts ?? []).filter(nonEmpty);
  const cautions = (c.caution ?? []).filter(nonEmpty);
  const topics = new Set((data.defense ?? []).map((d) => d.topic));
  const mine = (v) => {
    const hit = isObj(v) && KEYS.includes(v.q) ? locate(texts[v.q], v.quote) : null;
    if (!hit) dropped.quotes += 1;
    return hit ? { q: v.q, quote: clip(hit, 300) } : null;
  };
  const result = { facts: [], defense: [], conflicts: [] };
  for (const f of arr(obj.facts)) {
    const quote = mine(f);
    if (!quote) continue;
    const fact = locateIn(facts, str(f?.against));
    const caution = fact ? null : locateIn(cautions, str(f?.against));
    if (!fact && !caution) {
      dropped.quotes += 1;
      continue;
    }
    result.facts.push({ ...quote, against: clip(fact ?? caution, 400), kind: fact ? 'fact' : 'caution', note: clip(str(f.note), 120) });
  }
  for (const d of arr(obj.defense)) {
    const quote = mine(d);
    if (!quote) continue;
    if (!topics.has(d.topic)) {
      dropped.quotes += 1;
      continue;
    }
    result.defense.push({ ...quote, topic: d.topic, note: clip(str(d.note), 120) });
  }
  for (const x of arr(obj.conflicts)) {
    const a = isObj(x) ? mine(x.a) : null;
    const b = isObj(x) ? mine(x.b) : null;
    if (!a || !b || a.q === b.q) continue;
    result.conflicts.push({ a, b, note: clip(str(x.note), 120) });
  }
  return { result, dropped };
}

// ---- 실행: 카드마다 하나, 화면을 옮겨도 계속 돈다 ----

const jobs = new Map();
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const job = (id) => jobs.get(id) ?? null;

// 4문이 모두 제출됐고 지금 제출본 기준 코멘트가 없을 때만 부른다. force면 같은 제출본이어도 다시 받는다.
export function request(data, c, { force = false } = {}) {
  if (!ai.available() || !allSubmitted(c) || jobs.get(c.id)?.active) return;
  if (!force && store.cardComment(c.id) && !isStale(c)) return;
  const texts = submittedTexts(c);
  const basis = basisOf(c, texts);
  const current = { active: true, ctl: new AbortController(), error: null, startedAt: Date.now(), chars: 0, dropped: null };
  jobs.set(c.id, current);
  notify();
  const options = {
    modelTier: 'default',
    signal: current.ctl.signal,
    onText: ({ text }) => {
      current.chars = text.length;
      notify();
    },
  };
  // 같은 제출본으로 다시 받을 때만 저장된 답을 쓰지 않는다 (cache는 true/false/객체만 받는다).
  if (force) options.cache = false;
  ai.askJson(commentPrompt(data, c, texts), options).then((raw) => {
    const checked = validateComment(raw, data, c, texts);
    current.dropped = checked.dropped;
    store.setCardComment(c.id, { result: checked.result, basis });
  }, (e) => {
    current.error = e?.code ?? 'upstream_error';
  }).finally(() => {
    current.active = false;
    current.ctl = null;
    notify();
  });
}

export function stop(id) {
  jobs.get(id)?.ctl?.abort();
}
