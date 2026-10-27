// 엮기 결과와 내 편집을 담는 순수 데이터 함수. DOM·저장소·Claude를 모른다 — store.js가 부른다.
// Claude가 낸 것(ai…, source "ai" 멤버, loners, tensions)은 다시 돌리면 새 결과로 바뀌고,
// 내가 고친 것(my…, locked, source "me" 멤버, 뺀 멤버, 내가 만든 묶음)은 다시 돌려도 남는다.
//
// 축 하나의 저장값: 마지막 실행 결과(at·basis·loners·tensions), 아는 묶음 기록(clusters), 실행이 물린 묶음(replaced).
// 기기 사이 병합은 칸마다 시각이 늦은 쪽을 고르는 합치기뿐이라, 기기 몇 대를 어떤 순서로 합쳐도 같은 결과가 나온다.
// 지금 보이는 묶음, 옛 묶음에서 이어받은 내 편집, 이전 묶음은 저장값에서 그때그때 계산한다(liveClusters, archivedList).

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
// 이전 묶음으로 남기는 기록은 문서 크기(256 KiB) 안에 들도록 이만큼까지만 (다시 엮을 때 줄인다)
const ARCHIVE_BYTES = 96 * 1024;
const MAX_TOMBSTONES = 60;
const MAX_REPLACED = 400;
const MAX_LINEAGE = 20;
const MAX_RUNS = 5;
const MAX_MEANING = 3000;
const MATCH = 0.45;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
// 시각은 언제나 같은 모양(toISOString)으로 둔다 — 같은 순간이 두 가지 글자로 남으면 기기마다 승자가 달라진다.
const time = (v) => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
const stamp = (v) => (v ? Date.parse(v) || 0 : 0);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const clip = (s, n) => (Array.from(s).length > n ? Array.from(s).slice(0, n).join('') : s);
const uniq = (list) => [...new Set(list)];
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

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

// ---- 비교의 기준: 어느 기기에서 계산해도 같아야 한다 ----

// 키 순서와 상관없는 값의 지문 (sync.js의 비교와 같은 규칙)
export function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

// y가 x를 이기는가: 시각이 더 늦은 쪽, 같으면 지문이 더 큰 쪽
const beats = (yAt, xAt, yVal, xVal) => stamp(yAt) > stamp(xAt) || (stamp(yAt) === stamp(xAt) && canon(yVal) > canon(xVal));
const later = (a, b) => (!a ? b ?? null : !b ? a : beats(b, a, b, a) ? b : a);

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

// ---- 묶음 기록 ----
// 처음 정해지면 바뀌지 않는 칸(Claude 쪽): origin·type·aiName·aiThread·createdAt·carriedFrom·lineage
// 내 칸: myName·myMeaning·locked·deleted — 칸마다 고친 시각이 따로 있다
// keptAt: 이 묶음을 보여 준 마지막 실행(새로 냈거나 남겼거나, 그 실행 아래에서 내가 잠그거나 푼 때)
// 멤버는 카드 한 장마다 "들어 있음(members) / 뺐음(removed)"과 그 시각을 둔다 — 카드마다 늦은 쪽이 이긴다.

const AI_FIELDS = ['origin', 'type', 'aiName', 'aiThread', 'createdAt', 'carriedFrom', 'lineage'];
const USER_FIELDS = [['myName', 'myNameAt'], ['myMeaning', 'myMeaningAt'], ['locked', 'lockedAt'], ['deleted', 'deletedAt']];
// 옛 묶음의 내 편집이 이어받은 묶음으로 옮겨 가는 칸 (지운 표시는 그 묶음에만 해당한다)
const GRAFT_FIELDS = USER_FIELDS.slice(0, 3);

function blankCluster() {
  return {
    id: '', origin: 'ai', type: '', aiName: '', aiThread: '', createdAt: null, carriedFrom: '', lineage: [],
    keptAt: null,
    myName: '', myNameAt: null, myMeaning: '', myMeaningAt: null, locked: false, lockedAt: null, deleted: false, deletedAt: null,
    members: [], removed: [],
  };
}

const inEl = (m, at) => ({ cardId: clip(m.cardId, 20), quote: clip(str(m.quote), 300), source: m.source === 'me' ? 'me' : 'ai', at });
const outEl = (m, at) => ({ cardId: clip(m.cardId, 20), source: m.source === 'me' ? 'me' : 'ai', at });

