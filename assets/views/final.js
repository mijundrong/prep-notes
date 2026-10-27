// 최종 보고서 화면 (#/final, claude.ai판에서만). 저장된 Markdown 버전을 코드로 그린다 — 버전 고르기, 이전 버전과 바뀐 섹션 표시,
// 인쇄(PDF), Markdown 복사, HTML 파일로 저장. 인쇄·저장본에는 네비게이션·단추·스크립트·앱 링크가 없다.
// 엮기 탭 맨 아래 [최종 보고서 만들기]로 온다.

import { h, tabLabel, onCleanup, saveFile, focusLink, charCount } from '../app.js';
import * as ai from '../ai.js';
import * as store from '../store.js';
import * as weave from '../weave.js';
import * as final from '../final.js';

const pad = (n) => String(n).padStart(2, '0');
// 고른 버전(at) — 화면을 오가도 유지한다. 없으면 가장 최근.
let picked = null;

function duration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`;
}

// ---- Markdown → DOM: final.js가 만든 모양(제목, 문단, 목록, 표, 인용 블록, 굵게, 앱 링크)만 읽는다 ----

const ESCAPABLE = /[\\`*_[\]|<>#]/;
const unescape = (s) => s.replace(/\\([\\`*_[\]|<>#])/g, '$1');

// 이스케이프를 건너뛰며 닫는 ** 를 찾는다
function closing(text, from) {
  for (let j = from; j < text.length - 1; j++) {
    if (text[j] === '\\') {
      j += 1;
      continue;
    }
    if (text[j] === '*' && text[j + 1] === '*') return j;
  }
  return -1;
}

// 보고서 안 링크: 카드 문항(제목에 문항 key)이나 압박 문항 답 칸으로 간다
function appLink(label, href, key) {
  const card = /^#\/cards\/([^/]+)$/.exec(href);
  const pressure = /^#\/pressure\/([^/]+)$/.exec(href);
  const id = decodeURIComponent((card ?? pressure)?.[1] ?? '');
  const focus = card ? (key ? `card-${id}-q-${key}` : `card-${id}-title`) : pressure ? `pressure-${id}-answer` : null;
  return focusLink(href, focus, label);
}

function inline(text) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (text.startsWith('**', i)) {
      const end = closing(text, i + 2);
      if (end > 0) {
        flush();
        out.push(h('strong', null, inline(text.slice(i + 2, end))));
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '[') {
      const m = /^\[([^\]\n]*)\]\((#\/[^\s)]*)(?: "([a-z]+)")?\)/.exec(text.slice(i));
      if (m) {
        flush();
        out.push(appLink(m[1], m[2], m[3]));
        i += m[0].length;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

function cells(row) {
  const s = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let cur = '';
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length) {
      cur += s[j] + s[j + 1];
      j += 1;
    } else if (s[j] === '|') {
      out.push(cur.trim());
      cur = '';
    } else cur += s[j];
  }
  out.push(cur.trim());
  return out;
}

const BLOCK_START = /^(#{1,3} |>|\||- |\d+\. |:::)/;

// 제목(#·##)이 아닌 블록 하나를 읽어 put으로 넣고 다음 줄 번호를 돌려준다
function block(lines, i, put) {
  const line = lines[i];
  let m;
  if (!line.trim()) return i + 1;
  if ((m = /^### (.*)$/.exec(line))) {
    put(h('h3', null, inline(m[1])));
    return i + 1;
  }
  if (line === ':::claude') {
    // Claude가 쓰거나 고른 부분: 보라색 칸과 "Claude 보고서" 머리표
    const box = h('div', { class: 'ai-out' }, h('p', { class: 'ai-tag' }, final.CLAUDE_TAG));
    let j = i + 1;
    while (j < lines.length && lines[j] !== ':::') j = block(lines, j, (el) => box.append(el));
    put(box);
    return j + 1;
  }
  if (line.startsWith('>')) {
    // 내 글: 줄마다 붙인 "> "만 떼고 글자 그대로
    const body = [];
    while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^> ?/, ''));
    put(h('blockquote', { class: 'verbatim' }, h('p', { class: 'pre' }, body.join('\n'))));
    return i;
  }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
    const [head = [], , ...body] = rows;
    put(h('div', { class: 'table-wrap' }, h('table', { class: 'data final-table' },
      h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col' }, inline(c))))),
      h('tbody', null, body.map((r) => h('tr', null, r.map((c, k) => h('td', { 'data-label': unescape(head[k] ?? '') }, inline(c)))))))));
    return i;
  }
  if (line.startsWith('- ')) {
    const items = [];
    while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
    put(h('ul', null, items.map((t) => h('li', null, inline(t)))));
    return i;
  }
  if (/^\d+\. /.test(line)) {
    const items = [];
    while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
    put(h('ol', null, items.map((t) => h('li', null, inline(t)))));
    return i;
  }
  const para = [];
  while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) para.push(lines[i++]);
  if (!para.length) return i + 1;
  put(h('p', null, inline(para.join(' '))));
  return i;
}

export function renderMarkdown(md, { changed = new Set() } = {}) {
  const root = h('div', { class: 'md' });
  let box = root;
  const lines = md.split('\n');
  for (let i = 0; i < lines.length;) {
    let m;
    if ((m = /^# (.*)$/.exec(lines[i]))) {
      root.append(h('h1', null, inline(m[1])));
      i += 1;
    } else if ((m = /^## (\d+)\. (.*)$/.exec(lines[i]))) {
      const n = Number(m[1]);
      box = h('section', { class: changed.has(n) ? 'final-sec changed' : 'final-sec', id: `final-s${n}` },
        h('h2', null, `${n}. `, inline(m[2]), changed.has(n) ? h('span', { class: 'badge changed-badge no-print' }, '이전 버전과 달라짐') : null));
      root.append(box);
      i += 1;
    } else {
      const target = box;
      i = block(lines, i, (el) => target.append(el));
    }
  }
  return root;
}

// ---- 저장 ----

async function saveHtml(article, at) {
  const css = await fetch('assets/styles.css', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const doc = document.implementation.createHTMLDocument('최종 보고서');
  doc.documentElement.lang = 'ko';
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const viewport = doc.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', 'width=device-width, initial-scale=1');
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.prepend(charset, viewport);
  doc.head.append(style);
  const copy = article.cloneNode(true);
  for (const el of copy.querySelectorAll('.no-print, button, select, script')) el.remove();
  for (const a of copy.querySelectorAll('a')) a.replaceWith(...a.childNodes);
  const main = doc.createElement('main');
  main.className = 'view';
  main.append(doc.importNode(copy, true));
  doc.body.append(main);
  const d = new Date(at);
  const name = `prep-final-report-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`;
  return saveFile({ name, body: `<!doctype html>\n${doc.documentElement.outerHTML}\n`, type: 'text/html' });
}

// ---- 화면 ----

function dropNote(d) {
  if (!d) return '';
  const parts = [];
  if (d.quotes) parts.push(`내 답에 없는 인용 ${d.quotes}개`);
  if (d.questions) parts.push(`근거가 없거나 맞지 않은 질문 ${d.questions}개`);
  if (d.refs) parts.push(`없는 근거 번호 ${d.refs}개`);
  if (d.other) parts.push(`자료와 맞지 않는 흐름·인용 ${d.other}개`);
  return parts.length ? `확인에서 ${parts.join(', ')}를 버렸습니다.` : '';
}

export function render({ data }) {
  if (!ai.available()) {
    return h('div', { class: 'final' },
      h('h1', null, tabLabel('final')),
      h('p', { class: 'muted' }, '최종 보고서는 claude.ai에서 이 사이트를 열었을 때만 만들고 볼 수 있습니다. 내가 쓴 글을 모아 보려면 "자료 모음"을 쓰세요.'));
  }
  const run = h('button', { type: 'button', class: 'btn primary', onclick: () => final.start(data) });
  const stop = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => final.stop() }, '중지');
  const progress = h('p', { class: 'small muted', role: 'status' });
  const select = h('select', { class: 'version-select', 'aria-label': '보고서 버전' });
  const versionNote = h('p', { class: 'small faint' });
  const toolStatus = h('p', { class: 'small', role: 'status' });
  const fallback = h('textarea', { class: 'answer', rows: 8, readonly: true, hidden: true, 'aria-label': '보고서 Markdown' });
  const body = h('div', { class: 'final-body' });
  const tools = h('div', { class: 'row report-tools' });
  let tick = null;
  let shownAt = null;

  const current = () => {
    const list = store.reports();
    return list.find((r) => r.at === picked) ?? list[list.length - 1] ?? null;
  };

  const paintBody = () => {
    const list = store.reports();
    const r = current();
    shownAt = r?.at ?? null;
    select.replaceChildren(...[...list].reverse().map((x, i) => h('option', { value: x.at }, `${store.formatStamp(new Date(x.at))}${i === 0 ? ' (최근)' : ''}`)));
    select.hidden = list.length < 2;
    if (r) select.value = r.at;
    tools.hidden = !r;
    if (!r) {
      versionNote.textContent = '';
      body.replaceChildren(h('p', { class: 'small faint' }, '아직 만든 보고서가 없습니다.'));
      return;
    }
    const index = list.indexOf(r);
    const previous = index > 0 ? list[index - 1] : null;
    const changed = final.changedSections(r.markdown, previous?.markdown);
    const notes = [];
    if (previous) notes.push(changed.size ? `이전 버전(${store.formatStamp(new Date(previous.at))})과 바뀐 섹션: ${[...changed].join(' · ')}` : `이전 버전(${store.formatStamp(new Date(previous.at))})과 같은 내용`);
    else notes.push('첫 버전');
    if (index === list.length - 1 && r.basisHash !== final.basisNow(data)) notes.push('이 보고서 이후 바뀐 재료가 있습니다 — 다시 만들면 반영됩니다');
    versionNote.textContent = notes.join(' · ');
    body.replaceChildren(h('article', { class: 'final-report' }, renderMarkdown(r.markdown, { changed })));
  };

  const paint = () => {
    const job = final.state();
    const st = final.readiness();
    run.textContent = store.reports().length ? '다시 만들기' : '보고서 만들기';
    run.disabled = !st.ready || weave.busy();
    stop.hidden = !job?.active;
    if (job?.active) progress.textContent = `${job.chars ? `쓰는 중… ${job.chars.toLocaleString()}자` : '생각하는 중… (1~3분 걸릴 수 있습니다)'} · ${duration(Date.now() - job.startedAt)} · 이 화면을 떠나지 마세요`;
    else if (job?.error && job.error !== 'cancelled') progress.textContent = ai.errorText(job.error);
    else if (!st.ready) progress.textContent = `${st.missing.join(', ')} — 이것이 있어야 만들 수 있습니다 (엮기 탭).`;
    else progress.textContent = [dropNote(job?.dropped), job?.cut ? '긴 압박 문항 답 일부를 줄여 보냈습니다.' : ''].filter(Boolean).join(' ');
    if (job?.active && !tick) tick = setInterval(paint, 1000);
    if (!job?.active && tick) {
      clearInterval(tick);
      tick = null;
    }
    const latest = store.reports().at(-1)?.at ?? null;
    if (!job?.active && latest !== shownAt && (picked === null || picked === latest || !store.reports().some((x) => x.at === picked))) {
      picked = null;
      paintBody();
    }
  };

  select.addEventListener('change', () => {
    picked = select.value;
    paintBody();
  });

  async function copy() {
    const r = current();
    if (!r) return;
    const md = final.plainMarkdown(r.markdown);
    try {
      await navigator.clipboard.writeText(md);
      fallback.hidden = true;
      toolStatus.textContent = `클립보드에 복사했습니다 (${charCount(md)}자).`;
    } catch {
      fallback.hidden = false;
      fallback.value = md;
      fallback.focus();
      fallback.select();
      toolStatus.textContent = '자동 복사가 막혀 있습니다. 아래 내용을 직접 복사하세요.';
    }
  }

  tools.append(
    h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, '인쇄 / PDF로 저장'),
    h('button', { type: 'button', class: 'btn', onclick: copy }, 'Markdown 복사'),
    h('button', { type: 'button', class: 'btn', onclick: async () => {
      const article = body.querySelector('.final-report');
      if (article) toolStatus.textContent = await saveHtml(article, current()?.at ?? Date.now());
    } }, 'HTML 파일로 저장'));

  onCleanup(final.onChange(paint));
  onCleanup(() => clearInterval(tick));
  paintBody();
  paint();
  return h('div', { class: 'final' },
    h('div', { class: 'no-print' },
      h('h1', null, tabLabel('final')),
      h('p', { class: 'muted' }, `면접 전날·당일 30분 안에 읽는 내 공부 문서입니다. 1·5섹션의 내 문단과 3섹션의 내 메모는 저장된 원문 그대로이고, 보라색 "${final.CLAUDE_TAG}" 칸은 Claude가 내 답과 자료에서 골라 정리한 것입니다(인용은 코드로 확인). 카드 답 전문과 방어선 표 전체는 "자료 모음"에 있습니다.`),
      h('div', { class: 'row report-tools' }, run, stop, select),
      progress,
      versionNote,
      tools,
      toolStatus,
      fallback),
    body);
}
