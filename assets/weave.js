// 엮기 — 내가 쓴 답 전체를 가로로 다시 읽어 비슷한 경험끼리 묶고(축마다 1회), 묶음을 실로 꿰고(1회),
// 엮어 낸 경험을 JD와 회사 국면에 비춘다(렌즈 1회).
// Claude는 묶고, 내 말을 인용하고, 공통점을 한 줄로 짚는 데서 멈춘다. 의미와 정의 네 문단은 내가 쓴다.
// Claude가 인용한 구간은 코드로 내 답의 부분 문자열인지 확인하고, 아니면 버린다.
// DOM을 모른다 — 화면은 views/weave.js. claude.ai판에서만 쓴다(ai.available()).

import * as ai from './ai.js';
import * as store from './store.js';
import { locate, locateIn, trimQuote } from './quote.js';
import {
  AXES, AXIS_INFO, CLUSTER_TYPES, GAP_KINDS, IDENTITY_KEYS, IDENTITY_LABEL, LENS_STRENGTHS, LENS_TOUCHES, NO_RESULT,
  basisOf, changedCount, liveClusters, clusterName, positioningTargets, hashText,
} from './weave-model.js';

export const MIN_ANSWERS = 5;
// sample 입력 한도는 256 KiB. 지시문과 형식 설명이 들어갈 자리를 남긴다.
const MAX_PROMPT_BYTES = 240 * 1024;
const MIN_CUT = 200;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (s, n) => (Array.from(s).length > n ? Array.from(s).slice(0, n).join('') : s);
const bytes = (s) => new TextEncoder().encode(s).length;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// ---- 재료 ----

export const questionLabel = (data, axis) => data.cards?.[0]?.questions?.find((q) => q.key === axis)?.label
  ?? data.meta?.q4?.[AXES.indexOf(axis)] ?? axis;

export function axisEntries(data, axis) {
  return (data.cards ?? []).map((c) => [c.id, store.answerText(c.id, axis)]).filter(([, t]) => t.trim());
}

export function pressureEntries(data) {
  return (data.pressure ?? []).map((p) => [p.id, store.pressure(p.id)?.text ?? '']).filter(([, t]) => t.trim());
}

export function changedSinceWeave(data) {
  let n = 0;
  let ran = false;
  for (const axis of AXES) {
    const dim = store.weaveDim(axis);
    if (!dim?.at) continue;
    ran = true;
    n += changedCount(dim.basis, axisEntries(data, axis));
  }
  const thread = store.weaveThread();
  if (thread?.at) {
    ran = true;
    n += changedCount(thread.basis, pressureEntries(data));
  }
  return ran ? n : null;
}

export function materialStatus(data) {
  const counts = Object.fromEntries(AXES.map((axis) => [axis, axisEntries(data, axis).length]));
  const short = AXES.filter((axis) => counts[axis] < MIN_ANSWERS);
  return {
    counts,
    total: (data.cards ?? []).length,
    pressure: pressureEntries(data).length,
    pressureTotal: (data.pressure ?? []).length,
    changed: changedSinceWeave(data),
    short,
    ready: short.length === 0,
  };
}

// ---- 1단계: 축별 묶기 ----

function bindingCards(data, axis) {
  return (data.cards ?? []).map((c) => ({
    cardId: c.id, title: c.title ?? '', group: c.group ?? '', period: c.period ?? '', answer: store.answerText(c.id, axis),
  })).filter((c) => c.answer.trim());
}

const keepOf = (dim) => liveClusters(dim).filter((c) => c.locked || c.origin === 'me');

export function bindingPrompt(data, axis, cards, keep) {
  const info = AXIS_INFO[axis];
  const head = [
    '너는 한 사람의 경험 기록을 읽고 비슷한 것끼리 묶는 정리자다. 평가하거나 고치거나 조언하지 않는다.',
    `아래는 그가 여러 경험에 대해 "${questionLabel(data, axis)}"에 답한 글이다. 이 질문은 ${info.meaning}을 묻는다 — 답을 가로로 모으면 "${info.sees}"가 보인다.`,
    '같은 류의 답이 나온 경험끼리 묶어라. 묶음 이름은 가능하면 그의 표현에서 따오고, 공통점은 한 줄로만 짚어라. 인용은 반드시 그의 글에서 글자 그대로 가져와라. 그의 글에 없는 동기·감정·성과를 추측해 덧붙이지 마라. 어디에도 안 묶이는 경험과, 서로 어긋나는 답도 숨기지 말고 따로 표시하라. 지정된 JSON만 출력하라.',
  ].join('\n');
  const rules = [
    '[규칙]',
    '- 묶음 하나에는 경험이 2개 이상 들어간다. 한 경험이 여러 묶음에 들어가도 된다. 묶음은 2~6개 정도가 알맞다.',
    `- type은 ${CLUSTER_TYPES.map((t) => `"${t}"`).join(', ')} 중 하나.`,
    '- name은 12자 이내, 가능하면 그의 글에 나온 말로. thread는 공통점 한 줄, 60자 이내.',
    '- quote는 그 경험의 답에서 이어진 한 구간을 글자 하나 바꾸지 않고 복사한다(60자 이내). 고쳐 쓰거나 합치거나 말줄임표를 넣지 않는다.',
    '- loners는 어디에도 묶이지 않는 경험, why는 그 이유 40자 이내. tensions는 서로 어긋나는 두 답, note는 어떻게 어긋나는지 60자 이내.',
    '- cardId는 [답한 경험]에 있는 것만 쓴다.',
    keep.length ? '- [이미 정한 묶음]은 그가 정해 둔 것이다. 다시 내보내지 말고 그 밖의 묶음만 만든다. 그 경험들을 새 묶음에 함께 넣는 것은 괜찮다.' : '',
  ].filter(Boolean).join('\n');
  const format = [
    '[출력 형식] JSON 객체 하나만. 설명이나 코드 울타리 없이.',
    JSON.stringify({
      clusters: [{ id: 'c1', type: info.type, name: '(12자 이내)', thread: '(공통점 한 줄)', members: [{ cardId: 'A1', quote: '(답에서 그대로 복사한 구간)' }, { cardId: 'B1', quote: '(답에서 그대로 복사한 구간)' }] }],
      loners: [{ cardId: 'C1', why: '(40자 이내)' }],
      tensions: [{ a: { cardId: 'A1', quote: '(그대로)' }, b: { cardId: 'D1', quote: '(그대로)' }, note: '(60자 이내)' }],
    }),
  ].join('\n');
  const kept = keep.length
    ? keep.map((c) => JSON.stringify({ id: c.id, myName: clusterName(c), members: c.members.map((m) => m.cardId) })).join('\n')
    : '(없음)';
  const body = cards.map((c) => [
    `### ${[c.cardId, c.group, c.title, c.period].filter(nonEmpty).join(' · ')}`,
    '"""', c.answer, '"""',
  ].join('\n')).join('\n\n');
  return [head, rules, format, `[이미 정한 묶음]\n${kept}`, `[답한 경험 — ${cards.length}개]\n${body}`].join('\n\n');
}

