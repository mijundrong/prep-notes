// 진입점: 잠금 해제, 헤더, 해시 라우팅, 전역 검색, 내보내기/가져오기.
// 화면(views/*)이 함께 쓰는 DOM·입력·타이머 도구도 여기서 내보낸다.

import * as vault from './crypto.js';
import * as store from './store.js';
import * as home from './views/home.js';
import * as positioning from './views/positioning.js';
import * as job from './views/job.js';
import * as company from './views/company.js';
import * as cards from './views/cards.js';
import * as pressure from './views/pressure.js';
import * as glossary from './views/glossary.js';
import * as study from './views/study.js';
import * as defense from './views/defense.js';
import * as drill from './views/drill.js';

const VIEWS = { home, positioning, job, company, cards, pressure, glossary, study, defense, drill };
const TAB_ROUTES = {
  포지셔닝: 'positioning',
  '직무 공부': 'job',
  '회사 공부': 'company',
  '서류 해부': 'cards',
  '압박 문항': 'pressure',
  '용어 사전': 'glossary',
  '공부 체크리스트': 'study',
  방어선: 'defense',
};
const DEFAULT_LABELS = {
  home: '홈', positioning: '포지셔닝', job: '직무 공부', company: '회사 공부', cards: '서류 해부',
  pressure: '압박 문항', glossary: '용어 사전', study: '공부 체크리스트', defense: '방어선', drill: '실전 모드',
};
const SEARCH_SOURCES = ['glossary', 'cards', 'pressure', 'job', 'company', 'defense'];
const SEARCH_LIMIT = 80;
const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
const THEME_LABEL = { auto: '테마: 자동', light: '테마: 라이트', dark: '테마: 다크' };
const TRANSFER_NOTE = 'PC에서 쓴 답을 휴대폰으로 옮기는 방법은 이것뿐입니다: 백업 파일 다운로드 → 다른 기기에서 가져오기.';
const MSG_WRONG = '비밀번호가 맞지 않습니다';
const MSG_NETWORK = '데이터 파일을 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.';
const MSG_INSECURE = '이 주소에서는 열 수 없습니다. https 주소(또는 localhost)로 접속하세요.';

let data = null;
let labels = { ...DEFAULT_LABELS };
let tabs = [];
let pendingFocus = null;
let searchIndex = [];
let searchTimer = null;
const cleanups = [];
const ui = {};

// ---- DOM 도구 ----

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
export const hasItems = (v) => Array.isArray(v) && v.some(nonEmpty);
export const charCount = (text) => Array.from(text ?? '').length;
export const para = (text, props) => (nonEmpty(text) ? h('p', props, text) : null);

const filled = (nodes) => nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false && n !== '');

// 내용이 하나도 없으면 null을 돌려준다 — 빈 블록은 렌더링하지 않는다.
export function section(opts, ...children) {
  const { title, id, cls } = typeof opts === 'string' ? { title: opts } : opts;
  const body = filled(children);
  if (!body.length) return null;
  return h('section', { class: cls ? `block ${cls}` : 'block', id }, h('h2', null, title), ...body);
}

export function list(items, { ordered = false, idPrefix, cls } = {}) {
  if (!hasItems(items)) return null;
  return h(ordered ? 'ol' : 'ul', { class: cls },
    items.map((text, i) => (nonEmpty(text) ? h('li', { id: idPrefix ? `${idPrefix}${i}` : null }, text) : null)));
}

export function table({ head, rows, cls = '', wide = false }) {
  const body = rows.filter(Boolean);
  if (!body.length) return null;
  const tr = (row) => {
    const r = Array.isArray(row) ? { cells: row } : row;
    return h('tr', { class: r.cls, id: r.id }, r.cells.map((cell, i) => h('td', { 'data-label': head?.[i] }, cell ?? '')));
  };
  return h('div', { class: wide ? 'table-wrap wide' : 'table-wrap' },
    h('table', { class: `data ${cls}`.trim() },
      head ? h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col' }, t)))) : null,
      h('tbody', null, body.map(tr))));
}

export function kvTable(entries, { id } = {}) {
  const rows = (Array.isArray(entries) ? entries : Object.entries(entries ?? {})).filter(([, v]) => nonEmpty(v));
  if (!rows.length) return null;
  return h('div', { class: 'table-wrap', id },
    h('table', { class: 'kv' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v))))));
}