// 카드 id → { kind: 'in'|'out', e } — 같은 카드면 시각이 늦은 쪽(같으면 지문이 큰 쪽)
function putEl(map, kind, e) {
  const prev = map.get(e.cardId);
  if (!prev || beats(e.at, prev.e.at, [kind, e], [prev.kind, prev.e])) map.set(e.cardId, { kind, e });
}

function elMap(c) {
  const map = new Map();
  for (const e of c.members) putEl(map, 'in', e);
  for (const e of c.removed) putEl(map, 'out', e);
  return map;
}

function splitEls(map) {
  const members = [];
  const removed = [];
  for (const id of [...map.keys()].sort(natural)) {
    const { kind, e } = map.get(id);
    (kind === 'in' ? members : removed).push(e);
  }
  return { members, removed };
}

function setEl(c, kind, e) {
  const map = elMap(c);
  map.set(e.cardId, { kind, e });
  Object.assign(c, splitEls(map));
}

const quoteObj = (q) => (isObj(q) && str(q.cardId) && str(q.quote) ? { cardId: clip(q.cardId, 20), quote: clip(q.quote, 300) } : null);
const quotes = (v) => arr(v).map(quoteObj).filter(Boolean).slice(0, 40);
const idList = (v, n = 60) => uniq(arr(v).filter((s) => typeof s === 'string' && s && !UNSAFE.has(s)).map((s) => clip(s, 80))).slice(0, n);

// dimAt: 이 기록이 들어 있던 문서의 실행 시각 (예전 모양을 옮길 때만 쓴다)
function normCluster(c, dimAt) {
  if (!isObj(c) || !str(c.id) || UNSAFE.has(c.id)) return null;
  // 예전 모양: keptAt이 없고, 멤버 편집 시각이 묶음에 하나(membersAt)뿐, 뺀 멤버는 카드 id 목록이었다.
  // 예전에는 문서에 있는 묶음이 모두 지금 묶음이었으므로 그 문서의 실행 시각으로 남긴 것으로 본다.
  const legacy = !own(c, 'keptAt');
  const createdAt = time(c.createdAt);
  const membersAt = time(c.membersAt);
  const els = new Map();
  for (const m of arr(c.members)) {
    if (!isObj(m) || !str(m.cardId) || UNSAFE.has(m.cardId)) continue;
    putEl(els, 'in', inEl(m, time(m.at) ?? (m.source === 'me' ? membersAt ?? createdAt : createdAt)));
  }
  for (const m of arr(c.removed)) {
    const e = typeof m === 'string' ? { cardId: m, source: 'ai' } : m;
    if (!isObj(e) || !str(e.cardId) || UNSAFE.has(e.cardId)) continue;
    putEl(els, 'out', outEl(e, time(e.at) ?? membersAt ?? createdAt));
  }
  const carriedFrom = clip(str(c.carriedFrom), 80);
  return {
    id: clip(c.id, 80),
    origin: c.origin === 'me' ? 'me' : 'ai',
    type: clip(str(c.type), 20),
    aiName: clip(str(c.aiName), 60),
    aiThread: clip(str(c.aiThread), 200),
    createdAt,
    carriedFrom,
    lineage: idList([...(carriedFrom ? [carriedFrom] : []), ...arr(c.lineage)], MAX_LINEAGE),
    keptAt: legacy ? later(createdAt, dimAt) : time(c.keptAt) ?? createdAt,
    myName: clip(str(c.myName), 60),
    myNameAt: time(c.myNameAt),
    myMeaning: clip(str(c.myMeaning), MAX_MEANING),
    myMeaningAt: time(c.myMeaningAt),
    locked: c.locked === true,
    lockedAt: time(c.lockedAt),
    deleted: c.deleted === true,
    deletedAt: time(c.deletedAt),
    ...splitEls(els),
  };
}

// 같은 id의 두 기록을 합친다: Claude 칸은 지문이 큰 쪽(보통 똑같다), 내 칸은 칸마다, 멤버는 카드마다 늦은 쪽.
function joinRecord(x, y) {
  const out = {};
  const ai = canon(AI_FIELDS.map((k) => y[k])) > canon(AI_FIELDS.map((k) => x[k])) ? y : x;
  out.id = x.id;
  for (const k of AI_FIELDS) out[k] = clone(ai[k]);
  out.keptAt = later(x.keptAt, y.keptAt);
  for (const [field, at] of USER_FIELDS) {
    const w = beats(y[at], x[at], y[field], x[field]) ? y : x;
    out[field] = w[field];
    out[at] = w[at];
  }
  const map = elMap(x);
  for (const e of y.members) putEl(map, 'in', e);
  for (const e of y.removed) putEl(map, 'out', e);
  return { ...blankCluster(), ...out, ...clone(splitEls(map)) };
}