export function validateBinding(raw, { axis, cards, keep }) {
  const answers = new Map(cards.map((c) => [c.cardId, c.answer]));
  const keepIds = new Set(keep.map((c) => c.id));
  const dropped = { quotes: 0, clusters: 0 };
  const obj = isObj(raw) ? raw : {};
  const clusters = [];
  const alone = [];
  for (const c of arr(obj.clusters)) {
    if (!isObj(c) || keepIds.has(c.id)) continue;
    const members = [];
    for (const m of arr(c.members)) {
      const quote = isObj(m) && answers.has(m.cardId) ? locate(answers.get(m.cardId), m.quote) : null;
      if (!quote) {
        dropped.quotes += 1;
        continue;
      }
      if (!members.some((x) => x.cardId === m.cardId)) members.push({ cardId: m.cardId, quote: clip(quote, 300) });
    }
    if (members.length >= 2) {
      clusters.push({
        type: CLUSTER_TYPES.includes(c.type) ? c.type : AXIS_INFO[axis].type,
        name: clip(str(c.name), 24),
        thread: clip(str(c.thread), 120),
        members,
      });
    } else {
      dropped.clusters += 1;
      if (members.length === 1) alone.push(members[0].cardId);
    }
  }
  const placed = new Set([...clusters, ...keep].flatMap((c) => c.members.map((m) => m.cardId)));
  const loners = [];
  for (const l of arr(obj.loners)) {
    if (!isObj(l) || !answers.has(l.cardId) || placed.has(l.cardId) || loners.some((x) => x.cardId === l.cardId)) continue;
    loners.push({ cardId: l.cardId, why: clip(str(l.why), 80), auto: false });
  }
  for (const id of alone) {
    if (!placed.has(id) && !loners.some((x) => x.cardId === id)) loners.push({ cardId: id, why: '', auto: true });
  }
  const tensions = [];
  for (const t of arr(obj.tensions)) {
    const side = (q) => (isObj(q) && answers.has(q.cardId) ? locate(answers.get(q.cardId), q.quote) : null);
    const a = isObj(t) ? side(t.a) : null;
    const b = isObj(t) ? side(t.b) : null;
    if (!a || !b || t.a.cardId === t.b.cardId) {
      dropped.quotes += 1;
      continue;
    }
    tensions.push({ a: { cardId: t.a.cardId, quote: clip(a, 300) }, b: { cardId: t.b.cardId, quote: clip(b, 300) }, note: clip(str(t.note), 120) });
  }
  return { clusters, loners, tensions, dropped };
}

// 답을 그대로 보내되, 한도를 넘으면 가장 긴 답부터 줄인다. 인용은 줄이기 전 원문으로 확인하므로 그대로 맞는다.
export function fitPrompt(build, items, key = 'answer') {
  const list = items.map((it) => ({ ...it }));
  let prompt = build(list);
  let cut = false;
  while (bytes(prompt) > MAX_PROMPT_BYTES) {
    const longest = list.reduce((a, b) => (Array.from(b[key]).length > Array.from(a[key]).length ? b : a), list[0]);
    const len = longest ? Array.from(longest[key]).length : 0;
    if (len <= MIN_CUT) throw { code: 'prompt_too_large', text: '' };
    longest[key] = `${Array.from(longest[key]).slice(0, Math.floor(len * 0.8)).join('')} (…이하 생략)`;
    cut = true;
    prompt = build(list);
  }
  return { prompt, cut };
}

// ---- 2단계: 엮기 ----

function threadContext(data) {
  const clusters = Object.fromEntries(AXES.map((axis) => [axis, liveClusters(store.weaveDim(axis)).filter((c) => c.members.length)]));
  const answerTexts = new Map();
  for (const c of data.cards ?? []) answerTexts.set(c.id, AXES.map((axis) => store.answerText(c.id, axis)).filter((t) => t.trim()));
  const pressure = (data.pressure ?? []).map((p) => ({ id: p.id, title: p.title ?? '', answer: store.pressure(p.id)?.text ?? '' })).filter((p) => p.answer.trim());
  for (const p of pressure) answerTexts.set(p.id, [p.answer]);
  const job = data.job ?? {};
  const jdTexts = [...(job.jd_raw ?? []), ...(job.jd_translated ?? []).map((t) => t.jd)].filter(nonEmpty);
  const now = data.positioning?.company_now ?? {};
  const companyLines = [...(now.axes ?? []).map((a) => [a.axis, a.what].filter(nonEmpty).join(': ')), now.compressed].filter(nonEmpty);
  const companyTexts = [...(now.axes ?? []).flatMap((a) => [a.axis, a.what]), now.compressed, ...companyLines].filter(nonEmpty);
  return { clusters, answerTexts, pressure, jdTexts, companyLines, companyTexts };
}

// 손으로 넣은 멤버는 인용이 없으니, 그 축 답의 앞부분을 대신 보낸다 (내 답의 일부라 인용 재료로 써도 된다).
export const memberQuote = (axis, m) => m.quote || clip(store.answerText(m.cardId, axis).trim(), 60);