export const badge = (text, cls) => (nonEmpty(String(text ?? '')) ? h('span', { class: cls ? `badge ${cls}` : 'badge' }, text) : null);
export const priorityBadge = (p) => badge(`우선순위 ${p}`, `prio prio-${p}`);
export const statusBadge = (status) => badge(store.STATUS_LABEL[status] ?? status, `status st-${status}`);
export const warnBox = (...children) => h('div', { class: 'warn' }, ...children);

export function collapsible(summary, body, { open = false, id, cls } = {}) {
  return h('details', { class: cls, id, open }, h('summary', null, summary), h('div', { class: 'details-body' }, body));
}

export function chipRow({ label, options, selected, onChange }) {
  const all = h('button', { type: 'button', class: 'chip' }, '전체');
  const buttons = options.map((o) => h('button', { type: 'button', class: 'chip' },
    o.text, o.count !== undefined ? h('span', { class: 'chip-count' }, String(o.count)) : null));
  const sync = () => {
    all.setAttribute('aria-pressed', String(selected.size === 0));
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(selected.has(options[i].value))));
  };
  all.addEventListener('click', () => {
    selected.clear();
    sync();
    onChange();
  });
  buttons.forEach((b, i) => b.addEventListener('click', () => {
    const v = options[i].value;
    if (selected.has(v)) selected.delete(v);
    else selected.add(v);
    sync();
    onChange();
  }));
  sync();
  return h('div', { class: 'chip-row', role: 'group', 'aria-label': label }, h('span', { class: 'chip-label' }, label), all, buttons);
}

export function statusSelect(value, onChange) {
  const select = h('select', { class: 'status-select' }, store.STATUSES.map((s) => h('option', { value: s }, store.STATUS_LABEL[s])));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return { el: h('label', { class: 'status-label' }, '상태 ', select), set: (v) => { select.value = v; } };
}

// "서류 해부: 완성 3 / 25 (우선순위 1 중 완성 2 / 15)" + 얇은 막대
export function progressRow({ label, word, done, total, extra }) {
  return h('div', { class: 'progress-row' },
    h('p', null, h('span', { class: 'progress-label' }, label), `: ${word} ${done} / ${total}`, extra ? h('span', { class: 'muted' }, ` (${extra})`) : null),
    h('progress', { value: done, max: Math.max(total, 1), 'aria-label': label }));
}