function normArchived(a) {
  if (!isObj(a) || !str(a.id)) return null;
  return {
    id: clip(a.id, 80),
    myName: clip(str(a.myName), 60),
    aiName: clip(str(a.aiName), 60),
    myMeaning: clip(str(a.myMeaning), MAX_MEANING),
    members: arr(a.members).filter((m) => isObj(m) && str(m.cardId)).map((m) => ({ cardId: clip(m.cardId, 20), quote: clip(str(m.quote), 300) })),
    at: time(a.at),
  };
}

// 실행이 물린 묶음 { id, at(그 실행 시각) } — id마다 늦은 시각, 최근 MAX_REPLACED개
function joinReplaced(list) {
  const byId = new Map();
  for (const r of list) byId.set(r.id, later(byId.get(r.id) ?? null, r.at));
  return [...byId].map(([id, at]) => ({ id, at }))
    .sort((a, b) => stamp(a.at) - stamp(b.at) || natural(a.id, b.id)).slice(-MAX_REPLACED);
}

function normReplaced(v, dimAt) {
  return joinReplaced(arr(v).map((r) => (typeof r === 'string' ? { id: r, at: dimAt } : isObj(r) && str(r.id) ? { id: r.id, at: time(r.at) ?? dimAt } : null))
    .filter((r) => r && !UNSAFE.has(r.id)).map((r) => ({ id: clip(r.id, 80), at: r.at })));
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
  const at = time(raw.at);
  const byId = new Map();
  for (const c of arr(raw.clusters)) {
    const n = normCluster(c, at);
    if (n) byId.set(n.id, byId.has(n.id) ? joinRecord(byId.get(n.id), n) : n);
  }
  return settle({
    at,
    basis: normBasis(raw.basis),
    basisHash: clip(str(raw.basisHash), 16),
    clusters: [...byId.values()],
    loners: arr(raw.loners).filter((l) => isObj(l) && str(l.cardId))
      .map((l) => ({ cardId: clip(l.cardId, 20), why: clip(str(l.why), 120), auto: l.auto === true })),
    tensions: arr(raw.tensions).map((t) => (isObj(t) && quoteObj(t.a) && quoteObj(t.b)
      ? { a: quoteObj(t.a), b: quoteObj(t.b), note: clip(str(t.note), 200) } : null)).filter(Boolean),
    archived: arr(raw.archived).map(normArchived).filter(Boolean),
    replaced: normReplaced(raw.replaced, at),
  });
}

// ---- 지금 보이는 묶음 ----

const lockBeats = (c, at) => c.locked && stamp(c.lockedAt) >= stamp(at);
// 지운 묶음과 잠근 묶음이 부딪히면 시각이 늦은 쪽이 이긴다 (같은 ms면 잠금 — 내 글을 남기는 쪽)
export const deletedNow = (c) => c.deleted && !lockBeats(c, c.deletedAt);

function isLive(dim, c, retired) {
  if (deletedNow(c)) return false;
  // 마지막 실행이 낸 묶음·남긴 묶음, 그 실행 아래에서 내가 잠그거나 푼 묶음
  if (stamp(c.keptAt) >= stamp(dim.at)) return true;
  // 내가 만든 묶음은 실행이 물리지 않는다
  if (c.origin === 'me') return true;
  // 실행이 물린 Claude 묶음: 그 실행보다 늦게 (다른 기기에서) 잠갔으면 되살린다
  const r = retired.get(c.id);
  if (r) return lockBeats(c, r);
  // 마지막 실행이 몰랐던 옛 실행의 Claude 묶음: 잠갔으면 남는다 (알았다면 남겼을 것)
  return c.locked;
}

function viewCtx(dim) {
  const retired = new Map(dim.replaced.map((r) => [r.id, r.at]));
  const byId = new Map(dim.clusters.map((c) => [c.id, c]));
  const live = new Set(dim.clusters.filter((c) => isLive(dim, c, retired)).map((c) => c.id));
  return { byId, live };
}