// 카드 4문 답과 압박 문항 답 — 인용을 확인하는 원문
export function answerTextsOf(data) {
  const texts = new Map();
  for (const c of data.cards ?? []) texts.set(c.id, AXES.map((axis) => store.answerText(c.id, axis)).filter((t) => t.trim()));
  for (const p of data.pressure ?? []) texts.set(p.id, [store.pressure(p.id)?.text ?? ''].filter((t) => t.trim()));
  return texts;
}

export function threadPrompt(data, ctx, pressure = ctx.pressure) {
  const head = '너는 같은 사람의 경험 묶음을 축(동기·행동·배움·기여)을 가로질러 연결하는 정리자다. 같은 모양으로 반복되는 동기→행동→배움→기여 흐름을 찾고, 시간순으로 무엇이 바뀌고 무엇이 그대로였는지 짚어라. 근거가 하나뿐인 모습이나 축 사이가 끊긴 곳도 표시하라. 마지막 네 질문(나는 어떤 사람인가 / 왜 이 직무 / 왜 이 회사 / 왜 나)에는 재료만 모아라 — 완성 문장을 쓰지 마라. 직무·회사 자료와 연결할 때는 자료의 문장을 그대로 인용하라. 지정된 JSON만 출력하라.';
  const rules = [
    '[규칙]',
    '- 그를 평가하거나 조언하지 않는다. 그의 글에 없는 동기·감정·성과를 덧붙이지 않는다.',
    '- chains: 여러 축을 잇는 반복 흐름. name 20자 이내, pattern은 "동기 → 행동 → 배움 → 기여" 모양의 한 줄(80자 이내). links에는 [묶음]의 axis와 id를 그대로 쓴다. cards는 그 흐름에 든 경험 id.',
    '- timeline: [경험 목록]의 기간을 보고 시기별로 나눈다. stage는 "1학년", "군 복무", "복학 후", "캡스톤"처럼 짧게. shift(무엇이 달라졌나)와 kept(무엇이 그대로였나)는 각각 60자 이내.',
    `- gaps: kind는 ${GAP_KINDS.map((k) => `"${k}"`).join(', ')} 중 하나, note 60자 이내.`,
    '- 모든 quote는 [묶음]의 인용이나 [압박 문항 답]에서 글자 그대로 복사한다. cardId는 그 글이 나온 경험의 id(카드는 A1 같은 id, 압박 문항은 P1 같은 id).',
    '- jd는 [직무 자료]의 문장 일부를, company는 [회사 자료]의 문장 일부를 글자 그대로 복사한다.',
    '- identity_material에는 재료(인용과 대응)만 넣고 완성 문장을 쓰지 않는다. whyMe.rare만 다른 지원자에게 드문 조합을 한 줄(80자 이내)로 짚는다. whoAmI.chains와 whyMe.chains에는 chains의 name을 그대로 쓴다.',
  ].join('\n');
  const format = [
    '[출력 형식] JSON 객체 하나만. 설명이나 코드 울타리 없이.',
    JSON.stringify({
      chains: [{ name: '(20자 이내)', pattern: '(동기 → 행동 → 배움 → 기여)', links: [{ axis: 'why', clusterId: '(묶음 id)' }], cards: ['A1'], evidence: [{ cardId: 'A1', quote: '(그대로)' }] }],
      timeline: [{ stage: '(시기)', cards: ['A1'], shift: '(60자 이내)', kept: '(60자 이내)' }],
      gaps: [{ kind: GAP_KINDS[0], note: '(60자 이내)', cards: ['A1'] }],
      identity_material: {
        whoAmI: { chains: ['(chain name)'], quotes: [{ cardId: 'A1', quote: '(그대로)' }] },
        whyJob: { pairs: [{ mine: { cardId: 'A1', quote: '(그대로)' }, jd: '(직무 자료 원문 일부 그대로)' }] },
        whyCompany: { pairs: [{ mine: { cardId: 'A1', quote: '(그대로)' }, company: '(회사 자료 원문 일부 그대로)' }] },
        whyMe: { chains: ['(chain name)'], rare: '(80자 이내)' },
      },
    }),
  ].join('\n');
  const groups = AXES.map((axis) => {
    const lines = ctx.clusters[axis].map((c) => JSON.stringify({
      id: c.id,
      name: clusterName(c),
      thread: c.aiThread,
      ...(c.myMeaning.trim() ? { myMeaning: c.myMeaning.trim() } : {}),
      members: c.members.map((m) => ({ cardId: m.cardId, quote: memberQuote(axis, m) })),
    }));
    return `## ${axis} (${questionLabel(data, axis)} · ${AXIS_INFO[axis].meaning})\n${lines.join('\n') || '(묶음 없음)'}`;
  }).join('\n');
  const cards = (data.cards ?? []).map((c) => JSON.stringify({ cardId: c.id, title: c.title ?? '', group: c.group ?? '', period: c.period ?? '' })).join('\n');
  const answers = pressure.map((p) => `### ${p.id} · ${p.title}\n"""\n${p.answer}\n"""`).join('\n\n') || '(없음)';
  return [
    head, rules, format,
    `[묶음 — 축별]\n${groups}`,
    `[경험 목록 — 시간순 정렬용]\n${cards}`,
    `[압박 문항 답]\n${answers}`,
    `[직무 자료]\n${ctx.jdTexts.map((t) => `- ${t}`).join('\n') || '(없음)'}`,
    `[회사 자료]\n${ctx.companyLines.map((t) => `- ${t}`).join('\n') || '(없음)'}`,
  ].join('\n\n');
}