export function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlight(text, query) {
  const frag = document.createDocumentFragment();
  const q = (query ?? '').trim();
  if (!q) {
    frag.append(text);
    return frag;
  }
  let last = 0;
  for (const m of text.matchAll(new RegExp(escapeRe(q), 'gi'))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('mark', null, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// ---- 입력칸 ----

export function autosize(area) {
  if (!area || !area.isConnected || area.offsetParent === null) return;
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

export function autosizeIn(root) {
  if (!root?.querySelectorAll) return;
  if (root.matches('textarea')) autosize(root);
  for (const area of root.querySelectorAll('textarea')) autosize(area);
}

export function answerBox({ value = '', onInput, label, placeholder = '', rows = 3, id, compact = false }) {
  const area = h('textarea', { class: compact ? 'answer compact' : 'answer', rows, placeholder, id, 'aria-label': label });
  area.value = value;
  const count = h('span', { class: 'count' }, `${charCount(value)}자`);
  area.addEventListener('input', () => {
    count.textContent = `${charCount(area.value)}자`;
    autosize(area);
    onInput(area.value);
  });
  return h('div', { class: compact ? 'answer-wrap compact' : 'answer-wrap' }, area, compact ? null : h('div', { class: 'answer-meta' }, count));
}

// ---- 타이머 ----

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function onCleanup(fn) {
  cleanups.push(fn);
}

export function createTimer({ presets = [60], seconds = presets[0], overtime = false, onExpire } = {}) {
  let total = seconds;
  let startedAt = 0;
  let handle = null;
  let expired = false;
  const root = h('div', { class: 'timer' });
  const display = h('span', { class: 'timer-time', role: 'timer' }, clock(total));
  const note = h('span', { class: 'timer-note', 'aria-live': 'polite' });
  const startBtn = h('button', { type: 'button', class: 'btn' });
  const stopBtn = h('button', { type: 'button', class: 'btn', hidden: true }, '정지');
  const presetButtons = presets.length > 1
    ? presets.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => setTotal(p) }, `${p}초`))
    : [];

  const label = () => {
    startBtn.textContent = handle ? '다시 시작' : `${total}초 시작`;
    stopBtn.hidden = !handle;
    presetButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(presets[i] === total)));
  };
  const clearExpired = () => {
    expired = false;
    root.classList.remove('expired');
    note.textContent = '';
  };
  const tick = () => {
    const left = total - (performance.now() - startedAt) / 1000;
    if (left > 0) {
      display.textContent = clock(Math.ceil(left));
      return;
    }
    if (!expired) {
      expired = true;
      root.classList.add('expired');
      note.textContent = overtime ? '시간 초과' : '시간 끝';
      onExpire?.();
    }
    if (overtime) display.textContent = `+${clock(Math.floor(-left))}`;
    else {
      display.textContent = clock(0);
      stop();
    }
  };
  function start() {
    stop();
    clearExpired();
    startedAt = performance.now();
    handle = setInterval(tick, 250);
    tick();
    label();
  }
  function stop() {
    if (handle) clearInterval(handle);
    handle = null;
    label();
  }
  function setTotal(sec) {
    total = sec;
    if (handle) start();
    else {
      clearExpired();
      display.textContent = clock(total);
      label();
    }
  }
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  onCleanup(stop);
  label();
  root.append(display, startBtn, stopBtn, ...(presetButtons.length ? [h('span', { class: 'timer-presets', role: 'group', 'aria-label': '시간' }, presetButtons)] : []), note);
  return { el: root, start, stop, setTotal, isExpired: () => expired };
}

// ---- 라우팅 ----

export const tabLabel = (route) => labels[route] ?? route;

export function go(hash, focusId = null, { edit = false } = {}) {
  pendingFocus = focusId ? { id: focusId, edit } : null;
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

export function focusLink(href, focusId, ...children) {
  return h('a', { href, onclick: (e) => { e.preventDefault(); go(href, focusId); } }, ...children);
}

function parseRoute() {
  const m = /^#\/([a-z]+)(?:\/([^/?#]+))?\/?$/.exec(location.hash);
  if (!m || !VIEWS[m[1]]) return null;
  let param = null;
  try {
    param = m[2] ? decodeURIComponent(m[2]) : null;
  } catch {
    return null;
  }
  return { name: m[1], param };
}

function renderRoute() {
  const route = parseRoute();
  if (!route) {
    location.replace('#/home');
    return;
  }
  while (cleanups.length) {
    try {
      cleanups.pop()();
    } catch (err) {
      console.error(err);
    }
  }
  closeSearch();
  const focus = pendingFocus;
  pendingFocus = null;
  let node;
  try {
    node = VIEWS[route.name].render({ data, param: route.param, focus });
  } catch (err) {
    console.error(err);
    node = h('p', { class: 'error' }, '이 화면을 그리는 중 오류가 났습니다. 새로고침해 보세요.');
  }
  ui.view.replaceChildren(node);
  for (const a of ui.header.querySelectorAll('[data-route]')) {
    if (a.dataset.route === route.name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  ui.header.querySelector('.tabs [aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  store.setUi({ lastRoute: location.hash });
  autosizeIn(ui.view);
  if (focus) revealFocus(focus);
  else window.scrollTo(0, 0);
}

function revealFocus({ id, edit }) {
  const el = document.getElementById(id);
  if (!el) {
    window.scrollTo(0, 0);
    return;
  }
  for (let p = el; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  autosizeIn(el);
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
  if (edit) el.querySelector('textarea')?.focus({ preventScroll: true });
}

// ---- 헤더 ----

function buildTabs() {
  labels = { ...DEFAULT_LABELS };
  const list = [{ route: 'home', label: labels.home }];
  for (const name of data.meta?.tabs ?? []) {
    const route = TAB_ROUTES[name];
    if (!route || list.some((t) => t.route === route)) continue;
    labels[route] = name;
    list.push({ route, label: name });
  }
  for (const route of Object.values(TAB_ROUTES)) {
    if (!list.some((t) => t.route === route)) list.push({ route, label: labels[route] });
  }
  tabs = list;
}

function buildHeader() {
  buildTabs();
  ui.saveNote = h('span', { class: 'save-note', 'aria-live': 'polite' });
  ui.search = h('input', { type: 'search', class: 'search-input', placeholder: '전체 검색', 'aria-label': '전체 검색', autocomplete: 'off', enterkeyhint: 'search' });
  ui.panel = h('div', { class: 'search-panel', hidden: true, role: 'region', 'aria-label': '검색 결과' });
  ui.themeBtn = h('button', { type: 'button', class: 'btn', onclick: cycleTheme }, THEME_LABEL[store.get().ui.theme]);

  ui.header.replaceChildren(
    h('div', { class: 'bar' },
      h('div', { class: 'brand' }, h('a', { class: 'site-title', href: '#/home' }, data.meta?.title ?? ''), ui.saveNote),
      h('div', { class: 'search-box' }, ui.search),
      h('div', { class: 'tools' },
        h('a', { class: 'btn', href: '#/drill', 'data-route': 'drill' }, labels.drill),
        h('button', { type: 'button', class: 'btn', onclick: openExport }, '내보내기'),
        h('button', { type: 'button', class: 'btn', onclick: openImport }, '가져오기'),
        ui.themeBtn,
        h('button', { type: 'button', class: 'btn', onclick: lock }, '잠그기'))),
    h('nav', { class: 'tabs', 'aria-label': '탭' }, tabs.map((t) => h('a', { href: `#/${t.route}`, 'data-route': t.route }, t.label))),
    ui.panel,
  );

  ui.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(ui.search.value), 120);
  });
  ui.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.search.value = '';
      closeSearch();
      ui.search.blur();
    } else if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      runSearch(ui.search.value);
      ui.panel.querySelector('a')?.click();
    }
  });
  ui.search.addEventListener('focus', () => {
    if (ui.search.value.trim()) runSearch(ui.search.value);
  });
  document.addEventListener('click', (e) => {
    if (!ui.panel.hidden && !ui.panel.contains(e.target) && e.target !== ui.search) closeSearch();
  });
}

