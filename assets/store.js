// 사용자 상태(답변·체크·메모·엮기·설정)를 이 기기의 localStorage에 평문으로 저장한다.
// GitHub Pages에서는 서버로 아무것도 보내지 않는다. claude.ai 안에서 열면 sync.js가
// 같은 상태를 문서 단위(docBody/mergeDoc)로 나눠 계정의 비공개 저장소와 맞춘다.

import * as model from './weave-model.js';

const KEY = 'prep:state:v1';
const SAVE_DELAY = 300;

export const STATUSES = ['todo', 'draft', 'done'];
export const STATUS_LABEL = { todo: '미작성', draft: '초안', done: '완성' };
export const SCRIPT_KEYS = ['intro60', 'whyme90'];
const QUESTION_KEYS = ['why', 'what', 'learned', 'apply'];
const THEMES = ['auto', 'light', 'dark'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MISC_KEYS = ['pillars', 'scripts', 'study', 'toConfirm', 'glossary'];
const FLAT_KEYS = ['pressure', ...MISC_KEYS, 'identity', 'myPositioning'];
// 없앤 기능(문항별 Claude 피드백·전체 점검)의 저장값. 읽으면 버린다.
const OBSOLETE_KEYS = ['feedback', 'review'];

let state = blankState();
let available = true;
let dirty = false;
let timer = null;
let savedAt = null;
const listeners = new Set();
const docListeners = new Set();

export function blankState() {
  return {
    version: 1,
    cards: {},
    pressure: {},
    pillars: {},
    scripts: {},
    study: {},
    toConfirm: {},
    glossary: {},
    weave: { dims: {}, thread: null, runs: [] },
    identity: {},
    compare: null,
    myPositioning: {},
    ui: { theme: 'auto', lastRoute: '#/home' },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.setItem(KEY + ':probe', '1');
    localStorage.removeItem(KEY + ':probe');
    if (raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
        state = normalize(parsed);
      } catch {
        // 깨진 값은 지우지 않고 옆에 보관한 뒤 빈 상태로 시작한다.
        localStorage.setItem(KEY + ':broken', raw);
        state = blankState();
      }
      if (isObj(parsed) && OBSOLETE_KEYS.some((k) => own(parsed, k))) {
        dirty = true;
        flush();
      }
    }
  } catch {
    available = false;
    state = blankState();
  }
  emit();
}

export const get = () => state;
export const isAvailable = () => available;
export const lastSavedAt = () => savedAt;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 동기화용: 바뀐 문서 id를 바로 알려 준다.
export function onDocChange(fn) {
  docListeners.add(fn);
  return () => docListeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn({ available, savedAt });
}

function touch(docId) {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY);
  if (docId) for (const fn of docListeners) fn(docId);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!dirty) return;
  dirty = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    savedAt = new Date();
  } catch {
    available = false;
  }
  emit();
}

const now = () => new Date().toISOString();
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const clone = (v) => JSON.parse(JSON.stringify(v));
const hasText = (entry) => Boolean(entry && typeof entry.text === 'string' && entry.text.trim());

// ---- 읽기 ----

export const card = (id) => (own(state.cards, id) ? state.cards[id] : null);
export const cardStatus = (id) => card(id)?.status ?? 'todo';
export const answerText = (id, key) => card(id)?.answers?.[key]?.text ?? '';
// 제출본: { text, updatedAt(제출 시각) } — 제출하지 않았으면 null
export const submitted = (id, key) => (hasText(card(id)?.submitted?.[key]) ? card(id).submitted[key] : null);
export const submittedCount = (id) => QUESTION_KEYS.filter((k) => submitted(id, k)).length;
// 덮어쓰기로 지운 코멘트는 { cleared, at }만 남는다 (다른 기기의 옛 코멘트를 이기도록). 읽을 때는 없는 것으로 본다.
export const cardComment = (id) => {
  const c = card(id)?.comment;
  return c && !c.cleared ? c : null;
};
export const followupText = (id, index) => card(id)?.followups?.[index]?.text ?? '';
export const answeredCount = (id) => QUESTION_KEYS.filter((k) => answerText(id, k).trim()).length;
export const pressure = (id) => (own(state.pressure, id) ? state.pressure[id] : null);
export const pressureStatus = (id) => pressure(id)?.status ?? 'todo';
export const pillarText = (n) => state.pillars[n]?.text ?? '';
export const scriptText = (key) => state.scripts[key]?.text ?? '';
export const study = (id) => (own(state.study, id) ? state.study[id] : null);
export const toConfirm = (index) => state.toConfirm[index] ?? null;
export const known = (term) => (own(state.glossary, term) ? state.glossary[term].known : null);
export const weaveDim = (axis) => (model.AXES.includes(axis) ? state.weave.dims[axis] ?? null : null);
export const weaveThread = () => state.weave.thread;
export const weaveRuns = () => state.weave.runs;
export const identityText = (key) => (own(state.identity, key) ? state.identity[key].text : '');
export const compare = () => state.compare;
export const myPositioning = (target) => (own(state.myPositioning, target) && hasText(state.myPositioning[target]) ? state.myPositioning[target] : null);