export function validateThread(raw, ctx) {
  const obj = isObj(raw) ? raw : {};
  const dropped = { quotes: 0, links: 0 };
  const known = new Set(ctx.answerTexts.keys());
  const ids = (v) => [...new Set(arr(v).filter((id) => known.has(id)))];
  const quote = (q) => {
    const hit = isObj(q) && known.has(q.cardId) ? locateIn(ctx.answerTexts.get(q.cardId), q.quote) : null;
    if (!hit) {
      dropped.quotes += 1;
      return null;
    }
    return { cardId: q.cardId, quote: clip(hit, 300) };
  };
  const clusterIds = Object.fromEntries(AXES.map((axis) => [axis, new Set(ctx.clusters[axis].map((c) => c.id))]));
  const chains = [];
  for (const c of arr(obj.chains)) {
    if (!isObj(c) || !str(c.name)) continue;
    const links = [];
    for (const l of arr(c.links)) {
      if (isObj(l) && AXES.includes(l.axis) && clusterIds[l.axis].has(l.clusterId)) {
        if (!links.some((x) => x.axis === l.axis && x.clusterId === l.clusterId)) links.push({ axis: l.axis, clusterId: l.clusterId });
      } else dropped.links += 1;
    }
    const evidence = arr(c.evidence).map(quote).filter(Boolean);
    if (!links.length && !evidence.length) continue;
    chains.push({ name: clip(str(c.name), 40), pattern: clip(str(c.pattern), 160), links, cards: ids(c.cards), evidence });
  }
  const chainNames = new Set(chains.map((c) => c.name));
  const names = (v) => [...new Set(arr(v).filter((n) => chainNames.has(n)))];
  const timeline = arr(obj.timeline).filter((t) => isObj(t) && str(t.stage)).map((t) => ({
    stage: clip(str(t.stage), 40), cards: ids(t.cards), shift: clip(str(t.shift), 160), kept: clip(str(t.kept), 160),
  }));
  const gaps = arr(obj.gaps).filter((g) => isObj(g) && str(g.note)).map((g) => ({
    kind: GAP_KINDS.includes(g.kind) ? g.kind : clip(str(g.kind), 30), note: clip(str(g.note), 160), cards: ids(g.cards),
  }));
  const im = isObj(obj.identity_material) ? obj.identity_material : {};
  const part = (key) => (isObj(im[key]) ? im[key] : {});
  const pairs = (list, side, texts) => arr(list).map((p) => {
    if (!isObj(p)) return null;
    const mine = quote(p.mine);
    const theirs = locateIn(texts, str(p[side]));
    if (!mine || !theirs) {
      if (mine) dropped.quotes += 1;
      return null;
    }
    return { mine, [side]: clip(theirs, 400) };
  }).filter(Boolean);
  const result = {
    chains,
    timeline,
    gaps,
    identity_material: {
      whoAmI: { chains: names(part('whoAmI').chains), quotes: arr(part('whoAmI').quotes).map(quote).filter(Boolean) },
      whyJob: { pairs: pairs(part('whyJob').pairs, 'jd', ctx.jdTexts) },
      whyCompany: { pairs: pairs(part('whyCompany').pairs, 'company', ctx.companyTexts) },
      whyMe: { chains: names(part('whyMe').chains), rare: clip(str(part('whyMe').rare), 160) },
    },
  };
  return { result, dropped };
}

// ---- 3단계: 직무·회사 렌즈 ----
// 엮기(나를 발견)와 따로 돈다. 엮기 입력에는 회사·직무 자료를 최소로만 넣고, 여기서 비춰 본다.
// jd_translated의 mine(기존 데이터가 쓴 매핑)과 포지셔닝 기둥·명제는 넣지 않는다 (끼워 맞추기 방지).

export function lensContext(data) {
  const clusters = Object.fromEntries(AXES.map((axis) => [axis, liveClusters(store.weaveDim(axis)).filter((c) => c.members.length)]));
  const chains = store.weaveThread()?.result?.chains ?? [];
  const pressure = (data.pressure ?? []).map((p) => ({ id: p.id, title: p.title ?? '', answer: store.pressure(p.id)?.text ?? '' })).filter((p) => p.answer.trim());
  const rows = (data.job?.jd_translated ?? []).filter((t) => nonEmpty(t.jd)).map((t) => ({ jd: t.jd, real: t.real ?? '', junior: t.junior ?? '' }));
  const now = data.positioning?.company_now ?? {};
  const axes = (now.axes ?? []).filter((a) => nonEmpty(a.axis)).map((a) => ({ axis: a.axis, what: a.what ?? '' }));
  return {
    clusters,
    chains,
    pressure,
    rows,
    axes,
    compressed: now.compressed ?? '',
    caution: now.caution ?? '',
    answerTexts: answerTextsOf(data),
    cardIds: new Set((data.cards ?? []).map((c) => c.id)),
    names: new Set([...AXES.flatMap((axis) => clusters[axis].map(clusterName)), ...chains.map((c) => c.name)]),
    jdTexts: [...(data.job?.jd_raw ?? []), ...rows.map((r) => r.jd)].filter(nonEmpty),
  };
}

// 렌즈가 본 재료의 지문 — 엮기 결과나 압박 문항 답이 바뀌면 달라진다 ("다시 실행하면 반영" 표시용)
export function lensBasis(ctx) {
  return hashText(JSON.stringify([
    AXES.map((axis) => ctx.clusters[axis].map((c) => [clusterName(c), c.myMeaning.trim(), c.members.map((m) => m.cardId)])),
    ctx.chains.map((c) => [c.name, c.pattern, c.cards]),
    ctx.pressure.map((p) => [p.id, hashText(p.answer.trim())]),
  ]));
}