function cycleTheme() {
  const next = THEME_NEXT[store.get().ui.theme] ?? 'auto';
  store.setUi({ theme: next });
  applyTheme(next);
  ui.themeBtn.textContent = THEME_LABEL[next];
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function lock() {
  store.flush();
  vault.forgetKey();
  location.reload();
}

function syncBanner() {
  const banner = document.getElementById('banner');
  const off = !store.isAvailable();
  banner.hidden = !off;
  banner.textContent = off ? '이 브라우저에서는 답변이 저장되지 않습니다' : '';
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function onStoreChange({ savedAt }) {
  syncBanner();
  if (ui.saveNote && savedAt) ui.saveNote.textContent = `저장됨 ${hhmm(savedAt)}`;
}

// ---- 전역 검색 ----

function buildSearchIndex() {
  const index = [];
  const add = (source, title, href, fields, plain = title) => {
    const usable = fields.filter((f) => nonEmpty(f.text));
    if (usable.length || nonEmpty(title)) index.push({ source, title: title ?? '', plain, href, fields: usable });
  };
  const many = (items, focus, label) => (items ?? []).map((text, i) => ({ text, focus: focus(i), label }));

  (data.glossary ?? []).forEach((g, i) => {
    const focus = `glossary-${i}`;
    add('glossary', g.term, '#/glossary', [g.term, g.en, g.short, g.why, g.mine].map((text) => ({ text, focus })));
  });
  for (const c of data.cards ?? []) {
    const base = `card-${c.id}`;
    add('cards', `[${c.id}] ${c.title}`, `#/cards/${encodeURIComponent(c.id)}`, [
      { text: c.title, focus: `${base}-title` },
      ...many(c.facts, (i) => `${base}-fact-${i}`),
      ...(c.questions ?? []).map((q) => ({ text: q.hint, label: q.label, focus: `${base}-hint-${q.key}` })),
      ...many(c.caution, (i) => `${base}-caution-${i}`, '⚠'),
    ], c.title);
  }
  for (const p of data.pressure ?? []) {
    const base = `pressure-${p.id}`;
    add('pressure', `[${p.id}] ${p.title}`, `#/pressure/${encodeURIComponent(p.id)}`, [
      { text: p.title, focus: `${base}-title` },
      { text: p.prompt, focus: `${base}-prompt` },
      ...many(p.material, (i) => `${base}-material-${i}`),
      { text: p.hint, focus: `${base}-hint` },
      ...many(p.caution, (i) => `${base}-caution-${i}`, '⚠'),
    ], p.title);
  }
  const j = data.job ?? {};
  add('job', 'JD 원문', '#/job', [
    ...many(j.jd_raw, (i) => `job-jd-${i}`),
    ...Object.entries(j.jd_meta ?? {}).map(([label, text]) => ({ text, label, focus: 'job-meta' })),
  ]);
  (j.jd_translated ?? []).forEach((t, i) => {
    add('job', t.jd, '#/job', [t.jd, t.real, t.junior, t.mine].map((text) => ({ text, focus: `job-tr-${i}` })));
  });
  const u = j.unmanned_extension ?? {};
  add('job', '유·무인 확장', '#/job', [
    { text: u.headline, focus: 'job-ux-headline' },
    ...many(u.structure, (i) => `job-ux-s-${i}`),
    ...many(u.experiment_2026_08, (i) => `job-ux-e-${i}`),
    { text: u.for_junior, focus: 'job-ux-junior' },
  ]);
  const v = j.se_practice_vocab ?? {};
  add('job', 'SE 실무 어휘', '#/job', [
    { text: v.source, focus: 'job-vocab-source' },
    ...(v.items ?? []).flatMap((it, i) => [{ text: it.term, focus: `job-vocab-${i}` }, { text: it.note, label: it.term, focus: `job-vocab-${i}` }]),
  ]);
  const cp = j.career_posting_hanwha_systems ?? {};
  add('job', cp.title, '#/job', [cp.title, cp.known, cp.missing].map((text) => ({ text, focus: 'job-career' })));
  Object.entries(data.company ?? {}).forEach(([key, values], si) => {
    add('company', key, '#/company', [{ text: key, focus: `company-${si}` }, ...many(values, (i) => `company-${si}-${i}`)]);
  });
  (data.defense ?? []).forEach((r, i) => {
    const focus = `defense-${i}`;
    add('defense', r.topic, '#/defense', [
      { text: r.topic, focus }, { text: r.no, label: '❌', focus }, { text: r.yes, label: '✅', focus }, { text: r.why, focus },
    ]);
  });
  searchIndex = index;
}

function runSearch(query) {
  const q = query.trim();
  if (!q) {
    closeSearch();
    return;
  }
  const re = new RegExp(escapeRe(q), 'i');
  const hits = [];
  for (const source of SEARCH_SOURCES) {
    for (const entry of searchIndex) {
      if (entry.source !== source) continue;
      const fields = entry.fields.filter((f) => re.test(f.text));
      if (!fields.length && !re.test(entry.title)) continue;
      hits.push({ entry, fields: fields.filter((f) => f.text !== entry.plain), focus: (fields[0] ?? entry.fields[0])?.focus });
    }
  }
  ui.panel.replaceChildren(
    h('p', { class: 'search-summary' }, hits.length ? `“${q}” — ${hits.length}건` : `“${q}” — 결과 없음`),
    h('ul', { class: 'search-list' }, hits.slice(0, SEARCH_LIMIT).map((hit) => resultItem(hit, q))),
    hits.length > SEARCH_LIMIT ? h('p', { class: 'small faint' }, `처음 ${SEARCH_LIMIT}건만 보여 줍니다. 검색어를 더 구체적으로 입력하세요.`) : null,
  );
  ui.panel.hidden = false;
}

function resultItem(hit, q) {
  const { entry } = hit;
  const shown = hit.fields.slice(0, 3);
  const more = hit.fields.length - shown.length;
  const link = h('a', { class: 'search-hit', href: entry.href },
    h('span', { class: 'search-hit-head' }, badge(labels[entry.source], 'src'), ' ', h('strong', null, highlight(entry.title, q))),
    shown.map((f) => h('span', { class: 'search-snippet' }, f.label ? h('span', { class: 'snippet-label' }, `${f.label} `) : null, highlight(f.text, q))),
    more > 0 ? h('span', { class: 'search-more' }, `외 ${more}곳 일치`) : null);
  link.addEventListener('click', (e) => {
    e.preventDefault();
    closeSearch();
    go(entry.href, hit.focus);
  });
  return h('li', null, link);
}

function closeSearch() {
  clearTimeout(searchTimer);
  if (!ui.panel) return;
  ui.panel.hidden = true;
  ui.panel.replaceChildren();
}

// ---- 내보내기 / 가져오기 ----

function dialog(title, body) {
  const dlg = h('dialog', { class: 'dialog', 'aria-label': title });
  dlg.append(
    h('div', { class: 'dialog-head' }, h('h2', null, title), h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, '닫기')),
    h('p', { class: 'note' }, TRANSFER_NOTE),
    ...filled(body),
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function openExport() {
  const withMaterial = h('input', { type: 'checkbox' });
  const status = h('p', { class: 'dialog-status', role: 'status' });
  const fallback = h('textarea', { class: 'answer', rows: 10, readonly: true, hidden: true, 'aria-label': '내보낸 Markdown' });

  async function copy() {
    const md = store.toMarkdown(data, { withMaterial: withMaterial.checked });
    try {
      await navigator.clipboard.writeText(md);
      fallback.hidden = true;
      status.textContent = `클립보드에 복사했습니다 (${charCount(md)}자).`;
    } catch {
      fallback.hidden = false;
      fallback.value = md;
      fallback.focus();
      fallback.select();
      status.textContent = '자동 복사가 막혀 있습니다. 아래 내용을 직접 복사하세요.';
    }
  }

  function download() {
    const { name, body } = store.backupFile();
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent = `${name} 파일을 내려받았습니다.`;
  }

  dialog('내보내기', [
    h('h3', null, 'Markdown 복사 (첨삭 요청용)'),
    h('p', { class: 'small muted' }, '답을 쓴 카드·문항만 클립보드에 복사합니다.'),
    h('label', { class: 'check' }, withMaterial, h('span', null, '재료 포함 (확정 사실·주의 목록)')),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: copy }, 'Markdown 복사')),
    fallback,
    h('h3', null, '백업 파일 다운로드'),
    h('p', { class: 'small muted' }, '이 기기의 답변·상태·체크·메모 전체를 JSON 파일로 저장합니다. 이 파일은 평문이니 공개된 곳에 올리지 마세요.'),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: download }, '백업 파일 다운로드')),
    status,
  ]);
}

