// 엮기 결과와 내 편집을 담는 순수 데이터 함수. DOM·저장소·Claude를 모른다 — store.js가 부른다.
// Claude가 낸 것(ai…, source "ai" 멤버, loners, tensions)은 다시 돌리면 새 결과로 바뀌고,
// 내가 고친 것(my…, locked, source "me" 멤버, 뺀 멤버, 내가 만든 묶음)은 다시 돌려도 남는다.

export const AXES = ['why', 'what', 'learned', 'apply'];
export const AXIS_INFO = {
  why: { label: '왜', step: '왜 묶기', meaning: '동기·가치', sees: '나는 무엇에 움직이는가', type: '같은 이유' },
  what: { label: '뭐', step: '뭐 묶기', meaning: '행동 방식', sees: '문제 앞에서 어떻게 움직이는가', type: '같은 방식' },
  learned: { label: '배움', step: '배움 묶기', meaning: '믿음·원칙', sees: '경험이 남긴 기준', type: '같은 배움' },
  apply: { label: '입사 후', step: '입사 후 묶기', meaning: '기여 방향', sees: '내가 줄 수 있는 것', type: '같은 기여' },
};
export const CLUSTER_TYPES = ['같은 이유', '같은 방식', '같은 배움', '같은 결과', '같은 기여'];
export const GAP_KINDS = ['근거 하나뿐', '말은 많은데 근거 약함', '축 사이 단절'];
export const IDENTITY_KEYS = ['whoAmI', 'whyJob', 'whyCompany', 'whyMe'];
export const IDENTITY_LABEL = { whoAmI: '나는 어떤 사람인가', whyJob: '왜 이 직무인가', whyCompany: '왜 이 회사인가', whyMe: '왜 나인가' };
export const MY_POSITIONING_KEY = /^(thesis\.core|thesis\.layer|why_now_line|pillars\[\d{1,2}\]\.(title|line))$/;

const circled = (n) => (Number.isInteger(n) && n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n));

// 포지셔닝 탭에서 내 버전 블록의 id (엮기 탭에서 그 자리로 바로 간다)
export const versionId = (target) => `my-${target.replace(/[^a-z0-9]+/gi, '-')}`;

// 대조에서 Claude가 고쳐 쓰자고 할 수 있는 포지셔닝 문구들 (원문 JSON은 건드리지 않는다)
export function positioningTargets(data) {
  const pos = data.positioning ?? {};
  const out = [];
  const add = (target, label, text) => {
    if (typeof text === 'string' && text.trim()) out.push({ target, label, text });
  };
  add('thesis.core', '한 줄 명제', pos.thesis?.core);
  add('thesis.layer', '한 줄 명제 — 풀이', pos.thesis?.layer);
  for (const p of pos.pillars ?? []) {
    add(`pillars[${p.n}].title`, `기둥 ${circled(p.n)} 제목`, p.title);
    add(`pillars[${p.n}].line`, `기둥 ${circled(p.n)} 문장`, p.line);
  }
  add('why_now_line', 'Why Now 한 줄', pos.why_now_line);
  return out;
}

const MAX_ARCHIVED = 30;
const MAX_REPLACED = 400;
const MAX_RUNS = 5;
const MAX_MEANING = 3000;
const MATCH = 0.45;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
const time = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const stamp = (v) => (v ? Date.parse(v) || 0 : 0);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const clip = (s, n) => (Array.from(s).length > n ? Array.from(s).slice(0, n).join('') : s);
const uniq = (list) => [...new Set(list)];

export function hashText(text) {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    x ^= text.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return (x >>> 0).toString(16).padStart(8, '0');
}

// 답 묶음의 지문: { id: 답 해시 } 와 전체 해시
export function basisOf(entries) {
  const basis = {};
  for (const [id, text] of entries) basis[id] = hashText(text.trim());
  return { basis, basisHash: hashText(Object.entries(basis).map(([id, h]) => `${id}:${h}`).join('|')) };
}