export function lensPrompt(data, ctx, pressure = ctx.pressure) {
  const head = '너는 한 사람이 엮어 낸 경험을 직무 자료(JD)와 회사의 지금 국면에 비춰 보는 정리자다. 평가하거나 고치거나 조언하지 않고, 그의 경험의 의미를 대신 쓰지 않는다. JD 업무마다 그의 경험 중 어디가 닿고 어디가 비는지, 회사의 축마다 그의 경험이 닿는지를 짚는다. 인용은 그의 글에서 글자 그대로 가져오고, jd와 axis는 아래 자료의 문자열을 글자 하나 바꾸지 않고 그대로 쓴다. 지정된 JSON만 출력하라.';
  const rules = [
    '[규칙]',
    `- coverage에는 [JD 업무]의 ${ctx.rows.length}행을 빠짐없이, 행마다 한 번씩 같은 순서로 넣는다. jd에는 그 행의 jd 문자열을 글자 그대로 복사한다.`,
    `- strength는 ${LENS_STRENGTHS.map((s) => `"${s}"`).join(', ')} 중 하나. 그의 글에서 근거가 나오지 않으면 "없음".`,
    '- evidence의 quote는 [묶음]의 인용이나 [압박 문항 답]에서 글자 그대로 복사한다(60자 이내). cardId는 그 글이 나온 경험 id(카드는 A1 같은 id, 압박 문항은 P1 같은 id).',
    '- via에는 근거가 된 묶음 이름이나 흐름 이름을 [묶음]·[흐름]에 적힌 그대로 쓴다.',
    '- next_question은 면접관이 이어 물을 질문 한 줄(60자 이내). gap_note는 strength가 "없음"이나 "조사만 함"일 때만, 무엇을 모르는지 60자 이내.',
    `- company_touch에는 [회사 축]의 axis마다 한 번씩 넣는다. axis는 글자 그대로 복사한다. touch는 ${LENS_TOUCHES.map((s) => `"${s}"`).join(', ')} 중 하나, note 60자 이내.`,
    '- apply_material은 그가 카드의 "입사 후 어떻게 도움이 될까요?" 답을 쓸 때 볼 재료다. cardId는 카드 id, jd는 [JD 업무]의 jd 문장 일부를 그대로, why는 이 경험이 이 업무에 쓰일 수 있는 이유(60자 이내). 답 문장을 대신 쓰지 않는다.',
    '- 그의 글에 없는 동기·성과·역할을 덧붙이지 않는다.',
  ].join('\n');
  const format = [
    '[출력 형식] JSON 객체 하나만. 설명이나 코드 울타리 없이.',
    JSON.stringify({
      coverage: [{ jd: '(J1의 jd 그대로)', strength: LENS_STRENGTHS[1], evidence: [{ cardId: 'A1', quote: '(그대로)' }], via: ['(묶음·흐름 이름)'], next_question: '(60자 이내)', gap_note: '' }],
      company_touch: [{ axis: '(회사 축 그대로)', touch: LENS_TOUCHES[1], evidence: [{ cardId: 'A1', quote: '(그대로)' }], note: '(60자 이내)' }],
      apply_material: [{ cardId: 'A1', jd: '(jd 일부 그대로)', why: '(60자 이내)' }],
    }),
  ].join('\n');
  const groups = AXES.map((axis) => {
    const lines = ctx.clusters[axis].map((c) => JSON.stringify({
      name: clusterName(c),
      ...(c.myMeaning.trim() ? { myMeaning: clip(c.myMeaning.trim(), 400) } : {}),
      members: c.members.map((m) => ({ cardId: m.cardId, quote: memberQuote(axis, m) })),
    }));
    return `## ${axis} (${questionLabel(data, axis)} · ${AXIS_INFO[axis].meaning})\n${lines.join('\n') || '(묶음 없음)'}`;
  }).join('\n');
  const chains = ctx.chains.map((c) => JSON.stringify({ name: c.name, pattern: c.pattern, cards: c.cards })).join('\n') || '(없음)';
  const rows = ctx.rows.map((r, i) => [`J${i + 1}. jd: ${r.jd}`, `    실제로 하는 일: ${r.real}`, `    신입에게: ${r.junior}`].join('\n')).join('\n');
  const axes = ctx.axes.map((a) => `- axis: ${a.axis}\n  what: ${a.what}`).join('\n');
  const answers = pressure.map((p) => `### ${p.id} · ${p.title}\n"""\n${p.answer}\n"""`).join('\n\n') || '(없음)';
  return [
    head, rules, format,
    `[묶음 — 축별]\n${groups}`,
    `[흐름 — 엮기 결과]\n${chains}`,
    `[JD 업무 — ${ctx.rows.length}행]\n${rows || '(없음)'}`,
    `[회사 축]\n${axes || '(없음)'}`,
    `[회사 국면 요약]\n${ctx.compressed || '(없음)'}`,
    `[회사 자료를 쓸 때 주의]\n${ctx.caution || '(없음)'}`,
    `[압박 문항 답]\n${answers}`,
  ].join('\n\n');
}

// coverage: JD 행마다 정확히 하나, 원문과 같은 jd만. 빠진 행은 "결과 없음"으로 채운다. company_touch: 회사 축마다 하나.
// 인용을 확인하고 나서 근거가 하나도 남지 않으면 "해 봄"·"닿음"이라고 둘 수 없다 — 없음·안 닿음으로 낮추고 센다(weakened).
const STRONG = new Set(['직접 해봄', '비슷한 걸 해봄']);
const TOUCHED = new Set(['닿음', '약하게 닿음']);