// 지금 묶음이 이어받은 옛 묶음(lineage)이 물러나 있으면, 그 옛 묶음에 남은 내 편집을 칸마다·카드마다 늦은 쪽으로 합쳐 보여 준다.
// (다시 엮는 사이 다른 기기에서 옛 묶음을 고친 경우 — 그 편집은 옛 기록에 남고, 보일 때 여기로 옮겨 온다)
function effective(c, ctx) {
  const out = clone(c);
  let map = null;
  for (const id of c.lineage) {
    const a = ctx.byId.get(id);
    if (!a || ctx.live.has(id)) continue;
    for (const [field, at] of GRAFT_FIELDS) {
      if (beats(a[at], out[at], a[field], out[field])) {
        out[field] = a[field];
        out[at] = a[at];
      }
    }
    map ??= elMap(out);
    for (const e of a.members) if (e.source === 'me') putEl(map, 'in', e);
    for (const e of a.removed) putEl(map, 'out', e);
  }
  if (map) Object.assign(out, clone(splitEls(map)));
  return out;
}

const hasWords = (c) => Boolean(c.myName.trim() || c.myMeaning.trim());
const edited = (c) => hasWords(c) || c.members.some((m) => m.source === 'me') || c.removed.some((m) => m.source === 'ai');
const editStamp = (c) => Math.max(stamp(c.myNameAt), stamp(c.myMeaningAt), stamp(c.lockedAt), stamp(c.deletedAt),
  ...c.members.filter((m) => m.source === 'me').map((m) => stamp(m.at)), ...c.removed.map((m) => stamp(m.at)));
// 내 편집이 하나도 없는 기록 — 물러나 있으면 버려도 잃는 것이 없다 (같은 id의 다른 사본도 같은 Claude 칸뿐이다)
const pristine = (c) => !hasWords(c) && !c.myNameAt && !c.myMeaningAt && !c.lockedAt && !c.deletedAt
  && !c.removed.length && c.members.every((m) => m.source === 'ai') && stamp(c.keptAt) <= stamp(c.createdAt);

// 정해진 순서로 둔다: 묶음은 만든 시각 → id, 멤버는 카드 id. 물러나 있고 내 편집이 없는 기록은 버린다.
function settle(dim) {
  dim.replaced = joinReplaced(dim.replaced);
  dim.archived = dedupeArchived(dim.archived).slice(-MAX_ARCHIVED);
  const { live } = viewCtx(dim);
  dim.clusters = dim.clusters.filter((c) => live.has(c.id) || !pristine(c)).sort(clusterOrder);
  return dim;
}

function dedupeArchived(list) {
  const seen = new Map();
  for (const a of list) {
    const prev = seen.get(a.id);
    if (!prev || beats(a.at, prev.at, a, prev)) seen.set(a.id, a);
  }
  return [...seen.values()].sort((a, b) => stamp(a.at) - stamp(b.at) || natural(a.id, b.id));
}

export function liveClusters(dim) {
  if (!dim) return [];
  const ctx = viewCtx(dim);
  return dim.clusters.filter((c) => ctx.live.has(c.id)).map((c) => effective(c, ctx));
}

// 이전 묶음: 지금 보이지 않고, 이어받은 기록도 없는데 내 편집이 남은 것 (지운 묶음은 이름·의미를 쓴 것만)
// 예전 모양으로 보관된 것(archived)도 함께. 같은 id면 늦은 쪽.
export function archivedList(dim) {
  if (!dim) return [];
  const ctx = viewCtx(dim);
  const absorbed = new Set(dim.clusters.flatMap((c) => c.lineage));
  const items = new Map();
  const add = (a) => {
    const prev = items.get(a.id);
    if (!prev || beats(a.at, prev.at, a, prev)) items.set(a.id, a);
  };
  for (const a of dim.archived) if (!ctx.live.has(a.id)) add(a);
  for (const c of dim.clusters) {
    if (ctx.live.has(c.id) || absorbed.has(c.id)) continue;
    const e = effective(c, ctx);
    if (deletedNow(c) ? !hasWords(e) : !edited(e)) continue;
    add({ id: c.id, myName: e.myName, aiName: e.aiName, myMeaning: e.myMeaning, members: e.members.map(({ cardId, quote }) => ({ cardId, quote })), at: iso(editStamp(e)) });
  }
  return [...items.values()].sort((a, b) => stamp(a.at) - stamp(b.at) || natural(a.id, b.id));
}

// ---- 기기 사이 병합 ----
// 실행 결과는 더 최근 실행 쪽, 묶음 기록은 id마다 합치기, 물린 묶음은 id마다 늦은 시각.
// 버리는 것은 settle의 "물러나 있고 내 편집이 없는 기록"뿐이라 어느 순서로 합쳐도 같다.