// ---- 쓰기 ----

const cardDoc = (id) => `card_${id}`;
const dimDoc = (axis) => `weave_${axis}`;

function ensureCard(id) {
  if (!own(state.cards, id)) state.cards[id] = { status: 'todo', choice: null, updatedAt: null, answers: {}, followups: {}, submitted: {}, comment: null };
  return state.cards[id];
}

export function setAnswer(id, key, text) {
  ensureCard(id).answers[key] = { text, updatedAt: now() };
  touch(cardDoc(id));
}

// 지금 답을 제출본으로 남긴다. 카드 코멘트는 제출본만 본다.
export function submitAnswer(id, key) {
  const text = answerText(id, key);
  if (!text.trim()) return;
  ensureCard(id).submitted[key] = { text, updatedAt: now() };
  touch(cardDoc(id));
}

// result: 검증을 마친 Claude 사실 대조, basis: 그때 제출본 해시 { why: …, … }
export function setCardComment(id, { result, basis }) {
  ensureCard(id).comment = { result, basis, at: now() };
  touch(cardDoc(id));
}

export function setFollowup(id, index, text) {
  ensureCard(id).followups[index] = { text, updatedAt: now() };
  touch(cardDoc(id));
}

export function setCardStatus(id, status) {
  const c = ensureCard(id);
  c.status = status;
  c.updatedAt = now();
  touch(cardDoc(id));
}

export function setCardChoice(id, choice) {
  const c = ensureCard(id);
  c.choice = choice;
  c.updatedAt = now();
  touch(cardDoc(id));
}

export function setPressure(id, patch) {
  const prev = pressure(id) ?? { status: 'todo', text: '' };
  state.pressure[id] = { ...prev, ...patch, updatedAt: now() };
  touch('pressure');
}

export function setPillar(n, text) {
  state.pillars[n] = { text, updatedAt: now() };
  touch('misc');
}

export function setScript(key, text) {
  state.scripts[key] = { text, updatedAt: now() };
  touch('misc');
}

export function setStudy(id, patch) {
  const prev = study(id) ?? { done: false, note: '' };
  state.study[id] = { ...prev, ...patch, updatedAt: now() };
  touch('misc');
}

export function setToConfirm(index, patch) {
  const prev = toConfirm(index) ?? { done: false, note: '' };
  state.toConfirm[index] = { ...prev, ...patch, updatedAt: now() };
  touch('misc');
}

export function setKnown(term, value) {
  state.glossary[term] = { known: value, updatedAt: now() };
  touch('misc');
}

export function setUi(patch) {
  state.ui = { ...state.ui, ...patch };
  touch();
}

// 엮기: 축 하나의 묶음 결과와 내 편집. 편집 함수는 weave-model.js에 있다.
function setDim(axis, dim) {
  state.weave.dims[axis] = dim;
  touch(dimDoc(axis));
}

export function applyWeaveAxis(axis, result, { basis, basisHash }) {
  setDim(axis, model.applyRun(weaveDim(axis), result, { axis, basis, basisHash, at: now() }));
}

const editDim = (fn) => (axis, ...args) => {
  const dim = weaveDim(axis);
  if (dim) setDim(axis, fn(dim, ...args, now()));
};

export const renameCluster = editDim(model.renameCluster);
export const setClusterMeaning = editDim(model.setClusterMeaning);
export const setClusterLocked = editDim(model.setClusterLocked);
export const removeClusterMember = editDim(model.removeMember);
export const deleteCluster = editDim(model.deleteCluster);

export function addClusterMember(axis, id, cardId, quote = '') {
  const dim = weaveDim(axis);
  if (dim) setDim(axis, model.addMember(dim, id, cardId, quote, now()));
}

export function moveClusterMember(axis, fromId, cardId, toId) {
  const dim = weaveDim(axis);
  if (dim) setDim(axis, model.moveMember(dim, axis, fromId, cardId, toId, now()));
}

export function createCluster(axis, name = '') {
  const { dim, id } = model.createCluster(weaveDim(axis) ?? model.emptyDim(), axis, name, now());
  setDim(axis, dim);
  return id;
}

export function setWeaveThread({ result, basis, basisHash, dimsAt }) {
  state.weave.thread = { result, basis, basisHash, dimsAt, at: now() };
  touch('weave_thread');
}

