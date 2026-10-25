// 사용자 상태(답변·체크·메모·설정)를 이 기기의 localStorage에 평문으로 저장한다.
// 서버로는 아무것도 보내지 않는다. 기기 간 이동은 백업 내보내기/가져오기뿐이다.

const KEY = 'prep:state:v1';
const SAVE_DELAY = 300;

export const STATUSES = ['todo', 'draft', 'done'];
export const STATUS_LABEL = { todo: '미작성', draft: '초안', done: '완성' };
export const SCRIPT_KEYS = ['intro60', 'whyme90'];
const QUESTION_KEYS = ['why', 'what', 'learned', 'apply'];
const THEMES = ['auto', 'light', 'dark'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

let state = blankState();
let available = true;
let dirty = false;
let timer = null;
let savedAt = null;
const listeners = new Set();

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
    ui: { theme: 'auto', lastRoute: '#/home' },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.setItem(KEY + ':probe', '1');
    localStorage.removeItem(KEY + ':probe');
    if (raw) {
      try {
        state = normalize(JSON.parse(raw));
      } catch {
        // 깨진 값은 지우지 않고 옆에 보관한 뒤 빈 상태로 시작한다.
        localStorage.setItem(KEY + ':broken', raw);
        state = blankState();
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

function emit() {
  for (const fn of listeners) fn({ available, savedAt });
}

function touch() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY);
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
export const followupText = (id, index) => card(id)?.followups?.[index]?.text ?? '';
export const answeredCount = (id) => QUESTION_KEYS.filter((k) => answerText(id, k).trim()).length;
export const pressure = (id) => (own(state.pressure, id) ? state.pressure[id] : null);
export const pressureStatus = (id) => pressure(id)?.status ?? 'todo';
export const pillarText = (n) => state.pillars[n]?.text ?? '';
export const scriptText = (key) => state.scripts[key]?.text ?? '';
export const study = (id) => (own(state.study, id) ? state.study[id] : null);
export const toConfirm = (index) => state.toConfirm[index] ?? null;
export const known = (term) => (own(state.glossary, term) ? state.glossary[term].known : null);

// ---- 쓰기 ----

function ensureCard(id) {
  if (!own(state.cards, id)) state.cards[id] = { status: 'todo', choice: null, updatedAt: null, answers: {}, followups: {} };
  return state.cards[id];
}

export function setAnswer(id, key, text) {
  ensureCard(id).answers[key] = { text, updatedAt: now() };
  touch();
}

export function setFollowup(id, index, text) {
  ensureCard(id).followups[index] = { text, updatedAt: now() };
  touch();
}

export function setCardStatus(id, status) {
  const c = ensureCard(id);
  c.status = status;
  c.updatedAt = now();
  touch();
}

export function setCardChoice(id, choice) {
  const c = ensureCard(id);
  c.choice = choice;
  c.updatedAt = now();
  touch();
}

export function setPressure(id, patch) {
  const prev = pressure(id) ?? { status: 'todo', text: '' };
  state.pressure[id] = { ...prev, ...patch, updatedAt: now() };
  touch();
}

export function setPillar(n, text) {
  state.pillars[n] = { text, updatedAt: now() };
  touch();
}

export function setScript(key, text) {
  state.scripts[key] = { text, updatedAt: now() };
  touch();
}

export function setStudy(id, patch) {
  const prev = study(id) ?? { done: false, note: '' };
  state.study[id] = { ...prev, ...patch, updatedAt: now() };
  touch();
}

export function setToConfirm(index, patch) {
  const prev = toConfirm(index) ?? { done: false, note: '' };
  state.toConfirm[index] = { ...prev, ...patch, updatedAt: now() };
  touch();
}

export function setKnown(term, value) {
  state.glossary[term] = { known: value, updatedAt: now() };
  touch();
}

export function setUi(patch) {
  state.ui = { ...state.ui, ...patch };
  touch();
}

// ---- 정규화: 저장된 값과 가져온 백업을 같은 모양으로 맞춘다 ----

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const entries = (v) => (isObj(v) ? Object.entries(v).filter(([k]) => !UNSAFE_KEYS.has(k)) : []);
const str = (v) => (typeof v === 'string' ? v : '');
const time = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const textEntry = (v) => ({ text: str(v?.text), updatedAt: time(v?.updatedAt) });

function normalize(raw) {
  const s = blankState();
  if (!isObj(raw)) return s;
  for (const [id, c] of entries(raw.cards)) {
    if (!isObj(c)) continue;
    const next = {
      status: STATUSES.includes(c.status) ? c.status : 'todo',
      choice: typeof c.choice === 'string' ? c.choice : null,
      updatedAt: time(c.updatedAt),
      answers: {},
      followups: {},
    };
    for (const [k, a] of entries(c.answers)) if (QUESTION_KEYS.includes(k) && isObj(a)) next.answers[k] = textEntry(a);
    for (const [i, a] of entries(c.followups)) if (/^\d+$/.test(i) && isObj(a)) next.followups[i] = textEntry(a);
    s.cards[id] = next;
  }
  for (const [id, p] of entries(raw.pressure)) {
    if (!isObj(p)) continue;
    s.pressure[id] = { status: STATUSES.includes(p.status) ? p.status : 'todo', text: str(p.text), updatedAt: time(p.updatedAt) };
  }
  for (const [n, p] of entries(raw.pillars)) if (isObj(p)) s.pillars[n] = textEntry(p);
  for (const [k, p] of entries(raw.scripts)) if (SCRIPT_KEYS.includes(k) && isObj(p)) s.scripts[k] = textEntry(p);
  for (const [id, v] of entries(raw.study)) {
    if (isObj(v)) s.study[id] = { done: v.done === true, note: str(v.note), updatedAt: time(v.updatedAt) };
  }
  for (const [i, v] of entries(raw.toConfirm)) {
    if (/^\d+$/.test(i) && isObj(v)) s.toConfirm[i] = { done: v.done === true, note: str(v.note), updatedAt: time(v.updatedAt) };
  }
  for (const [term, v] of entries(raw.glossary)) {
    if (isObj(v)) s.glossary[term] = { known: typeof v.known === 'boolean' ? v.known : null, updatedAt: time(v.updatedAt) };
  }
  if (isObj(raw.ui)) {
    if (THEMES.includes(raw.ui.theme)) s.ui.theme = raw.ui.theme;
    if (typeof raw.ui.lastRoute === 'string' && raw.ui.lastRoute.startsWith('#/')) s.ui.lastRoute = raw.ui.lastRoute;
  }
  return s;
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

function eachStamp(s, fn) {
  for (const c of Object.values(s.cards)) {
    fn(c.updatedAt);
    for (const a of Object.values(c.answers)) fn(a.updatedAt);
    for (const a of Object.values(c.followups)) fn(a.updatedAt);
  }
  for (const group of [s.pressure, s.pillars, s.scripts, s.study, s.toConfirm, s.glossary]) {
    for (const v of Object.values(group)) fn(v.updatedAt);
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
    pressure: Object.values(s.pressure).filter(hasText).length,
    pillars: Object.values(s.pillars).filter(hasText).length,
    scripts: Object.values(s.scripts).filter(hasText).length,
    study: Object.values(s.study).filter(marked).length,
    toConfirm: Object.values(s.toConfirm).filter(marked).length,
    glossary: Object.values(s.glossary).filter((v) => v.known !== null).length,
    latest: latest ? new Date(latest) : null,
  };
}

const stamp = (v) => (v?.updatedAt ? Date.parse(v.updatedAt) : 0);
const newer = (a, b) => (stamp(b) > stamp(a) ? b : a);

function mergeFlat(base, incoming) {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming)) out[k] = own(base, k) ? newer(base[k], v) : v;
  return out;
}

// 같은 위치의 값은 updatedAt이 더 최근인 쪽을 남긴다. 같으면 이 기기 값을 남긴다.
export function merge(base, incoming) {
  const out = blankState();
  out.ui = { ...base.ui };
  const ids = new Set([...Object.keys(base.cards), ...Object.keys(incoming.cards)]);
  for (const id of ids) {
    const a = base.cards[id];
    const b = incoming.cards[id];
    if (!a || !b) {
      out.cards[id] = clone(a ?? b);
      continue;
    }
    const head = newer(a, b);
    out.cards[id] = {
      status: head.status,
      choice: head.choice,
      updatedAt: head.updatedAt,
      answers: mergeFlat(a.answers, b.answers),
      followups: mergeFlat(a.followups, b.followups),
    };
  }
  for (const key of ['pressure', 'pillars', 'scripts', 'study', 'toConfirm', 'glossary']) {
    out[key] = mergeFlat(base[key], incoming[key]);
  }
  return clone(out);
}

export function applyImport(incoming, mode) {
  const next = mode === 'overwrite' ? { ...clone(incoming), ui: { ...state.ui } } : merge(state, incoming);
  state = next;
  dirty = true;
  flush();
}

// ---- Markdown 내보내기 (첨삭 요청용) ----

function quoteList(title, items) {
  const list = (items ?? []).filter((t) => t.trim());
  if (!list.length) return [];
  return [`> **${title}**`, ...list.map((t) => `> - ${t}`)];
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

  if (out.length === 2) out.push('(아직 작성한 답이 없습니다)', '');
  return out.join('\n');
}

export function circled(n) {
  return Number.isInteger(n) && n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
}