// 지문 이후 바뀐(새로 쓴·지운 것 포함) 답 수
export function changedCount(basis, entries) {
  const now = new Map(entries.map(([id, text]) => [id, hashText(text.trim())]));
  let n = 0;
  for (const [id, h] of now) if (basis?.[id] !== h) n += 1;
  for (const id of Object.keys(basis ?? {})) if (!now.has(id)) n += 1;
  return n;
}

// ---- 정규화: 저장된 값·백업·다른 기기의 문서를 같은 모양으로 ----

const quoteObj = (q) => (isObj(q) && str(q.cardId) && str(q.quote) ? { cardId: clip(q.cardId, 20), quote: clip(q.quote, 300) } : null);
const quotes = (v) => arr(v).map(quoteObj).filter(Boolean).slice(0, 40);
const idList = (v, n = 60) => uniq(arr(v).filter((s) => typeof s === 'string' && s && !UNSAFE.has(s)).map((s) => clip(s, 80))).slice(0, n);

function blankCluster() {
  return {
    id: '', origin: 'ai', type: '', aiName: '', aiThread: '',
    myName: '', myNameAt: null, myMeaning: '', myMeaningAt: null, locked: false, lockedAt: null,
    members: [], removed: [], membersAt: null, deleted: false, deletedAt: null, carriedFrom: '', createdAt: null,
  };
}

function normMembers(list) {
  const out = [];
  for (const m of arr(list)) {
    if (!isObj(m) || !str(m.cardId) || out.some((x) => x.cardId === m.cardId)) continue;
    out.push({ cardId: clip(m.cardId, 20), quote: clip(str(m.quote), 300), source: m.source === 'me' ? 'me' : 'ai' });
  }
  return out;
}

function normCluster(c) {
  if (!isObj(c) || !str(c.id) || UNSAFE.has(c.id)) return null;
  return {
    id: clip(c.id, 80),
    origin: c.origin === 'me' ? 'me' : 'ai',
    type: clip(str(c.type), 20),
    aiName: clip(str(c.aiName), 60),
    aiThread: clip(str(c.aiThread), 200),
    myName: clip(str(c.myName), 60),
    myNameAt: time(c.myNameAt),
    myMeaning: clip(str(c.myMeaning), MAX_MEANING),
    myMeaningAt: time(c.myMeaningAt),
    locked: c.locked === true,
    lockedAt: time(c.lockedAt),
    members: normMembers(c.members),
    removed: idList(c.removed),
    membersAt: time(c.membersAt),
    deleted: c.deleted === true,
    deletedAt: time(c.deletedAt),
    carriedFrom: clip(str(c.carriedFrom), 80),
    createdAt: time(c.createdAt),
  };
}

function normArchived(a) {
  if (!isObj(a) || !str(a.id)) return null;
  return {
    id: clip(a.id, 80),
    myName: clip(str(a.myName), 60),
    aiName: clip(str(a.aiName), 60),
    myMeaning: clip(str(a.myMeaning), MAX_MEANING),
    members: normMembers(a.members).map(({ cardId, quote }) => ({ cardId, quote })),
    at: time(a.at),
  };
}

function normBasis(raw) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (!UNSAFE.has(k) && /^[0-9a-f]{8}$/.test(str(v))) out[clip(k, 30)] = v;
  return out;
}

export function emptyDim() {
  return { at: null, basis: {}, basisHash: '', clusters: [], loners: [], tensions: [], archived: [], replaced: [] };
}