// 같은 실행(at)이면 바꿔 넣는다 — 실패한 단계를 다시 돌린 결과도 한 줄로. 기기 사이에서는 updatedAt이 늦은 쪽을 남긴다.
export function recordWeaveRun(entry) {
  state.weave.runs = model.normalizeRuns([...state.weave.runs.filter((r) => r.at !== entry.at), { ...entry, updatedAt: now() }]);
  touch('weave_thread');
}

export function setIdentity(key, text) {
  state.identity[key] = { text, updatedAt: now() };
  touch('identity');
}

export function setCompare(result) {
  state.compare = { result, at: now(), decisions: {} };
  touch('compare');
}

export function setDecision(index, value) {
  if (!state.compare) return;
  state.compare.decisions[index] = { value, updatedAt: now() };
  touch('compare');
}

// text가 빈 문자열이면 내 버전을 지운다 (다른 기기에도 지워진 채로 퍼지도록 시각은 남긴다).
// fromProposal: 이 문구가 온 대조 제안 ("대조 시각#번호")
export function setMyPositioning(target, text, fromProposal = null) {
  state.myPositioning[target] = { text, updatedAt: now(), fromProposal };
  touch('myPositioning');
}

// ---- 정규화: 저장된 값과 가져온 백업, 다른 기기의 문서를 같은 모양으로 맞춘다 ----

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const entries = (v) => (isObj(v) ? Object.entries(v).filter(([k]) => !UNSAFE_KEYS.has(k)) : []);
const str = (v) => (typeof v === 'string' ? v : '');
const time = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const textEntry = (v) => ({ text: str(v?.text), updatedAt: time(v?.updatedAt) });

const clip = (s, n) => (Array.from(s).length > n ? Array.from(s).slice(0, n).join('') : s);
const QUESTION_KEY = (v) => (QUESTION_KEYS.includes(v) ? v : null);
const qQuote = (v) => (isObj(v) && QUESTION_KEY(v.q) && str(v.quote) ? { q: v.q, quote: clip(v.quote, 300) } : null);

// 카드 코멘트(사실 대조): facts — 확정 사실·주의와 어긋남, defense — 방어선, conflicts — 4문끼리 부딪힘
function normalizeComment(v) {
  if (!isObj(v)) return null;
  if (v.cleared === true) return time(v.at) ? { cleared: true, at: v.at } : null;
  if (!isObj(v.result)) return null;
  const r = v.result;
  const list = (x) => (Array.isArray(x) ? x : []);
  const basis = {};
  if (isObj(v.basis)) for (const k of QUESTION_KEYS) if (/^[0-9a-f]{8}$/.test(str(v.basis[k]))) basis[k] = v.basis[k];
  return {
    result: {
      facts: list(r.facts).map((f) => (qQuote(f) && str(f.against)
        ? { ...qQuote(f), against: clip(f.against, 400), kind: f.kind === 'caution' ? 'caution' : 'fact', note: clip(str(f.note), 160) } : null)).filter(Boolean).slice(0, 20),
      defense: list(r.defense).map((d) => (qQuote(d) && str(d.topic) ? { ...qQuote(d), topic: clip(d.topic, 60), note: clip(str(d.note), 160) } : null)).filter(Boolean).slice(0, 20),
      conflicts: list(r.conflicts).map((c) => (isObj(c) && qQuote(c.a) && qQuote(c.b) ? { a: qQuote(c.a), b: qQuote(c.b), note: clip(str(c.note), 160) } : null)).filter(Boolean).slice(0, 20),
    },
    basis,
    at: time(v.at),
  };
}

function normalizeCard(c) {
  const next = {
    status: STATUSES.includes(c.status) ? c.status : 'todo',
    choice: typeof c.choice === 'string' ? c.choice : null,
    updatedAt: time(c.updatedAt),
    answers: {},
    followups: {},
    submitted: {},
    comment: normalizeComment(c.comment),
  };
  for (const [k, a] of entries(c.answers)) if (QUESTION_KEYS.includes(k) && isObj(a)) next.answers[k] = textEntry(a);
  for (const [i, a] of entries(c.followups)) if (/^\d+$/.test(i) && isObj(a)) next.followups[i] = textEntry(a);
  for (const [k, a] of entries(c.submitted)) if (QUESTION_KEYS.includes(k) && isObj(a)) next.submitted[k] = textEntry(a);
  return next;
}