export function validateLens(raw, ctx) {
  const obj = isObj(raw) ? raw : {};
  const dropped = { quotes: 0, rows: 0, missing: 0, axes: 0, material: 0, weakened: 0 };
  const quote = (q) => {
    const hit = isObj(q) && ctx.answerTexts.has(q.cardId) ? locateIn(ctx.answerTexts.get(q.cardId), q.quote) : null;
    if (!hit) dropped.quotes += 1;
    return hit ? { cardId: q.cardId, quote: clip(hit, 300) } : null;
  };
  const byJd = new Map();
  for (const c of arr(obj.coverage)) {
    const jd = isObj(c) ? str(c.jd) : '';
    const row = ctx.rows.find((r) => r.jd.trim() === jd);
    if (!row || byJd.has(row.jd)) {
      dropped.rows += 1;
      continue;
    }
    const evidence = arr(c.evidence).map(quote).filter(Boolean).slice(0, 4);
    let strength = LENS_STRENGTHS.includes(c.strength) ? c.strength : NO_RESULT;
    if (!evidence.length && STRONG.has(strength)) {
      strength = '없음';
      dropped.weakened += 1;
    }
    byJd.set(row.jd, {
      jd: row.jd,
      strength,
      evidence,
      via: [...new Set(arr(c.via).filter((n) => typeof n === 'string' && ctx.names.has(n)))].slice(0, 4),
      next_question: clip(str(c.next_question), 90),
      gap_note: strength === '없음' || strength === '조사만 함' ? clip(str(c.gap_note), 90) : '',
    });
  }
  const coverage = ctx.rows.map((r) => {
    if (byJd.has(r.jd)) return byJd.get(r.jd);
    dropped.missing += 1;
    return { jd: r.jd, strength: NO_RESULT, evidence: [], via: [], next_question: '', gap_note: '' };
  });
  const byAxis = new Map();
  for (const t of arr(obj.company_touch)) {
    const axis = isObj(t) ? str(t.axis) : '';
    const a = ctx.axes.find((x) => x.axis.trim() === axis);
    if (!a || byAxis.has(a.axis)) {
      dropped.axes += 1;
      continue;
    }
    const evidence = arr(t.evidence).map(quote).filter(Boolean).slice(0, 4);
    let touch = LENS_TOUCHES.includes(t.touch) ? t.touch : NO_RESULT;
    if (!evidence.length && TOUCHED.has(touch)) {
      touch = '안 닿음';
      dropped.weakened += 1;
    }
    byAxis.set(a.axis, { axis: a.axis, touch, evidence, note: clip(str(t.note), 90) });
  }
  const companyTouch = ctx.axes.map((a) => byAxis.get(a.axis) ?? { axis: a.axis, touch: NO_RESULT, evidence: [], note: '' });
  const material = [];
  for (const m of arr(obj.apply_material)) {
    const jd = isObj(m) && ctx.cardIds.has(m.cardId) ? locateIn(ctx.jdTexts, str(m.jd)) : null;
    if (!jd || !str(m.why)) {
      dropped.material += 1;
      continue;
    }
    if (!material.some((x) => x.cardId === m.cardId && x.jd === jd)) material.push({ cardId: m.cardId, jd: clip(jd, 200), why: clip(str(m.why), 90) });
  }
  return { result: { coverage, company_touch: companyTouch, apply_material: material.slice(0, 50) }, dropped };
}

// ---- 4단계: 포지셔닝과 대조 (수동 버튼) ----

// 내 버전을 받아들인 항목은 내 버전이 지금 문구다.
export function currentTargets(data) {
  return positioningTargets(data).map((t) => ({ ...t, original: t.text, text: store.myPositioning(t.target)?.text ?? t.text }));
}

function evidencePool() {
  const pool = [];
  const seen = new Set();
  const add = (cardId, quote) => {
    const key = `${cardId}|${quote}`;
    if (quote && !seen.has(key)) {
      seen.add(key);
      pool.push({ cardId, quote });
    }
  };
  for (const axis of AXES) for (const c of liveClusters(store.weaveDim(axis))) for (const m of c.members) add(m.cardId, m.quote);
  for (const c of store.weaveThread()?.result?.chains ?? []) for (const e of c.evidence) add(e.cardId, e.quote);
  return pool.slice(0, 200);
}

export const identityReady = () => IDENTITY_KEYS.every((k) => store.identityText(k).trim());

export function comparePrompt(data) {
  const pos = data.positioning ?? {};
  const targets = currentTargets(data);
  const text = (target) => targets.find((t) => t.target === target)?.text ?? '';
  const head = '너는 지원자가 직접 쓴 자기 정의 네 문단과, 미리 정리된 포지셔닝 문구를 나란히 놓고 대조하는 검토자다. 지원자의 경험이나 정의 문단을 고쳐 쓰지 않는다. 문장을 제안하는 것은 proposals의 포지셔닝 문구 수정안뿐이다. 지정된 JSON만 출력하라.';
  const tasks = [
    '[과제]',
    '1. agree: 지원자의 정의와 맞아떨어지는 포지셔닝 항목. pillar는 기둥 번호(숫자) 또는 "thesis". note 60자 이내.',
    '2. missing_in_positioning: 정의와 경험에는 뚜렷한데 포지셔닝에 없는 것. evidence의 quote는 [경험 인용]에서 글자 그대로 복사한다.',
    '3. not_grounded: 포지셔닝에 있는데 지원자의 글에서 근거가 나오지 않는 것. note는 왜 근거가 안 나오는지 60자 이내.',
    '4. proposals: 포지셔닝 문구 수정안. target은 "thesis.core", "thesis.layer", "pillars[n].title", "pillars[n].line"(n은 기둥 번호), "why_now_line" 중 하나. current에는 그 문구 전체를 [포지셔닝]에서 글자 그대로 복사한다. suggested는 지원자의 정의와 경험에 맞춘 새 문구다 — 지원자의 글에 없는 사실·수치·역할을 넣지 않고, 원래 문구의 길이와 말투를 지킨다. reason 60자 이내. 고칠 필요가 없는 문구는 넣지 않는다.',
  ].join('\n');
  const format = [
    '[출력 형식] JSON 객체 하나만. 설명이나 코드 울타리 없이.',
    JSON.stringify({
      agree: [{ pillar: 1, note: '(60자 이내)' }],
      missing_in_positioning: [{ what: '(무엇이 빠졌나)', evidence: [{ cardId: 'A1', quote: '(그대로)' }] }],
      not_grounded: [{ pillar: 'thesis', note: '(60자 이내)' }],
      proposals: [{ target: 'pillars[1].line', current: '(지금 문구 전체 그대로)', suggested: '(새 문구)', reason: '(60자 이내)' }],
    }),
  ].join('\n');
  const mine = IDENTITY_KEYS.map((k) => `### ${IDENTITY_LABEL[k]}\n"""\n${store.identityText(k)}\n"""`).join('\n\n');
  const chains = (store.weaveThread()?.result?.chains ?? []).map((c) => `- ${c.name}: ${c.pattern}`).join('\n') || '(없음)';
  const pool = evidencePool().map((e) => `- ${e.cardId}: "${e.quote}"`).join('\n') || '(없음)';
  const pillars = (pos.pillars ?? []).map((p) => [
    `pillars[${p.n}].title: ${text(`pillars[${p.n}].title`)}`,
    `pillars[${p.n}].line: ${text(`pillars[${p.n}].line`)}`,
    `  (역할: ${p.role ?? ''} / 근거 경험: ${p.evidence ?? ''})`,
  ].join('\n')).join('\n');
  const evidenceMap = (pos.evidence_map ?? []).map((e) => `- ${e.need} → ${e.evidence} (${e.grade})`).join('\n') || '(없음)';
  const positioning = [
    `thesis.core: ${text('thesis.core')}`,
    `thesis.layer: ${text('thesis.layer')}`,
    pillars,
    `why_now_line: ${text('why_now_line')}`,
  ].join('\n');
  return [
    head, tasks, format,
    `[내 정의 — 지원자가 쓴 글]\n${mine}`,
    `[엮기 결과 — 반복되는 흐름]\n${chains}`,
    `[경험 인용 — 지원자의 답에서 그대로]\n${pool}`,
    `[포지셔닝]\n${positioning}`,
    `[필요 역량 → 내 증거]\n${evidenceMap}`,
  ].join('\n\n');
}