function openImport() {
  const status = h('p', { class: 'dialog-status', role: 'status' });
  const preview = h('div', { class: 'import-preview' });
  const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '백업 파일 선택' });

  file.addEventListener('change', async () => {
    preview.replaceChildren();
    status.textContent = '';
    const picked = file.files?.[0];
    if (!picked) return;
    let parsed;
    try {
      parsed = store.parseBackup(await picked.text());
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    const incoming = store.summarize(parsed.state);
    const current = store.summarize();
    const when = (d) => (d ? store.formatStamp(d) : '—');
    const rows = [
      ['서류 해부 4문 답', 'answers'], ['꼬리질문 답', 'followups'], ['압박 문항 답', 'pressure'], ['기둥 내 문장', 'pillars'],
      ['말하기 내 버전', 'scripts'], ['공부 체크리스트', 'study'], ['확인할 것', 'toConfirm'], ['용어 앎/모름', 'glossary'],
    ].map(([label, key]) => [label, String(incoming[key]), String(current[key])]);
    rows.push(['가장 최근 수정', when(incoming.latest), when(current.latest)]);
    const merge = h('input', { type: 'radio', name: 'import-mode', value: 'merge', checked: true });
    const overwrite = h('input', { type: 'radio', name: 'import-mode', value: 'overwrite' });

    const run = () => {
      const mode = overwrite.checked ? 'overwrite' : 'merge';
      if (mode === 'overwrite' && !confirm('이 기기의 현재 답변·상태·체크·메모를 모두 백업 파일 내용으로 바꿉니다. 되돌릴 수 없습니다. 계속할까요?')) return;
      store.applyImport(parsed.state, mode);
      preview.replaceChildren();
      file.value = '';
      status.textContent = mode === 'overwrite' ? '덮어썼습니다.' : '병합했습니다.';
      renderRoute();
    };

    preview.append(
      h('h3', null, '미리보기'),
      parsed.exportedAt ? h('p', { class: 'small muted' }, `백업을 만든 시각: ${when(new Date(parsed.exportedAt))}`) : null,
      table({ head: ['항목', '백업 파일', '이 기기'], rows }),
      h('fieldset', { class: 'modes' },
        h('legend', null, '가져오는 방식'),
        h('label', { class: 'check' }, merge, h('span', null, h('strong', null, '병합'), ' — 같은 위치의 값은 더 최근에 고친 쪽을 남깁니다 (기본)')),
        h('label', { class: 'check' }, overwrite, h('span', null, h('strong', null, '덮어쓰기'), ' — 이 기기의 현재 상태를 백업 내용으로 바꿉니다'))),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: run }, '가져오기 실행')),
    );
  });

  dialog('가져오기', [
    h('p', { class: 'small muted' }, '다른 기기에서 내려받은 백업 파일(prep-backup-….json)을 고르세요.'),
    h('div', { class: 'row' }, file),
    preview,
    status,
  ]);
}