export function normalizeDim(raw) {
  if (!isObj(raw)) return null;
  const clusters = [];
  for (const c of arr(raw.clusters)) {
    const n = normCluster(c);
    if (n && !clusters.some((x) => x.id === n.id)) clusters.push(n);
  }
  // 예전 버전이 저장한 순서도 여기서 정해진 순서로 바꾼다 (두 기기가 같은 문서를 갖도록).
  return settle({
    at: time(raw.at),
    basis: normBasis(raw.basis),
    basisHash: clip(str(raw.basisHash), 16),
    clusters,
    loners: arr(raw.loners).filter((l) => isObj(l) && str(l.cardId))
      .map((l) => ({ cardId: clip(l.cardId, 20), why: clip(str(l.why), 120), auto: l.auto === true })),
    tensions: arr(raw.tensions).map((t) => (isObj(t) && quoteObj(t.a) && quoteObj(t.b)
      ? { a: quoteObj(t.a), b: quoteObj(t.b), note: clip(str(t.note), 200) } : null)).filter(Boolean),
    archived: arr(raw.archived).map(normArchived).filter(Boolean),
    replaced: idList(raw.replaced, MAX_REPLACED * 2),
  });
}

function normThreadResult(r) {
  if (!isObj(r)) return null;
  const im = isObj(r.identity_material) ? r.identity_material : {};
  const part = (key) => (isObj(im[key]) ? im[key] : {});
  const pairs = (v, side) => arr(v).map((p) => (isObj(p) && quoteObj(p.mine) && str(p[side])
    ? { mine: quoteObj(p.mine), [side]: clip(p[side], 400) } : null)).filter(Boolean).slice(0, 20);
  return {
    chains: arr(r.chains).map((c) => (isObj(c) && str(c.name) ? {
      name: clip(c.name, 40),
      pattern: clip(str(c.pattern), 160),
      links: arr(c.links).filter((l) => isObj(l) && AXES.includes(l.axis) && str(l.clusterId))
        .map((l) => ({ axis: l.axis, clusterId: clip(l.clusterId, 80) })).slice(0, 12),
      cards: idList(c.cards, 40),
      evidence: quotes(c.evidence),
    } : null)).filter(Boolean).slice(0, 20),
    timeline: arr(r.timeline).map((t) => (isObj(t) && str(t.stage) ? {
      stage: clip(t.stage, 40), cards: idList(t.cards, 40), shift: clip(str(t.shift), 160), kept: clip(str(t.kept), 160),
    } : null)).filter(Boolean).slice(0, 20),
    gaps: arr(r.gaps).map((g) => (isObj(g) && str(g.note) ? {
      kind: clip(str(g.kind), 30), note: clip(g.note, 160), cards: idList(g.cards, 40),
    } : null)).filter(Boolean).slice(0, 20),
    identity_material: {
      whoAmI: { chains: idList(part('whoAmI').chains, 20), quotes: quotes(part('whoAmI').quotes) },
      whyJob: { pairs: pairs(part('whyJob').pairs, 'jd') },
      whyCompany: { pairs: pairs(part('whyCompany').pairs, 'company') },
      whyMe: { chains: idList(part('whyMe').chains, 20), rare: clip(str(part('whyMe').rare), 200) },
    },
  };
}

export function normalizeThread(raw) {
  if (!isObj(raw)) return null;
  const result = normThreadResult(raw.result);
  if (!result) return null;
  const dimsAt = {};
  if (isObj(raw.dimsAt)) for (const axis of AXES) if (time(raw.dimsAt[axis])) dimsAt[axis] = raw.dimsAt[axis];
  return { result, basis: normBasis(raw.basis), basisHash: clip(str(raw.basisHash), 16), dimsAt, at: time(raw.at) };
}

export function normalizeRuns(raw) {
  return arr(raw).filter((r) => isObj(r) && time(r.at)).map((r) => ({
    at: r.at,
    updatedAt: time(r.updatedAt),
    basisHash: clip(str(r.basisHash), 16),
    changedSince: Number.isInteger(r.changedSince) && r.changedSince >= 0 ? r.changedSince : null,
    steps: arr(r.steps).filter((s) => isObj(s) && str(s.key)).slice(0, 8).map((s) => ({
      key: clip(s.key, 20), ok: s.ok === true, ms: Number.isFinite(s.ms) && s.ms >= 0 ? Math.round(s.ms) : null, error: clip(str(s.error), 40),
    })),
  })).slice(-MAX_RUNS);
}