export function validateCompare(raw, data) {
  const obj = isObj(raw) ? raw : {};
  const dropped = { quotes: 0, proposals: 0 };
  const pillars = new Set((data.positioning?.pillars ?? []).map((p) => p.n));
  const ref = (v) => (v === 'thesis' ? 'thesis' : pillars.has(Number(v)) ? Number(v) : null);
  const answerTexts = new Map();
  for (const c of data.cards ?? []) answerTexts.set(c.id, AXES.map((axis) => store.answerText(c.id, axis)).filter((t) => t.trim()));
  for (const p of data.pressure ?? []) answerTexts.set(p.id, [store.pressure(p.id)?.text ?? ''].filter((t) => t.trim()));
  const quote = (q) => {
    const hit = isObj(q) && answerTexts.has(q.cardId) ? locateIn(answerTexts.get(q.cardId), q.quote) : null;
    if (!hit) dropped.quotes += 1;
    return hit ? { cardId: q.cardId, quote: clip(hit, 300) } : null;
  };
  const notes = (list) => arr(list).map((x) => (isObj(x) && ref(x.pillar) !== null && str(x.note) ? { pillar: ref(x.pillar), note: clip(str(x.note), 160) } : null)).filter(Boolean);
  const targets = new Map(currentTargets(data).map((t) => [t.target, t.text]));
  const proposals = [];
  for (const p of arr(obj.proposals)) {
    const current = isObj(p) ? targets.get(p.target) : undefined;
    const suggested = isObj(p) ? str(p.suggested) : '';
    const part = current !== undefined ? locate(current, str(p.current)) : null;
    if (!current || !suggested || !part) {
      dropped.proposals += 1;
      continue;
    }
    // current가 문구 일부만 가리키면 그 부분만 바꾼 전체 문구가 제안이다.
    const at = current.indexOf(part);
    const full = part === trimQuote(current) ? suggested : `${current.slice(0, at)}${suggested}${current.slice(at + part.length)}`;
    if (full.trim() === current.trim() || proposals.some((x) => x.target === p.target)) {
      dropped.proposals += 1;
      continue;
    }
    proposals.push({ target: p.target, current, suggested: clip(full, 1000), reason: clip(str(p.reason), 160) });
  }
  const result = {
    agree: notes(obj.agree),
    missing_in_positioning: arr(obj.missing_in_positioning).map((m) => (isObj(m) && str(m.what)
      ? { what: clip(str(m.what), 200), evidence: arr(m.evidence).map(quote).filter(Boolean) } : null)).filter(Boolean),
    not_grounded: notes(obj.not_grounded),
    proposals,
  };
  return { result, dropped };
}

// ---- 실행: [엮기 실행] 한 번에 묶기 4회 + 엮기 1회 + 렌즈 1회를 차례로. 호출은 한 번에 하나씩 ----

const STEP_KEYS = [...AXES, 'thread', 'lens'];
// 이 코드로 실패하면 남은 단계도 같은 이유로 실패하니 거기서 멈춘다.
const HALT = new Set(['rate_limited', 'session_expired', 'cancelled']);

let run = null;
let compareJob = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
// 다른 화면의 Claude 호출(최종 보고서)도 하나씩만 돌도록 여기서 함께 본다
const busyChecks = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const addBusyCheck = (fn) => busyChecks.add(fn);
export const runState = () => run;
export const compareState = () => compareJob;
export const busy = () => Boolean(run?.active || compareJob?.active || [...busyChecks].some((fn) => fn()));

export const stepLabel = (key) => (key === 'thread' ? '엮기' : key === 'lens' ? '렌즈' : AXIS_INFO[key]?.step ?? key);
// 앞 단계가 다 끝나야 시작하는 단계: 엮기는 묶기 넷, 렌즈는 엮기까지
const waitsFor = (key) => (key === 'thread' ? AXES : key === 'lens' ? [...AXES, 'thread'] : []);

function allEntries(data) {
  return [
    ...AXES.flatMap((axis) => axisEntries(data, axis).map(([id, t]) => [`${axis}:${id}`, t])),
    ...pressureEntries(data).map(([id, t]) => [`pressure:${id}`, t]),
  ];
}

export function startRun(data) {
  if (busy() || !ai.available() || !materialStatus(data).ready) return;
  run = {
    at: new Date().toISOString(),
    active: false,
    ctl: null,
    changedSince: changedSinceWeave(data),
    steps: STEP_KEYS.map((key) => ({ key, label: stepLabel(key), state: 'waiting', error: null, ms: null, startedAt: null, chars: 0, dropped: null, cut: false })),
  };
  drive(data);
}

export function retryStep(data, key) {
  if (busy() || !run || !ai.available()) return;
  const step = run.steps.find((s) => s.key === key);
  if (!step || step.state !== 'error') return;
  step.state = 'waiting';
  step.error = null;
  for (const s of run.steps) if (s.state === 'blocked') s.state = 'waiting';
  drive(data);
}

export function stopRun() {
  run?.ctl?.abort();
}