function normalizeSection(key, raw) {
  const out = {};
  for (const [k, v] of entries(raw)) {
    if (!isObj(v)) continue;
    if (key === 'pressure') out[k] = { status: STATUSES.includes(v.status) ? v.status : 'todo', text: str(v.text), updatedAt: time(v.updatedAt) };
    else if (key === 'pillars') out[k] = textEntry(v);
    else if (key === 'scripts') { if (SCRIPT_KEYS.includes(k)) out[k] = textEntry(v); }
    else if (key === 'study') out[k] = { done: v.done === true, note: str(v.note), updatedAt: time(v.updatedAt) };
    else if (key === 'toConfirm') { if (/^\d+$/.test(k)) out[k] = { done: v.done === true, note: str(v.note), updatedAt: time(v.updatedAt) }; }
    else if (key === 'glossary') out[k] = { known: typeof v.known === 'boolean' ? v.known : null, updatedAt: time(v.updatedAt) };
    else if (key === 'identity') { if (model.IDENTITY_KEYS.includes(k)) out[k] = textEntry(v); }
    else if (key === 'myPositioning') {
      if (model.MY_POSITIONING_KEY.test(k)) out[k] = { ...textEntry(v), fromProposal: typeof v.fromProposal === 'string' ? v.fromProposal.slice(0, 60) : null };
    }
  }
  return out;
}

function normalizeWeave(raw) {
  const w = isObj(raw) ? raw : {};
  const dims = {};
  for (const axis of model.AXES) {
    const dim = model.normalizeDim(isObj(w.dims) ? w.dims[axis] : null);
    if (dim) dims[axis] = dim;
  }
  return { dims, thread: model.normalizeThread(w.thread), runs: model.normalizeRuns(w.runs) };
}

function normalize(raw) {
  const s = blankState();
  if (!isObj(raw)) return s;
  for (const [id, c] of entries(raw.cards)) if (isObj(c)) s.cards[id] = normalizeCard(c);
  for (const key of FLAT_KEYS) s[key] = normalizeSection(key, raw[key]);
  s.weave = normalizeWeave(raw.weave);
  s.compare = model.normalizeCompare(raw.compare);
  if (isObj(raw.ui)) {
    if (THEMES.includes(raw.ui.theme)) s.ui.theme = raw.ui.theme;
    if (typeof raw.ui.lastRoute === 'string' && raw.ui.lastRoute.startsWith('#/')) s.ui.lastRoute = raw.ui.lastRoute;
  }
  return s;
}

// ---- 병합: 같은 위치의 값은 updatedAt이 더 최근인 쪽을 남긴다. 같으면 이 기기 값을 남긴다 ----

const stamp = (v) => (v?.updatedAt ? Date.parse(v.updatedAt) : 0);
// 시각이 같으면 내용으로 정한다 — 어느 기기에서 합쳐도 같은 쪽이 남아야 동기화가 멈춘다.
const newer = (a, b) => (stamp(b) > stamp(a) || (stamp(b) === stamp(a) && model.canon(b) > model.canon(a)) ? b : a);

function mergeFlat(base, incoming) {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming)) out[k] = own(base, k) ? newer(base[k], v) : v;
  return out;
}

const commentStamp = (c) => (c?.at ? Date.parse(c.at) : 0);
const laterComment = (x, y) => (commentStamp(y) > commentStamp(x) || (commentStamp(y) === commentStamp(x) && model.canon(y) > model.canon(x)) ? y : x);

function mergeCard(a, b) {
  if (!a || !b) return clone(a ?? b);
  // 상태·후보는 카드의 updatedAt으로 고른다. 동점이면 이 세 값만 비교한다 (카드 전체는 합치면 바뀌어 승자가 뒤집힌다).
  const head = newer({ status: a.status, choice: a.choice, updatedAt: a.updatedAt }, { status: b.status, choice: b.choice, updatedAt: b.updatedAt });
  return clone({
    status: head.status,
    choice: head.choice,
    updatedAt: head.updatedAt,
    answers: mergeFlat(a.answers, b.answers),
    followups: mergeFlat(a.followups, b.followups),
    submitted: mergeFlat(a.submitted, b.submitted),
    comment: laterComment(a.comment, b.comment),
  });
}

function mergeWeave(a, b) {
  const dims = {};
  for (const axis of model.AXES) {
    const dim = model.mergeDim(a.dims[axis] ?? null, b.dims[axis] ?? null);
    if (dim) dims[axis] = dim;
  }
  return { dims, thread: model.mergeThread(a.thread, b.thread), runs: model.mergeRuns(a.runs, b.runs) };
}

export function merge(base, incoming) {
  const out = blankState();
  out.ui = { ...base.ui };
  const ids = new Set([...Object.keys(base.cards), ...Object.keys(incoming.cards)]);
  for (const id of ids) out.cards[id] = mergeCard(base.cards[id], incoming.cards[id]);
  for (const key of FLAT_KEYS) out[key] = mergeFlat(base[key], incoming[key]);
  out.weave = mergeWeave(base.weave, incoming.weave);
  out.compare = model.mergeCompare(base.compare, incoming.compare);
  return clone(out);
}