const pillarRef = (v) => (Number.isInteger(v) && v >= 1 && v <= 20 ? v : v === 'thesis' ? 'thesis' : null);

function normCompareResult(r) {
  if (!isObj(r)) return null;
  const notes = (v) => arr(v).map((x) => (isObj(x) && pillarRef(x.pillar) !== null && str(x.note)
    ? { pillar: pillarRef(x.pillar), note: clip(x.note, 160) } : null)).filter(Boolean).slice(0, 20);
  return {
    agree: notes(r.agree),
    missing_in_positioning: arr(r.missing_in_positioning).map((m) => (isObj(m) && str(m.what)
      ? { what: clip(m.what, 200), evidence: quotes(m.evidence) } : null)).filter(Boolean).slice(0, 20),
    not_grounded: notes(r.not_grounded),
    proposals: arr(r.proposals).map((p) => (isObj(p) && MY_POSITIONING_KEY.test(str(p.target)) && str(p.suggested) ? {
      target: p.target, current: clip(str(p.current), 1000), suggested: clip(p.suggested, 1000), reason: clip(str(p.reason), 160),
    } : null)).filter(Boolean).slice(0, 20),
  };
}

const DECISIONS = ['accepted', 'edited', 'rejected'];

export function normalizeCompare(raw) {
  if (!isObj(raw)) return null;
  const result = normCompareResult(raw.result);
  if (!result) return null;
  const decisions = {};
  if (isObj(raw.decisions)) {
    for (const [k, v] of Object.entries(raw.decisions)) {
      if (/^\d{1,2}$/.test(k) && isObj(v) && DECISIONS.includes(v.value)) decisions[k] = { value: v.value, updatedAt: time(v.updatedAt) };
    }
  }
  return { result, at: time(raw.at), decisions };
}

// ---- 기기 사이 병합 ----
// 어느 기기에서 합치든(merge(a, b)든 merge(b, a)든) 글자 하나까지 같은 결과가 나와야 한다. 아니면 두 기기가
// 서로 "다르다"고 보고 끝없이 다시 올린다(sync.js는 배열 순서까지 비교한다). 그래서 시각이 같으면 내용으로
// 승자를 정하고, 배열은 정해진 순서로 둔다.

// 키 순서와 상관없는 값의 지문 (sync.js의 비교와 같은 규칙)
export function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

// y가 x를 이기는가: 시각이 더 늦은 쪽, 같으면 지문이 더 큰 쪽
const beats = (yAt, xAt, yVal, xVal) => stamp(yAt) > stamp(xAt) || (stamp(yAt) === stamp(xAt) && canon(yVal) > canon(xVal));