// ---- 잠금 해제 ----

function setLockMessage(text) {
  document.getElementById('lock-msg').textContent = text;
}

function setBusy(busy) {
  const form = document.getElementById('lock-form');
  form.setAttribute('aria-busy', String(busy));
  for (const el of form.querySelectorAll('input, button')) el.disabled = busy;
  if (busy) setLockMessage('여는 중…');
}

async function unlockWithPassword(e) {
  e.preventDefault();
  const input = document.getElementById('pw');
  const password = input.value;
  if (!password) return;
  const remember = document.getElementById('remember').checked;
  setBusy(true);
  try {
    const env = await vault.loadEnvelope();
    const key = await vault.deriveKey(password, env);
    const opened = await vault.decrypt(key, env);
    vault.storeKey(await vault.exportKey(key), remember);
    input.value = '';
    start(opened);
  } catch (err) {
    setBusy(false);
    setLockMessage(err instanceof vault.FetchError ? MSG_NETWORK : MSG_WRONG);
    input.select();
  }
}

async function unlockWithSavedKey(saved) {
  setBusy(true);
  try {
    const env = await vault.loadEnvelope();
    const opened = await vault.decrypt(await vault.importKey(saved), env);
    start(opened);
    return true;
  } catch (err) {
    if (!(err instanceof vault.FetchError)) vault.forgetKey();
    setBusy(false);
    setLockMessage(err instanceof vault.FetchError ? MSG_NETWORK : '');
    return false;
  }
}