// ---- 동기화 문서: 카드마다 하나, 압박 문항 하나, 나머지 하나, 엮기는 축마다 하나와 실 하나, 정의·대조·내 포지셔닝 하나씩 ----

const SINGLE_DOCS = ['identity', 'compare', 'myPositioning'];

// 없앤 기능의 문서(문항별 피드백 fb_*, 전체 점검 review). sync.js가 계정 저장소에서 지운다.
export const isObsoleteDoc = (docId) => docId.startsWith('fb_') || docId === 'review';

export function docIds() {
  const ids = new Set(Object.keys(state.cards).map(cardDoc));
  if (Object.keys(state.pressure).length) ids.add('pressure');
  if (MISC_KEYS.some((k) => Object.keys(state[k]).length)) ids.add('misc');
  for (const axis of model.AXES) if (state.weave.dims[axis]) ids.add(dimDoc(axis));
  if (state.weave.thread || state.weave.runs.length) ids.add('weave_thread');
  for (const id of SINGLE_DOCS) if (docBody(id)) ids.add(id);
  return [...ids];
}

// 문서 본문(JSON 객체). 비어 있으면 null.
export function docBody(docId) {
  if (docId.startsWith('card_')) {
    const id = docId.slice(5);
    return own(state.cards, id) ? { v: 1, card: clone(state.cards[id]) } : null;
  }
  if (docId === 'pressure') return Object.keys(state.pressure).length ? { v: 1, pressure: clone(state.pressure) } : null;
  if (docId === 'misc') {
    if (!MISC_KEYS.some((k) => Object.keys(state[k]).length)) return null;
    return { v: 1, ...Object.fromEntries(MISC_KEYS.map((k) => [k, clone(state[k])])) };
  }
  if (docId.startsWith('weave_') && docId !== 'weave_thread') {
    const dim = weaveDim(docId.slice(6));
    return dim ? { v: 1, dim: clone(dim) } : null;
  }
  if (docId === 'weave_thread') {
    const { thread, runs } = state.weave;
    return thread || runs.length ? { v: 1, thread: clone(thread), runs: clone(runs) } : null;
  }
  if (docId === 'identity') return Object.keys(state.identity).length ? { v: 1, identity: clone(state.identity) } : null;
  if (docId === 'compare') return state.compare ? { v: 1, compare: clone(state.compare) } : null;
  if (docId === 'myPositioning') return Object.keys(state.myPositioning).length ? { v: 1, myPositioning: clone(state.myPositioning) } : null;
  return null;
}

// 다른 기기에서 온 문서를 합친다. 이 기기 상태가 바뀌었으면 true.
export function mergeDoc(docId, body) {
  if (!isObj(body) || isObsoleteDoc(docId)) return false;
  const before = JSON.stringify(docBody(docId));
  if (docId.startsWith('card_') && isObj(body.card)) {
    const id = docId.slice(5);
    if (UNSAFE_KEYS.has(id)) return false;
    state.cards[id] = mergeCard(own(state.cards, id) ? state.cards[id] : null, normalizeCard(body.card));
  } else if (docId === 'pressure') {
    state.pressure = mergeFlat(state.pressure, normalizeSection('pressure', body.pressure));
  } else if (docId === 'misc') {
    for (const key of MISC_KEYS) state[key] = mergeFlat(state[key], normalizeSection(key, body[key]));
  } else if (docId === 'weave_thread') {
    state.weave.thread = model.mergeThread(state.weave.thread, model.normalizeThread(body.thread));
    state.weave.runs = model.mergeRuns(state.weave.runs, model.normalizeRuns(body.runs));
  } else if (docId.startsWith('weave_') && model.AXES.includes(docId.slice(6))) {
    const axis = docId.slice(6);
    const dim = model.mergeDim(weaveDim(axis), model.normalizeDim(body.dim));
    if (dim) state.weave.dims[axis] = dim;
  } else if (docId === 'identity' || docId === 'myPositioning') {
    state[docId] = mergeFlat(state[docId], normalizeSection(docId, body[docId]));
  } else if (docId === 'compare') {
    state.compare = model.mergeCompare(state.compare, model.normalizeCompare(body.compare));
  } else {
    return false;
  }
  const changed = JSON.stringify(docBody(docId)) !== before;
  if (changed) touch();
  return changed;
}

// ---- 백업 ----

const pad = (n) => String(n).padStart(2, '0');