// 숫자 조각은 숫자로 비교하는 순서 (지역 설정과 상관없이 어디서나 같다)
function natural(a, b) {
  const x = a.match(/\d+|\D+/g) ?? [];
  const y = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (/^\d/.test(x[i]) && /^\d/.test(y[i])) {
      const p = x[i].replace(/^0+(?=\d)/, '');
      const q = y[i].replace(/^0+(?=\d)/, '');
      if (p.length !== q.length) return p.length - q.length;
    }
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

const clusterOrder = (x, y) => {
  const a = x.createdAt ?? '';
  const b = y.createdAt ?? '';
  return a < b ? -1 : a > b ? 1 : natural(x.id, y.id);
};

const USER_FIELDS = [['myName', 'myNameAt'], ['myMeaning', 'myMeaningAt'], ['locked', 'lockedAt'], ['deleted', 'deletedAt']];
const AI_FIELDS = ['origin', 'type', 'aiName', 'aiThread', 'createdAt', 'carriedFrom'];

function mergeCluster(x, y) {
  const out = clone(x);
  const ai = canon(AI_FIELDS.map((k) => y[k])) > canon(AI_FIELDS.map((k) => x[k])) ? y : x;
  for (const k of AI_FIELDS) out[k] = ai[k];
  for (const [field, at] of USER_FIELDS) {
    if (beats(y[at], x[at], y[field], x[field])) {
      out[field] = y[field];
      out[at] = y[at];
    }
  }
  if (beats(y.membersAt, x.membersAt, [y.members, y.removed], [x.members, x.removed])) {
    out.members = clone(y.members);
    out.removed = [...y.removed];
    out.membersAt = y.membersAt;
  }
  return out;
}

const hasWords = (c) => Boolean(c.myName.trim() || c.myMeaning.trim());
const edited = (c) => hasWords(c) || c.members.some((m) => m.source === 'me') || c.removed.length > 0;
const editStamp = (c) => Math.max(stamp(c.myNameAt), stamp(c.myMeaningAt), stamp(c.lockedAt), stamp(c.membersAt));

function archiveOf(c, at) {
  return { id: c.id, myName: c.myName, aiName: c.aiName, myMeaning: c.myMeaning, members: c.members.map(({ cardId, quote }) => ({ cardId, quote })), at };
}

function dedupeArchived(list) {
  const seen = new Map();
  for (const a of list) {
    const prev = seen.get(a.id);
    if (!prev || beats(a.at, prev.at, a, prev)) seen.set(a.id, a);
  }
  return [...seen.values()].sort((a, b) => stamp(a.at) - stamp(b.at) || natural(a.id, b.id));
}

// 묶음·교체 목록·이전 묶음을 정해진 순서로 둔다. 지금 묶음에 있는 id는 교체 목록에서 뺀다.
function settle(dim) {
  dim.clusters.sort(clusterOrder);
  const present = new Set(dim.clusters.map((c) => c.id));
  dim.replaced = uniq(dim.replaced).filter((id) => !present.has(id)).sort(natural).slice(-MAX_REPLACED);
  dim.archived = dedupeArchived(dim.archived).slice(-MAX_ARCHIVED);
  return dim;
}

// src의 내 편집을 target에 옮겨 붙인다. 멤버 편집은 since 이후 것만 (그 전 것은 이미 옮겨졌다).
function graft(target, src, since = 0) {
  for (const [field, at] of [['myName', 'myNameAt'], ['myMeaning', 'myMeaningAt'], ['locked', 'lockedAt']]) {
    if (src[at] && stamp(src[at]) > stamp(target[at])) {
      target[field] = src[field];
      target[at] = src[at];
    }
  }
  if (!src.membersAt || stamp(src.membersAt) <= since) return;
  const manual = src.members.filter((m) => m.source === 'me' && !target.members.some((t) => t.cardId === m.cardId));
  const removed = src.removed.filter((id) => !target.removed.includes(id));
  if (!manual.length && !removed.length) return;
  target.members = [...target.members.filter((m) => !(m.source === 'ai' && removed.includes(m.cardId))), ...clone(manual)];
  target.removed = uniq([...target.removed, ...removed]);
  // 합친 결과는 두 편집보다 나중 것이어야 한다. 시각이 그대로면 다시 합칠 때 합치기 전 목록과 동점이 되어 붙인 멤버가 빠질 수 있다.
  target.membersAt = new Date(Math.max(stamp(target.membersAt), stamp(src.membersAt)) + 1).toISOString();
}

// 실행 하나를 이루는 값들 (같은 실행이면 같다)
const runPart = (d) => [d.at, d.basisHash, d.basis, d.loners, d.tensions];

export function mergeDim(a, b) {
  if (!a || !b) return a || b ? settle(clone(a ?? b)) : null;
  // 더 최근 실행이 바탕이다. 같은 실행이면 어느 쪽이든 결과가 같도록 아래에서 양쪽을 똑같이 다룬다.
  const [base, other] = beats(b.at, a.at, runPart(b), runPart(a)) ? [b, a] : [a, b];
  const sameRun = (a.at ?? '') === (b.at ?? '');
  const since = stamp(base.at);
  const replaced = new Set([...base.replaced, ...other.replaced]);
  const out = clone(base);
  out.clusters = [];
  out.replaced = [...replaced];
  out.archived = [...base.archived, ...other.archived];
  const sides = new Map(base.clusters.map((c) => [c.id, [c, null]]));
  for (const c of other.clusters) sides.set(c.id, [sides.get(c.id)?.[0] ?? null, c]);
  const retired = [];
  for (const [id, [x, y]] of sides) {
    if (x && y) {
      out.clusters.push(mergeCluster(x, y));
      continue;
    }
    const c = x ?? y;
    // 더 최근 실행(base)에만 있는 묶음은 그 실행이 정한 것이다. 옛 실행 쪽 묶음은 교체됐거나 잠기지 않은 Claude 묶음이면 물러난다.
    const stale = sameRun ? replaced.has(id) : !x && (replaced.has(id) || (c.origin === 'ai' && !c.locked));
    // 그 실행 뒤에 다른 기기에서 잠근 묶음은 잠긴 채 살린다 (교체 목록에서는 settle이 뺀다).
    if (!stale || (c.locked && stamp(c.lockedAt) > since)) out.clusters.push(clone(c));
    else retired.push(c);
  }
  // 물러난 묶음: 그 실행 뒤에 고친 것만 이어받은 묶음에 붙이고, 이어받은 묶음이 없으면 이전 묶음에 보관한다.
  for (const c of retired) {
    if (editStamp(c) <= since) continue;
    const heir = out.clusters.find((h) => h.carriedFrom === c.id);
    if (heir) graft(heir, c, since);
    else if (edited(c)) out.archived.push(archiveOf(c, new Date(editStamp(c)).toISOString()));
  }
  return settle(out);
}

export function mergeThread(a, b) {
  if (!a || !b) return clone(a ?? b ?? null);
  return clone(beats(b.at, a.at, b, a) ? b : a);
}

// 같은 실행(at)의 기록은 더 나중에 고친 것을 남긴다.
export function mergeRuns(a, b) {
  const byAt = new Map();
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    const prev = byAt.get(r.at);
    if (!prev || beats(r.updatedAt, prev.updatedAt, r, prev)) byAt.set(r.at, r);
  }
  return clone([...byAt.values()].sort((x, y) => stamp(x.at) - stamp(y.at) || natural(x.at, y.at)).slice(-MAX_RUNS));
}