// 실행 하나를 이루는 값들 (같은 실행이면 같다)
const runPart = (d) => [d.at, d.basisHash, d.basis, d.loners, d.tensions];

export function mergeDim(a, b) {
  if (!a || !b) return a || b ? settle(clone(a ?? b)) : null;
  const base = beats(b.at, a.at, runPart(b), runPart(a)) ? b : a;
  const byId = new Map(a.clusters.map((c) => [c.id, c]));
  for (const c of b.clusters) byId.set(c.id, byId.has(c.id) ? joinRecord(byId.get(c.id), c) : c);
  return settle(clone({
    at: base.at,
    basis: base.basis,
    basisHash: base.basisHash,
    clusters: [...byId.values()],
    loners: base.loners,
    tensions: base.tensions,
    archived: [...a.archived, ...b.archived],
    replaced: [...a.replaced, ...b.replaced],
  }));
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
  if (isObj(raw.dimsAt)) for (const axis of AXES) if (time(raw.dimsAt[axis])) dimsAt[axis] = time(raw.dimsAt[axis]);
  return { result, basis: normBasis(raw.basis), basisHash: clip(str(raw.basisHash), 16), dimsAt, at: time(raw.at) };
}

export function normalizeRuns(raw) {
  return arr(raw).filter((r) => isObj(r) && time(r.at)).map((r) => ({
    at: time(r.at),
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

// ---- 직무·회사 렌즈: Claude 결과 + 내 메모(JD 업무마다) ----

export const LENS_STRENGTHS = ['직접 해봄', '비슷한 걸 해봄', '조사만 함', '없음'];
export const LENS_TOUCHES = ['닿음', '약하게 닿음', '안 닿음'];
// Claude가 그 행을 내지 않았거나 알 수 없는 값을 낸 경우
export const NO_RESULT = '결과 없음';

function normLensResult(r) {
  if (!isObj(r)) return null;
  return {
    coverage: arr(r.coverage).map((c) => (isObj(c) && str(c.jd) ? {
      jd: clip(c.jd, 200),
      strength: LENS_STRENGTHS.includes(c.strength) ? c.strength : NO_RESULT,
      evidence: quotes(c.evidence).slice(0, 8),
      via: idList(c.via, 8),
      next_question: clip(str(c.next_question), 160),
      gap_note: clip(str(c.gap_note), 160),
    } : null)).filter(Boolean).slice(0, 30),
    company_touch: arr(r.company_touch).map((t) => (isObj(t) && str(t.axis) ? {
      axis: clip(t.axis, 80),
      touch: LENS_TOUCHES.includes(t.touch) ? t.touch : NO_RESULT,
      evidence: quotes(t.evidence).slice(0, 8),
      note: clip(str(t.note), 160),
    } : null)).filter(Boolean).slice(0, 30),
    apply_material: arr(r.apply_material).map((a) => (isObj(a) && str(a.cardId) && str(a.jd) ? {
      cardId: clip(a.cardId, 20), jd: clip(a.jd, 200), why: clip(str(a.why), 160),
    } : null)).filter(Boolean).slice(0, 60),
  };
}

// { result, basisHash, at, myNotes: { [jd]: { text, updatedAt } } }
export function normalizeLens(raw) {
  if (!isObj(raw)) return null;
  const myNotes = {};
  if (isObj(raw.myNotes)) {
    for (const [k, v] of Object.entries(raw.myNotes)) {
      if (!UNSAFE.has(k) && k && isObj(v)) myNotes[clip(k, 200)] = { text: clip(str(v.text), MAX_MEANING), updatedAt: time(v.updatedAt) };
    }
  }
  const result = normLensResult(raw.result);
  if (!result && !Object.keys(myNotes).length) return null;
  return { result, basisHash: clip(str(raw.basisHash), 16), at: time(raw.at), myNotes };
}

// 결과는 더 최근 실행 쪽, 내 메모는 JD 업무마다 늦게 고친 쪽 (다시 실행해도 메모는 남는다)
export function mergeLens(a, b) {
  if (!a || !b) return clone(a ?? b ?? null);
  const run = (x) => [x.at, x.basisHash, x.result];
  const base = beats(b.at, a.at, run(b), run(a)) ? b : a;
  const myNotes = {};
  for (const k of [...new Set([...Object.keys(a.myNotes), ...Object.keys(b.myNotes)])].sort(natural)) {
    const x = a.myNotes[k];
    const y = b.myNotes[k];
    myNotes[k] = clone(!x ? y : !y ? x : beats(y.updatedAt, x.updatedAt, y, x) ? y : x);
  }
  return { result: clone(base.result), basisHash: base.basisHash, at: base.at, myNotes };
}

// ---- 최종 보고서 버전: [{ at, basisHash, markdown }] 오래된 것부터 최근 3개 ----

export const MAX_REPORTS = 3;
// 문서 하나(256 KiB) 안에 들도록. 보고서는 보통 2만 자 안팎이다.
const MAX_REPORT_CHARS = 70000;

export function mergeReports(a, b) {
  const byAt = new Map();
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    const prev = byAt.get(r.at);
    if (!prev || canon(r) > canon(prev)) byAt.set(r.at, r);
  }
  return clone([...byAt.values()].sort((x, y) => stamp(x.at) - stamp(y.at) || natural(x.at, y.at)).slice(-MAX_REPORTS));
}

export function normalizeReports(raw) {
  return mergeReports(arr(raw).filter((r) => isObj(r) && time(r.at) && str(r.markdown))
    .map((r) => ({ at: time(r.at), basisHash: clip(str(r.basisHash), 16), markdown: clip(r.markdown, MAX_REPORT_CHARS) })), []);
}

// ---- 덮어쓰기 가져오기: 시각 ----

export function dimStamps(dim) {
  const out = [dim.at];
  for (const c of dim.clusters) {
    out.push(c.createdAt, c.keptAt, c.myNameAt, c.myMeaningAt, c.lockedAt, c.deletedAt);
    for (const e of [...c.members, ...c.removed]) out.push(e.at);
  }
  for (const r of dim.replaced) out.push(r.at);
  for (const a of dim.archived) out.push(a.at);
  return out.filter(Boolean);
}

// 이 축의 모든 시각을 앞뒤 순서를 지킨 채 t부터 1 ms 간격으로 옮긴다 — 실행과 편집, 잠금과 지움의 앞뒤가 그대로 남는다.
export function restampDim(dim, t) {
  const list = [...new Set(dimStamps(dim).map(stamp))].sort((a, b) => a - b);
  const base = stamp(t);
  const moved = new Map(list.map((ms, i) => [ms, iso(base + i)]));
  const move = (v) => (v ? moved.get(stamp(v)) ?? v : v);
  dim.at = move(dim.at);
  for (const c of dim.clusters) {
    for (const k of ['createdAt', 'keptAt', 'myNameAt', 'myMeaningAt', 'lockedAt', 'deletedAt']) c[k] = move(c[k]);
    for (const e of [...c.members, ...c.removed]) e.at = move(e.at);
  }
  for (const r of dim.replaced) r.at = move(r.at);
  for (const a of dim.archived) a.at = move(a.at);
  return settle(dim);
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

// 옛 묶음 o(보이던 모양)의 내 편집을 새 묶음 f에 옮겨 붙인다. 시각은 그대로 둔다 — 나중에 옛 묶음의 다른 사본이 와도 같은 칸이 이긴다.
function graftInto(f, o) {
  for (const [field, at] of GRAFT_FIELDS) {
    if (o[at] && beats(o[at], f[at], o[field], f[field])) {
      f[field] = o[field];
      f[at] = o[at];
    }
  }
  // 옛 묶음에서 뺀 Claude 멤버는 새 결과에 다시 들어 있어도 뺀 채로 둔다
  const cut = new Set(o.removed.filter((e) => e.source === 'ai').map((e) => e.cardId));
  const map = elMap({ members: f.members.filter((m) => !(m.source === 'ai' && cut.has(m.cardId))), removed: f.removed });
  for (const e of o.members) if (e.source === 'me') putEl(map, 'in', clone(e));
  for (const e of o.removed) putEl(map, 'out', clone(e));
  Object.assign(f, splitEls(map));
}

// 크기 한도 안에서 최근 것부터
function newestWithin(list, max, limit) {
  const out = [];
  let total = 0;
  for (const c of [...list].sort((x, y) => editStamp(y) - editStamp(x) || natural(x.id, y.id))) {
    const size = bytes(c);
    if (out.length >= max || total + size > limit) break;
    out.push(c);
    total += size;
  }
  return out;
}

// result: 검증을 마친 Claude 결과 { clusters: [{ type, name, thread, members: [{ cardId, quote }] }], loners, tensions }
// 이 기기 안에서만 일어나는 일이라, 여기서는 보이는 모양을 기록에 굳히고 옛 기록을 정리해도 된다.
export function applyRun(dim, result, { axis, basis, basisHash, at }) {
  const old = dim ?? emptyDim();
  const ctx = viewCtx(old);
  const live = old.clusters.filter((c) => ctx.live.has(c.id)).map((c) => effective(c, ctx));
  const kept = live.filter((c) => c.locked || c.origin === 'me');
  const outgoing = live.filter((c) => !c.locked && c.origin === 'ai');
  const keptKeys = new Set(kept.map((c) => memberKey(c.members)));
  // 같은 id면 어느 기기에서든 같은 기록이어야 한다 (병합이 Claude 칸을 한쪽으로 고르므로).
  // 그래서 결과와 엮기 전 상태의 지문을 붙인다 — 같은 ms에 다른 기기가 같은 결과로 엮어도, 옮겨 붙인 편집이 다르면 id가 다르다.
  const tag = `${stamp(at).toString(36)}${hashText(canon([result, old])).slice(0, 6)}`;
  const fresh = [];
  result.clusters.forEach((c, i) => {
    if (keptKeys.has(memberKey(c.members))) return;
    const map = new Map();
    for (const m of c.members) putEl(map, 'in', inEl({ ...m, source: 'ai' }, at));
    fresh.push({
      ...blankCluster(),
      id: `${axis}-${tag}-${i + 1}`,
      type: c.type,
      aiName: c.name,
      aiThread: c.thread,
      createdAt: at,
      keptAt: at,
      ...splitEls(map),
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
    graftInto(f, o);
    f.carriedFrom = o.id;
    f.lineage = idList([o.id, ...o.lineage], MAX_LINEAGE);
  }

  const clusters = [...kept.map((k) => ({ ...k, keptAt: later(k.keptAt, at) })), ...fresh];
  const replaced = [...old.replaced];
  const archive = [];
  for (const o of outgoing) {
    replaced.push({ id: o.id, at });
    // 옮겨 붙일 곳이 없는 내 편집은 기록째 남겨 이전 묶음으로 보인다
    if (!usedOld.has(o.id) && edited(o)) archive.push(o);
  }
  // 그 밖의 안 보이던 기록: 이어받은 기록이 있으면 그쪽에 이미 들어 있다. 끝에 남은 것 중 내 글이 있는 것과 지운 기록만 둔다.
  // 지운 기록은 다른 기기의 옛 사본이 와도 되살아나지 않게 남긴다 (Claude 칸까지 그대로 — 같은 id의 사본은 서로 같아야 한다).
  const absorbed = new Set(old.clusters.flatMap((c) => c.lineage));
  const tombs = [];
  for (const c of old.clusters) {
    if (ctx.live.has(c.id) || absorbed.has(c.id)) continue;
    const e = effective(c, ctx);
    if (deletedNow(c) && !hasWords(e)) tombs.push(c);
    else if (deletedNow(c) || edited(e)) archive.push(e);
  }
  return settle({
    at,
    basis: { ...basis },
    basisHash,
    clusters: [...clusters, ...newestWithin(archive, MAX_ARCHIVED, ARCHIVE_BYTES), ...tombs.sort((x, y) => stamp(y.deletedAt) - stamp(x.deletedAt)).slice(0, MAX_TOMBSTONES)],
    loners: clone(result.loners),
    tensions: clone(result.tensions),
    archived: [...old.archived],
    replaced,
  });
}

// ---- 내 편집 (새 dim을 돌려준다) ----
// 편집 시각은 언제나 그 편집이 덮는 값보다 늦게 둔다 (이 기기 시계가 다른 기기보다 늦어도 내 편집이 지지 않게, +1 ms).
// 그래야 편집이 "늦은 쪽이 이긴다" 병합과 어긋나지 않고, 병합 순서와 상관없이 같은 결과가 나온다.
const bump = (now, prev) => (stamp(now) > stamp(prev) ? now : iso(stamp(prev) + 1));
const elAt = (shown, cardId) => [...shown.members, ...shown.removed].find((e) => e.cardId === cardId)?.at ?? null;

// 엮는 사이 다시 그려지지 않은 화면에서 옛 묶음을 고치는 경우가 있다(입력 중이라 화면을 미룬 때).
// 그 편집은 그 묶음을 이어받은 지금 묶음(lineage)으로 보낸다.
function findLive(dim, id) {
  const ctx = viewCtx(dim);
  const self = dim.clusters.find((c) => c.id === id && ctx.live.has(c.id));
  if (self) return { c: self, ctx };
  const heirs = dim.clusters.filter((c) => ctx.live.has(c.id) && c.lineage.includes(id))
    .sort((x, y) => x.lineage.indexOf(id) - y.lineage.indexOf(id) || clusterOrder(y, x));
  return heirs.length ? { c: heirs[0], ctx } : null;
}

// 지금 묶음이 없으면(이전 묶음이면) onArchived로 그 기록을 고친다. shown: 그 기록이 보이는 모양(묶음 기록이 아니면 null)
function withCluster(dim, id, fn, onArchived) {
  const next = clone(dim);
  const hit = findLive(next, id);
  if (hit) fn(hit.c, effective(hit.c, hit.ctx), next);
  else if (onArchived) {
    const rec = next.clusters.find((c) => c.id === id);
    if (rec) onArchived(rec, effective(rec, viewCtx(next)));
    else {
      const a = next.archived.find((x) => x.id === id);
      if (a) onArchived(a, null);
    }
  }
  return settle(next);
}

// 이름·의미: 지금 묶음이든 이전 묶음이든 같은 칸을 고친다
const setText = (field, at, max) => (dim, id, text, now) => withCluster(dim, id, (c, shown) => {
  c[field] = clip(text, max);
  c[at] = bump(now, shown[at]);
}, (a, shown) => {
  a[field] = clip(text, max);
  if (shown) a[at] = bump(now, shown[at]);
  else a.at = bump(now, a.at);
});

export const renameCluster = setText('myName', 'myNameAt', 60);
export const setClusterMeaning = setText('myMeaning', 'myMeaningAt', MAX_MEANING);

// 잠그거나 풀면 "이 실행 아래에서 내가 정한 묶음"이 된다 — 다른 기기에서 되살린 묶음을 풀어도 다음 실행 전까지 남는다.
// 지운 표시를 잠금이 이겨 보이던 묶음을 풀면 지운 표시도 거둔다 (풀자마자 사라지지 않게).
export const setClusterLocked = (dim, id, locked, now) => withCluster(dim, id, (c, shown, next) => {
  c.locked = Boolean(locked);
  c.lockedAt = bump(now, shown.lockedAt);
  c.keptAt = later(c.keptAt, next.at);
  if (!locked && c.deleted) {
    c.deleted = false;
    c.deletedAt = bump(now, c.deletedAt);
  }
});

function takeOut(c, shown, cardId, now) {
  const m = shown.members.find((x) => x.cardId === cardId);
  if (!m) return null;
  setEl(c, 'out', { cardId: m.cardId, source: m.source, at: bump(now, elAt(shown, cardId)) });
  return m;
}

function putIn(c, shown, cardId, quote, now) {
  if (shown.members.some((x) => x.cardId === cardId)) return;
  setEl(c, 'in', { cardId: clip(cardId, 20), quote: clip(str(quote), 300), source: 'me', at: bump(now, elAt(shown, cardId)) });
}

export const removeMember = (dim, id, cardId, now) => withCluster(dim, id, (c, shown) => {
  takeOut(c, shown, cardId, now);
});

export const addMember = (dim, id, cardId, quote, now) => withCluster(dim, id, (c, shown) => {
  putIn(c, shown, cardId, quote, now);
});

function newCluster(axis, name, now) {
  const rand = Math.floor(Math.random() * 1679616).toString(36);
  return { ...blankCluster(), id: `${axis}-me-${stamp(now).toString(36)}${rand}`, origin: 'me', myName: clip(name, 60), myNameAt: now, createdAt: now, keptAt: now };
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
  const target = toId ? findLive(next, toId) : null;
  if (!from || (target && target.c === from.c)) return settle(next);
  const m = takeOut(from.c, effective(from.c, from.ctx), cardId, now);
  if (!m) return settle(next);
  let to = target?.c ?? null;
  if (!to) {
    to = newCluster(axis, '', now);
    next.clusters.push(to);
  }
  putIn(to, target ? effective(to, viewCtx(next)) : to, cardId, m.quote, now);
  return settle(next);
}

// 지우면 지운 표시만 남긴다. 이름이나 의미를 쓴 묶음은 "이전 묶음"으로 보인다 (archivedList).
export function deleteCluster(dim, id, now) {
  const next = clone(dim);
  const hit = findLive(next, id);
  if (!hit || effective(hit.c, hit.ctx).locked) return settle(next);
  hit.c.deleted = true;
  // 잠금(푼 시각)보다도 늦어야 지움이 이긴다
  hit.c.deletedAt = bump(bump(now, hit.c.deletedAt), hit.c.lockedAt);
  return settle(next);
}

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