async function runAxis(data, axis, step) {
  const cards = bindingCards(data, axis);
  const keep = keepOf(store.weaveDim(axis));
  const { prompt, cut } = fitPrompt((list) => bindingPrompt(data, axis, list, keep), cards);
  step.cut = cut;
  const raw = await ai.askJson(prompt, { modelTier: 'default', cache: false, signal: run.ctl.signal, onText: ({ text }) => { step.chars = text.length; notify(); } });
  const checked = validateBinding(raw, { axis, cards, keep });
  const { basis, basisHash } = basisOf(cards.map((c) => [c.cardId, c.answer]));
  store.applyWeaveAxis(axis, checked, { basis, basisHash });
  return checked.dropped;
}

async function runThread(data, step) {
  const ctx = threadContext(data);
  const { prompt, cut } = fitPrompt((list) => threadPrompt(data, ctx, list), ctx.pressure);
  step.cut = cut;
  const raw = await ai.askJson(prompt, { modelTier: 'complex', cache: false, signal: run.ctl.signal, onText: ({ text }) => { step.chars = text.length; notify(); } });
  const checked = validateThread(raw, ctx);
  const { basis, basisHash } = basisOf(ctx.pressure.map((p) => [p.id, p.answer]));
  const dimsAt = Object.fromEntries(AXES.map((axis) => [axis, store.weaveDim(axis)?.at]).filter(([, at]) => at));
  store.setWeaveThread({ result: checked.result, basis, basisHash, dimsAt });
  return checked.dropped;
}

async function runLens(data, step) {
  const ctx = lensContext(data);
  const { prompt, cut } = fitPrompt((list) => lensPrompt(data, ctx, list), ctx.pressure);
  step.cut = cut;
  const raw = await ai.askJson(prompt, { modelTier: 'complex', cache: false, signal: run.ctl.signal, onText: ({ text }) => { step.chars = text.length; notify(); } });
  const checked = validateLens(raw, ctx);
  store.setLensResult({ result: checked.result, basisHash: lensBasis(ctx) });
  return checked.dropped;
}

const RUNNERS = { thread: runThread, lens: runLens };

async function drive(data) {
  run.active = true;
  notify();
  for (const step of run.steps) {
    if (step.state === 'done' || step.state === 'error') continue;
    if (run.steps.some((s) => waitsFor(step.key).includes(s.key) && s.state !== 'done')) {
      step.state = 'blocked';
      continue;
    }
    run.ctl = new AbortController();
    Object.assign(step, { state: 'running', startedAt: Date.now(), chars: 0, error: null });
    notify();
    try {
      step.dropped = RUNNERS[step.key] ? await RUNNERS[step.key](data, step) : await runAxis(data, step.key, step);
      step.state = 'done';
    } catch (e) {
      step.state = 'error';
      step.error = e?.code ?? 'upstream_error';
      if (!e?.code) console.error(e);
    }
    step.ms = Date.now() - step.startedAt;
    notify();
    if (step.state === 'error' && (HALT.has(step.error) || ai.isHidden(step.error))) break;
  }
  run.active = false;
  run.ctl = null;
  store.recordWeaveRun({
    at: run.at,
    basisHash: basisOf(allEntries(data)).basisHash,
    changedSince: run.changedSince,
    steps: run.steps.filter((s) => s.ms !== null).map((s) => ({ key: s.key, ok: s.state === 'done', ms: s.ms, error: s.error ?? '' })),
  });
  notify();
}

export function startCompare(data) {
  if (busy() || !ai.available() || !identityReady()) return;
  compareJob = { active: true, ctl: new AbortController(), error: null, startedAt: Date.now(), ms: null, chars: 0, dropped: null };
  notify();
  ai.askJson(comparePrompt(data), {
    modelTier: 'complex', cache: false, signal: compareJob.ctl.signal,
    onText: ({ text }) => { compareJob.chars = text.length; notify(); },
  }).then((raw) => {
    const checked = validateCompare(raw, data);
    compareJob.dropped = checked.dropped;
    store.setCompare(checked.result);
  }, (e) => {
    compareJob.error = e?.code ?? 'upstream_error';
  }).finally(() => {
    compareJob.active = false;
    compareJob.ctl = null;
    compareJob.ms = Date.now() - compareJob.startedAt;
    notify();
  });
}

export function stopCompare() {
  compareJob?.ctl?.abort();
}

// ---- 물어보기 맥락: 엮기 결과가 있으면 그 요약 ----

export function chatSummary(data) {
  const blocks = [];
  for (const axis of AXES) {
    const clusters = liveClusters(store.weaveDim(axis));
    if (!clusters.length) continue;
    const lines = clusters.map((c) => {
      const parts = [`- ${clusterName(c)}${c.myName.trim() ? ' (지원자가 붙인 이름)' : ''}`];
      if (c.aiThread) parts.push(`공통점: ${c.aiThread}`);
      if (c.myMeaning.trim()) parts.push(`지원자가 쓴 의미: ${c.myMeaning.trim()}`);
      parts.push(`경험: ${c.members.map((m) => m.cardId).join(', ') || '(없음)'}`);
      return parts.join(' / ');
    });
    blocks.push(`## ${AXIS_INFO[axis].label} (${questionLabel(data, axis)} · ${AXIS_INFO[axis].meaning})\n${lines.join('\n')}`);
  }
  const chains = store.weaveThread()?.result?.chains ?? [];
  if (chains.length) blocks.push(`## 반복되는 흐름\n${chains.map((c) => `- ${c.name}: ${c.pattern} (${c.cards.join(', ')})`).join('\n')}`);
  const mine = IDENTITY_KEYS.filter((k) => store.identityText(k).trim()).map((k) => `### ${IDENTITY_LABEL[k]}\n${store.identityText(k).trim()}`);
  if (mine.length) blocks.push(`## 지원자가 쓴 정의\n${mine.join('\n\n')}`);
  return blocks.length ? `[엮기 요약 — 엮기 탭에서 정리한 묶음과 흐름]\n${blocks.join('\n\n')}` : '';
}