export function mergeCompare(a, b) {
  if (!a || !b) return clone(a ?? b ?? null);
  if ((a.at ?? '') !== (b.at ?? '')) return clone(beats(b.at, a.at, b, a) ? b : a);
  const out = clone(beats(b.at, a.at, b.result, a.result) ? b : a);
  out.decisions = {};
  for (const k of [...new Set([...Object.keys(a.decisions), ...Object.keys(b.decisions)])].sort(natural)) {
    const x = a.decisions[k];
    const y = b.decisions[k];
    out.decisions[k] = clone(!x ? y : !y ? x : beats(y.updatedAt, x.updatedAt, y, x) ? y : x);
  }
  return out;
}

// ---- 다시 돌리기: 잠기지 않은 Claude 묶음만 새 결과로 바꾸고, 그 묶음에 남긴 내 편집은 비슷한 새 묶음으로 옮긴다 ----

const compact = (s) => s.replace(/\s+/g, '');

function dice(a, b) {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < x.length - 1; i++) grams.set(x.slice(i, i + 2), (grams.get(x.slice(i, i + 2)) ?? 0) + 1);
  let hit = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      hit += 1;
      grams.set(g, n - 1);
    }
  }
  return (2 * hit) / (x.length - 1 + y.length - 1);
}

function jaccard(a, b) {
  const x = new Set(a);
  const y = new Set(b);
  const union = new Set([...x, ...y]).size;
  if (!union) return 0;
  let both = 0;
  for (const v of x) if (y.has(v)) both += 1;
  return both / union;
}