export function formatStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function backupFile() {
  flush();
  const d = new Date();
  const name = `prep-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const body = JSON.stringify({ ...state, exportedAt: d.toISOString() }, null, 2);
  return { name, body };
}

export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일이 아닙니다.');
  }
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.cards)) throw new Error('이 사이트의 백업 파일이 아닙니다.');
  return { state: normalize(raw), exportedAt: time(raw.exportedAt) };
}

const CLUSTER_STAMPS = ['myNameAt', 'myMeaningAt', 'lockedAt', 'membersAt', 'deletedAt'];

function eachStamp(s, fn) {
  for (const c of Object.values(s.cards)) {
    fn(c.updatedAt);
    for (const a of Object.values(c.answers)) fn(a.updatedAt);
    for (const a of Object.values(c.followups)) fn(a.updatedAt);
    for (const a of Object.values(c.submitted)) fn(a.updatedAt);
    fn(c.comment?.at);
  }
  for (const key of FLAT_KEYS) {
    for (const v of Object.values(s[key])) fn(v.updatedAt);
  }
  for (const dim of Object.values(s.weave.dims)) {
    fn(dim.at);
    for (const c of dim.clusters) for (const k of CLUSTER_STAMPS) fn(c[k]);
  }
  fn(s.weave.thread?.at);
  if (s.compare) {
    fn(s.compare.at);
    for (const d of Object.values(s.compare.decisions)) fn(d.updatedAt);
  }
}

export function summarize(s = state) {
  let latest = 0;
  eachStamp(s, (t) => {
    const ms = t ? Date.parse(t) : 0;
    if (ms > latest) latest = ms;
  });
  const marked = (v) => v.done || v.note.trim();
  const cards = Object.values(s.cards);
  return {
    answers: cards.reduce((n, c) => n + Object.values(c.answers).filter(hasText).length, 0),
    followups: cards.reduce((n, c) => n + Object.values(c.followups).filter(hasText).length, 0),
    submitted: cards.reduce((n, c) => n + Object.values(c.submitted).filter(hasText).length, 0),
    comments: cards.filter((c) => c.comment && !c.comment.cleared).length,
    pressure: Object.values(s.pressure).filter(hasText).length,
    pillars: Object.values(s.pillars).filter(hasText).length,
    scripts: Object.values(s.scripts).filter(hasText).length,
    study: Object.values(s.study).filter(marked).length,
    toConfirm: Object.values(s.toConfirm).filter(marked).length,
    glossary: Object.values(s.glossary).filter((v) => v.known !== null).length,
    clusters: Object.values(s.weave.dims).reduce((n, dim) => n + model.liveClusters(dim).length, 0),
    identity: Object.values(s.identity).filter(hasText).length,
    myPositioning: Object.values(s.myPositioning).filter(hasText).length,
    latest: latest ? new Date(latest) : null,
  };
}

// 덮어쓰기는 가져온 값의 시각을 지금으로 바꿔, 다른 기기와 합칠 때도 이 내용이 이기게 한다.
function restamp(s, t) {
  for (const c of Object.values(s.cards)) {
    c.updatedAt = t;
    for (const a of Object.values(c.answers)) a.updatedAt = t;
    for (const a of Object.values(c.followups)) a.updatedAt = t;
    for (const a of Object.values(c.submitted)) a.updatedAt = t;
    if (c.comment) c.comment.at = t;
  }
  for (const key of FLAT_KEYS) for (const v of Object.values(s[key])) v.updatedAt = t;
  // 실이 어느 축 결과로 엮였는지(dimsAt)도 같이 옮겨야 "그 뒤로 묶음이 다시 만들어졌습니다"가 거짓으로 뜨지 않는다.
  const dimsAt = s.weave.thread?.dimsAt ?? {};
  for (const [axis, dim] of Object.entries(s.weave.dims)) {
    if (dimsAt[axis] && dimsAt[axis] === dim.at) dimsAt[axis] = t;
    dim.at = t;
    for (const c of dim.clusters) for (const k of CLUSTER_STAMPS) if (c[k]) c[k] = t;
  }
  if (s.weave.thread) s.weave.thread.at = t;
  if (s.compare) {
    s.compare.at = t;
    for (const d of Object.values(s.compare.decisions)) d.updatedAt = t;
  }
  return s;
}

// 이 기기와 계정 저장소(동기화가 받아 둔 문서)에 있는 칸 이름들
function knownKeys(s, remote) {
  const cards = new Map();
  const flat = Object.fromEntries(FLAT_KEYS.map((k) => [k, new Set()]));
  const addCard = (id, c) => {
    if (UNSAFE_KEYS.has(id)) return;
    const k = cards.get(id) ?? { answers: new Set(), followups: new Set(), submitted: new Set(), comment: false };
    for (const part of ['answers', 'followups', 'submitted']) for (const key of Object.keys(c[part])) k[part].add(key);
    if (c.comment && !c.comment.cleared) k.comment = true;
    cards.set(id, k);
  };
  for (const [id, c] of Object.entries(s.cards)) addCard(id, c);
  for (const key of FLAT_KEYS) for (const k of Object.keys(s[key])) flat[key].add(k);
  for (const [docId, body] of remote) {
    if (!isObj(body)) continue;
    if (docId.startsWith('card_') && isObj(body.card)) addCard(docId.slice(5), normalizeCard(body.card));
    else if (docId === 'pressure') for (const k of Object.keys(normalizeSection('pressure', body.pressure))) flat.pressure.add(k);
    else if (docId === 'misc') for (const key of MISC_KEYS) for (const k of Object.keys(normalizeSection(key, body[key]))) flat[key].add(k);
    else if (docId === 'identity' || docId === 'myPositioning') for (const k of Object.keys(normalizeSection(docId, body[docId]))) flat[docId].add(k);
  }
  return { cards, flat };
}

const EMPTY = {
  pressure: (t) => ({ status: 'todo', text: '', updatedAt: t }),
  pillars: (t) => ({ text: '', updatedAt: t }),
  scripts: (t) => ({ text: '', updatedAt: t }),
  study: (t) => ({ done: false, note: '', updatedAt: t }),
  toConfirm: (t) => ({ done: false, note: '', updatedAt: t }),
  glossary: (t) => ({ known: null, updatedAt: t }),
  identity: (t) => ({ text: '', updatedAt: t }),
  myPositioning: (t) => ({ text: '', updatedAt: t, fromProposal: null }),
};

// 백업에 없는 칸은 "빈 값 + 지금 시각"으로 남긴다. 그래야 계정 저장소와 다른 기기에서도 지워진다.
function eraseMissing(next, known, t) {
  for (const key of FLAT_KEYS) for (const k of known.flat[key]) if (!own(next[key], k)) next[key][k] = EMPTY[key](t);
  for (const [id, k] of known.cards) {
    if (!own(next.cards, id)) next.cards[id] = { status: 'todo', choice: null, updatedAt: t, answers: {}, followups: {}, submitted: {}, comment: null };
    const c = next.cards[id];
    for (const part of ['answers', 'followups', 'submitted']) for (const key of k[part]) if (!own(c[part], key)) c[part][key] = { text: '', updatedAt: t };
    if (k.comment && !c.comment) c.comment = { cleared: true, at: t };
  }
}

// 값 안의 가장 늦은 시각 (at, updatedAt, …At 필드)
function latestStamp(value, acc = 0) {
  if (Array.isArray(value)) return value.reduce((m, v) => latestStamp(v, m), acc);
  if (!value || typeof value !== 'object') return acc;
  let m = acc;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && (k === 'at' || k.endsWith('At'))) m = Math.max(m, Date.parse(v) || 0);
    else if (v && typeof v === 'object') m = latestStamp(v, m);
  }
  return m;
}

// remote: 동기화가 계정 저장소에서 받아 둔 문서 [[문서 id, 본문], …] (덮어쓰기 때 지울 칸을 찾는 데 쓴다)
export function applyImport(incoming, mode, { remote = [] } = {}) {
  if (mode === 'overwrite') {
    // 알고 있는 어떤 편집보다도 늦은 시각이어야 지운 값이 동점 없이 이긴다 (다른 기기 시계가 앞서 있어도).
    const t = new Date(Math.max(Date.now(), latestStamp(state) + 1, latestStamp(remote) + 1)).toISOString();
    const next = restamp(clone(incoming), t);
    eraseMissing(next, knownKeys(state, remote), t);
    state = { ...next, ui: { ...state.ui } };
  } else {
    state = merge(state, incoming);
  }
  dirty = true;
  flush();
  for (const id of docIds()) for (const fn of docListeners) fn(id);
}

// ---- Markdown 내보내기 (첨삭 요청용) ----

function quoteList(title, items) {
  const list = (items ?? []).filter((t) => t.trim());
  if (!list.length) return [];
  return [`> **${title}**`, ...list.map((t) => `> - ${t}`)];
}

function weaveMarkdown(data) {
  const out = [];
  const title = (id) => {
    const item = (data.cards ?? []).find((c) => c.id === id) ?? (data.pressure ?? []).find((p) => p.id === id);
    return item ? `[${id}] ${item.title}` : `[${id}]`;
  };
  const axisBlocks = [];
  for (const axis of model.AXES) {
    const clusters = model.liveClusters(weaveDim(axis));
    if (!clusters.length) continue;
    const info = model.AXIS_INFO[axis];
    const lines = [`### ${info.label} — ${info.meaning}`];
    for (const c of clusters) {
      lines.push(`#### ${model.clusterName(c)}${c.myName.trim() ? '' : ' (Claude가 붙인 이름)'}`);
      if (c.myMeaning.trim()) lines.push(`- 내 의미: ${c.myMeaning.trim()}`);
      lines.push(`- 경험: ${c.members.map((m) => title(m.cardId)).join(', ') || '(없음)'}`);
    }
    axisBlocks.push(lines.join('\n'));
  }
  if (axisBlocks.length) out.push('## 엮기 — 축별 묶음', '', axisBlocks.join('\n\n'), '');

  const result = weaveThread()?.result;
  if (result && (result.chains.length || result.timeline.length)) {
    const lines = [];
    const ids = (list) => (list.length ? ` (${list.join(', ')})` : '');
    if (result.chains.length) lines.push('### 반복되는 흐름', ...result.chains.map((c) => `- **${c.name}** — ${c.pattern}${ids(c.cards)}`));
    if (result.timeline.length) {
      if (lines.length) lines.push('');
      lines.push('### 시간순', ...result.timeline.map((t) => `- **${t.stage}**${ids(t.cards)}: 달라진 것 — ${t.shift || '—'} / 그대로인 것 — ${t.kept || '—'}`));
    }
    out.push('## 실 (Claude 엮기)', '', lines.join('\n'), '');
  }

  const mine = model.IDENTITY_KEYS.filter((k) => identityText(k).trim()).map((k) => `### ${model.IDENTITY_LABEL[k]}\n${identityText(k)}`);
  if (mine.length) out.push('## 정의하기', '', mine.join('\n\n'), '');

  const versions = model.positioningTargets(data).filter((t) => myPositioning(t.target)).map((t) => `### ${t.label}\n${myPositioning(t.target).text}`);
  if (versions.length) out.push('## 내 포지셔닝', '', versions.join('\n\n'), '');
  return out;
}