function start(opened) {
  data = opened;
  document.getElementById('lock').hidden = true;
  document.getElementById('app').hidden = false;
  ui.header = document.getElementById('site-header');
  ui.view = document.getElementById('view');
  buildHeader();
  buildSearchIndex();
  window.addEventListener('hashchange', renderRoute);
  if (!parseRoute()) {
    const last = store.get().ui.lastRoute;
    history.replaceState(null, '', last?.startsWith('#/') ? last : '#/home');
  }
  renderRoute();
}

async function boot() {
  store.subscribe(onStoreChange);
  store.load();
  applyTheme(store.get().ui.theme);
  window.addEventListener('pagehide', store.flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });
  document.addEventListener('toggle', (e) => autosizeIn(e.target), true);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => autosizeIn(ui.view), 150);
  });
  window.addEventListener('beforeprint', () => {
    for (const d of document.querySelectorAll('#view details:not([open])')) {
      d.open = true;
      d.dataset.printOpened = '1';
    }
  });
  window.addEventListener('afterprint', () => {
    for (const d of document.querySelectorAll('#view details[data-print-opened]')) {
      d.open = false;
      delete d.dataset.printOpened;
    }
  });

  const form = document.getElementById('lock-form');
  if (!vault.supported()) {
    for (const el of form.querySelectorAll('input, button')) el.disabled = true;
    setLockMessage(MSG_INSECURE);
    return;
  }
  form.addEventListener('submit', unlockWithPassword);
  const saved = vault.storedKey();
  if (saved && (await unlockWithSavedKey(saved))) return;
  document.getElementById('pw').focus();
}

boot();