export function similarity(old, next) {
  const name = Math.max(dice(old.myName, next.aiName), dice(old.aiName, next.aiName));
  return 0.6 * name + 0.4 * jaccard(old.members.map((m) => m.cardId), next.members.map((m) => m.cardId));
}

const memberKey = (members) => members.map((m) => m.cardId).sort().join(',');

// result: 검증을 마친 Claude 결과 { clusters: [{ type, name, thread, members: [{ cardId, quote }] }], loners, tensions }
export function applyRun(dim, result, { axis, basis, basisHash, at }) {
  const old = dim ?? emptyDim();
  const live = old.clusters.filter((c) => !c.deleted);
  const kept = live.filter((c) => c.locked || c.origin === 'me');
  const outgoing = live.filter((c) => !c.locked && c.origin === 'ai');
  const keptKeys = new Set(kept.map((c) => memberKey(c.members)));
  const tag = stamp(at).toString(36);
  const fresh = [];
  result.clusters.forEach((c, i) => {
    if (keptKeys.has(memberKey(c.members))) return;
    fresh.push({
      ...blankCluster(),
      id: `${axis}-${tag}-${i + 1}`,
      type: c.type,
      aiName: c.name,
      aiThread: c.thread,
      members: c.members.map((m) => ({ cardId: m.cardId, quote: m.quote, source: 'ai' })),
      createdAt: at,
    });
  });

  const pairs = [];
  for (const o of outgoing) {
    if (!edited(o)) continue;
    for (const f of fresh) {
      const score = similarity(o, f);
      if (score >= MATCH) pairs.push({ o, f, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score || (x.o.id < y.o.id ? -1 : x.o.id > y.o.id ? 1 : x.f.id < y.f.id ? -1 : 1));
  const usedOld = new Set();
  const usedNew = new Set();
  for (const { o, f } of pairs) {
    if (usedOld.has(o.id) || usedNew.has(f.id)) continue;
    usedOld.add(o.id);
    usedNew.add(f.id);
    graft(f, o);
    f.carriedFrom = o.id;
  }
  const archived = [...old.archived];
  for (const o of outgoing) if (!usedOld.has(o.id) && hasWords(o)) archived.push(archiveOf(o, at));

  return settle({
    at,
    basis: { ...basis },
    basisHash,
    clusters: [...clone(kept), ...fresh],
    loners: clone(result.loners),
    tensions: clone(result.tensions),
    archived,
    replaced: [...old.replaced, ...outgoing.map((c) => c.id), ...old.clusters.filter((c) => c.deleted).map((c) => c.id)],
  });
}

// ---- 내 편집 (새 dim을 돌려준다) ----

// 엮는 사이 다시 그려지지 않은 화면에서 옛 묶음을 고치는 경우가 있다(입력 중이라 화면을 미룬 때).
// 그 편집은 그 묶음을 이어받은 새 묶음(carriedFrom)으로 보낸다.
function findLive(dim, id) {
  return dim.clusters.find((x) => x.id === id && !x.deleted) ?? dim.clusters.find((x) => x.carriedFrom === id && !x.deleted) ?? null;
}

// 이어받은 묶음도 없으면(이전 묶음으로 보관됐으면) onArchived로 그 기록을 고친다.
function withCluster(dim, id, fn, onArchived) {
  const next = clone(dim);
  const c = findLive(next, id);
  if (c) fn(c, next);
  else if (onArchived) {
    const a = next.archived.find((x) => x.id === id);
    if (a) onArchived(a);
  }
  return settle(next);
}

export const renameCluster = (dim, id, text, now) => withCluster(dim, id, (c) => {
  c.myName = clip(text, 60);
  c.myNameAt = now;
}, (a) => {
  a.myName = clip(text, 60);
  a.at = now;
});

export const setClusterMeaning = (dim, id, text, now) => withCluster(dim, id, (c) => {
  c.myMeaning = clip(text, MAX_MEANING);
  c.myMeaningAt = now;
}, (a) => {
  a.myMeaning = clip(text, MAX_MEANING);
  a.at = now;
});

export const setClusterLocked = (dim, id, locked, now) => withCluster(dim, id, (c) => {
  c.locked = Boolean(locked);
  c.lockedAt = now;
});

function takeOut(c, cardId, now) {
  const m = c.members.find((x) => x.cardId === cardId);
  if (!m) return null;
  c.members = c.members.filter((x) => x.cardId !== cardId);
  if (m.source === 'ai' && !c.removed.includes(cardId)) c.removed.push(cardId);
  c.membersAt = now;
  return m;
}

function putIn(c, cardId, quote, now) {
  c.removed = c.removed.filter((x) => x !== cardId);
  if (!c.members.some((x) => x.cardId === cardId)) c.members.push({ cardId, quote: clip(str(quote), 300), source: 'me' });
  c.membersAt = now;
}

export const removeMember = (dim, id, cardId, now) => withCluster(dim, id, (c) => {
  takeOut(c, cardId, now);
});

export const addMember = (dim, id, cardId, quote, now) => withCluster(dim, id, (c) => {
  putIn(c, cardId, quote, now);
});

function newCluster(axis, name, now) {
  const rand = Math.floor(Math.random() * 1679616).toString(36);
  return { ...blankCluster(), id: `${axis}-me-${stamp(now).toString(36)}${rand}`, origin: 'me', myName: clip(name, 60), myNameAt: now, createdAt: now };
}

export function createCluster(dim, axis, name, now) {
  const next = clone(dim);
  const c = newCluster(axis, name, now);
  next.clusters.push(c);
  return { dim: settle(next), id: c.id };
}

// toId가 null이면 새 묶음을 만들어 옮긴다.
export function moveMember(dim, axis, fromId, cardId, toId, now) {
  const next = clone(dim);
  const from = findLive(next, fromId);
  const m = from ? takeOut(from, cardId, now) : null;
  if (!m) return settle(next);
  let to = toId ? findLive(next, toId) : null;
  if (!to) {
    to = newCluster(axis, '', now);
    next.clusters.push(to);
  }
  putIn(to, cardId, m.quote, now);
  return settle(next);
}

// 내 이름이나 의미를 쓴 묶음은 지워도 "이전 묶음"에 남긴다.
export function deleteCluster(dim, id, now) {
  const next = clone(dim);
  const c = findLive(next, id);
  if (!c || c.locked) return settle(next);
  if (hasWords(c)) next.archived.push(archiveOf(c, now));
  c.deleted = true;
  c.deletedAt = now;
  return settle(next);
}

export const liveClusters = (dim) => (dim?.clusters ?? []).filter((c) => !c.deleted);

// 어느 묶음에도 없는 경험: 엮을 때 답이 있던 카드와 지금 답이 있는 카드 중에서
export function looseCards(dim, answeredIds) {
  const clustered = new Set(liveClusters(dim).flatMap((c) => c.members.map((m) => m.cardId)));
  const why = new Map((dim?.loners ?? []).map((l) => [l.cardId, l]));
  const basis = dim?.basis ?? {};
  return uniq([...Object.keys(basis), ...answeredIds]).filter((id) => !clustered.has(id)).map((id) => ({
    cardId: id,
    why: why.get(id)?.why ?? '',
    auto: why.get(id)?.auto ?? false,
    fresh: !own(basis, id),
  }));
}

export function clusterName(c) {
  return c.myName.trim() || c.aiName || '이름 없는 묶음';
}