export function toMarkdown(data, { withMaterial = false } = {}) {
  flush();
  const out = [`# 면접 답변 내보내기 — ${formatStamp(new Date())}`, ''];

  const cardBlocks = [];
  for (const c of data.cards ?? []) {
    const qa = (c.questions ?? []).filter((q) => answerText(c.id, q.key).trim());
    const fus = (c.followups ?? []).map((q, i) => [q, followupText(c.id, i)]).filter(([, a]) => a.trim());
    if (!qa.length && !fus.length) continue;
    const lines = [`### [${c.id}] ${c.title} (상태: ${STATUS_LABEL[cardStatus(c.id)]})`];
    for (const q of qa) lines.push(`**${q.label}**`, answerText(c.id, q.key));
    for (const [q, a] of fus) lines.push(`- 꼬리질문: ${q} → ${a}`);
    const choice = card(c.id)?.choice;
    if ((c.options ?? []).length && choice) lines.push(`- 선택한 후보: ${choice}`);
    if (withMaterial) {
      const quoted = [...quoteList('확정 사실', c.facts), ...quoteList('주의', c.caution)];
      if (quoted.length) lines.push('', ...quoted);
    }
    cardBlocks.push(lines.join('\n'));
  }
  if (cardBlocks.length) out.push('## 서류 해부', '', cardBlocks.join('\n\n'), '');

  const pressureBlocks = [];
  for (const p of data.pressure ?? []) {
    const text = pressure(p.id)?.text ?? '';
    if (!text.trim()) continue;
    const lines = [`### [${p.id}] ${p.title} (상태: ${STATUS_LABEL[pressureStatus(p.id)]})`, text];
    if (withMaterial) {
      const quoted = [...quoteList('재료', p.material), ...quoteList('주의', p.caution)];
      if (quoted.length) lines.push('', ...quoted);
    }
    pressureBlocks.push(lines.join('\n'));
  }
  if (pressureBlocks.length) out.push('## 압박 문항', '', pressureBlocks.join('\n\n'), '');

  const mine = [];
  for (const p of data.positioning?.pillars ?? []) {
    const text = pillarText(p.n);
    if (text.trim()) mine.push(`### 기둥 ${circled(p.n)} ${p.title}\n${text}`);
  }
  for (const [key, label] of [['intro60', '자기소개 60초'], ['whyme90', 'Why Me 90초']]) {
    const text = scriptText(key);
    if (text.trim()) mine.push(`### ${label} — 내 버전\n${text}`);
  }
  if (mine.length) out.push('## 포지셔닝 — 내 문장', '', mine.join('\n\n'), '');

  out.push(...weaveMarkdown(data));

  if (out.length === 2) out.push('(아직 작성한 답이 없습니다)', '');
  return out.join('\n');
}

export function circled(n) {
  return Number.isInteger(n) && n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
}
