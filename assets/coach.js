// 물어보기 — claude.ai 안에서 열었을 때만 켜지는 Claude 대화. 내가 쓴 답 전체와 준비 자료,
// 엮기 결과가 있으면 그 요약까지 알고 질문에 답한다. 답을 대신 써 주지 않는다 (meta.principle).
// 낱칸마다 받던 피드백과 전체 점검은 없앴다 — 답 한 칸이 아니라 여러 답을 나란히 놓는 일은 엮기(weave.js)가 한다.

import { h, nonEmpty, onCleanup } from './app.js';
import * as ai from './ai.js';
import * as store from './store.js';
import { chatSummary } from './weave.js';

// ---- 응답 표시: 제목·목록·굵게만 살린 간단한 Markdown, 모두 textContent로 넣는다 ----

function inline(s) {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    .map((part) => (part.length > 4 && part.startsWith('**') && part.endsWith('**') ? h('strong', null, part.slice(2, -2)) : part));
}

export function renderNote(text) {
  const frag = document.createDocumentFragment();
  let list = null;
  let listType = '';
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      list = null;
      continue;
    }
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (head) {
      list = null;
      frag.append(h('h4', null, inline(head[1])));
    } else if (ordered || bullet) {
      const type = ordered ? 'ol' : 'ul';
      if (!list || listType !== type) {
        list = h(type);
        listType = type;
        frag.append(list);
      }
      list.append(h('li', null, inline((ordered ?? bullet)[1])));
    } else {
      list = null;
      frag.append(h('p', null, inline(line)));
    }
  }
  return frag;
}

// ---- 맥락: 지금까지 쓴 답 전체 ----

const MAX_BYTES = 230000;
const bytes = (s) => new TextEncoder().encode(s).length;

// 한도를 넘으면 뒤에서부터 자른다 (대화가 실패하는 것보다 낫다).
function cutBytes(text, max) {
  if (bytes(text) <= max) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytes(chars.slice(0, mid).join('')) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('')}\n(…이하 생략)`;
}
const bullets = (items) => (items ?? []).filter(nonEmpty).map((t) => `- ${t}`).join('\n') || '- (없음)';
const defenseLines = (data) => (data.defense ?? []).map((d) => `- ${d.topic}: ❌ ${d.no} / ✅ ${d.yes}`).join('\n');

export function answerStats(data) {
  const n = { answers: 0, followups: 0, pressure: 0, pillars: 0, scripts: 0 };
  for (const c of data.cards ?? []) {
    n.answers += (c.questions ?? []).filter((q) => store.answerText(c.id, q.key).trim()).length;
    n.followups += (c.followups ?? []).filter((_, i) => store.followupText(c.id, i).trim()).length;
  }
  n.pressure = (data.pressure ?? []).filter((p) => (store.pressure(p.id)?.text ?? '').trim()).length;
  n.pillars = (data.positioning?.pillars ?? []).filter((p) => store.pillarText(p.n).trim()).length;
  n.scripts = store.SCRIPT_KEYS.filter((k) => store.scriptText(k).trim()).length;
  n.total = n.answers + n.followups + n.pressure + n.pillars + n.scripts;
  return n;
}

export const statsLine = (n) => `4문 ${n.answers} · 꼬리질문 ${n.followups} · 압박 문항 ${n.pressure} · 기둥 ${n.pillars} · 말하기 ${n.scripts}`;

function answersDigest(data, { withMaterial }) {
  const blocks = [];
  for (const c of data.cards ?? []) {
    const qa = (c.questions ?? []).filter((q) => store.answerText(c.id, q.key).trim());
    const fus = (c.followups ?? []).map((q, i) => [q, store.followupText(c.id, i)]).filter(([, a]) => a.trim());
    if (!qa.length && !fus.length) continue;
    const lines = [`#### [${c.id}] ${c.title} (우선순위 ${c.priority}, 상태: ${store.STATUS_LABEL[store.cardStatus(c.id)]})`];
    if (withMaterial) lines.push(`확정 사실:\n${bullets(c.facts)}`, `주의:\n${bullets(c.caution)}`);
    for (const q of qa) lines.push(`- ${q.label}: ${store.answerText(c.id, q.key)}`);
    for (const [q, a] of fus) lines.push(`- 꼬리질문 "${q}": ${a}`);
    blocks.push(lines.join('\n'));
  }
  for (const p of data.pressure ?? []) {
    const text = store.pressure(p.id)?.text ?? '';
    if (!text.trim()) continue;
    const lines = [`#### [${p.id}] ${p.title} (압박 문항, 우선순위 ${p.priority})`, `- 면접관: "${p.prompt}"`];
    if (withMaterial) lines.push(`주의:\n${bullets(p.caution)}`);
    lines.push(`- 답: ${text}`);
    blocks.push(lines.join('\n'));
  }
  for (const p of data.positioning?.pillars ?? []) {
    const text = store.pillarText(p.n);
    if (text.trim()) blocks.push(`#### 기둥 ${store.circled(p.n)} ${p.title} — 내 문장\n${text}`);
  }
  for (const [key, label] of [['intro60', '자기소개 60초'], ['whyme90', 'Why Me 90초']]) {
    const text = store.scriptText(key);
    if (text.trim()) blocks.push(`#### ${label} — 내 버전\n${text}`);
  }
  return blocks.join('\n\n');
}

function chatContext(data) {
  const pos = data.positioning ?? {};
  const pillars = (pos.pillars ?? []).map((p) => `- ${store.circled(p.n)} ${p.title}: ${p.line}`).join('\n');
  const head = [
    `너는 "${data.meta?.title ?? ''}"을(를) 준비하는 지원자의 질문에 답한다. 아래 자료와 지원자가 쓴 답 전체를 알고 있다.`,
    '지켜야 할 것:',
    `1. 답을 대신 써 주지 않는다. 생각할 거리와 이유, 방향만 말하고 예시 문장이나 완성 답안은 쓰지 않는다. 지원자의 원칙: "${data.meta?.principle ?? ''}"`,
    '2. 사실 판단은 아래 자료에 근거한다. 자료에 없는 경력·수치·역할을 지어내지 않는다.',
    '3. [방어선]의 ❌ 표현과 같은 뜻의 말이 답에 있으면 짚고, ✅ 쪽 방향을 알려 준다.',
    '4. 한국어로, 짧고 구체적으로. 600자 이내.',
    '',
    `[한 줄 명제] ${pos.thesis?.core ?? ''}`,
    `[다섯 기둥]\n${pillars}`,
    `[방어선 — ❌ 하지 않을 말 / ✅ 이렇게 말한다]\n${defenseLines(data)}`,
  ].join('\n');
  const weave = chatSummary(data);
  let digest = answersDigest(data, { withMaterial: true });
  if (bytes(head + weave + digest) > MAX_BYTES) digest = cutBytes(answersDigest(data, { withMaterial: false }), MAX_BYTES - bytes(head + weave) - 200);
  return [head, weave, `[지원자가 쓴 답]\n${digest || '(아직 없음)'}`, '이제 지원자의 질문이 이어진다.'].filter(Boolean).join('\n\n');
}

// ---- 대화: 이 화면을 연 동안만 기억한다 (화면을 옮겨도 진행 중인 답은 계속 받는다) ----

const turns = [];
let job = null;
const jobListeners = new Set();

export function chatPanel(data) {
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const box = h('textarea', { class: 'answer compact', rows: 2, placeholder: '예: 지금 답 중에 근거가 가장 약한 건 어디인가요?', 'aria-label': 'Claude에게 질문' });
  const send = h('button', { type: 'button', class: 'btn primary' }, '보내기');
  const stop = h('button', { type: 'button', class: 'btn', hidden: true }, '중지');
  const status = h('span', { class: 'chat-status', role: 'status' });
  const clear = h('button', { type: 'button', class: 'btn small' }, '대화 지우기');

  const bubble = (role, text) => h('div', { class: `chat-turn ${role}` },
    h('p', { class: 'chat-who' }, role === 'user' ? '나' : 'Claude'),
    role === 'user' ? h('p', { class: 'pre' }, text) : h('div', null, renderNote(text)));

  const paint = () => {
    log.replaceChildren(...turns.map((t) => bubble(t.role, t.content)));
    if (job?.active) log.append(job.text ? bubble('assistant', job.text) : h('p', { class: 'chat-status' }, '생각하는 중…'));
    if (job?.error && job.error !== 'cancelled') status.textContent = ai.errorText(job.error);
    send.disabled = Boolean(job?.active);
    stop.hidden = !job?.active;
    clear.hidden = !turns.length || Boolean(job?.active);
  };

  const ask = () => {
    const question = box.value.trim();
    if (!ai.available() || !question || job?.active) return;
    status.textContent = '';
    turns.push({ role: 'user', content: question });
    box.value = '';
    const current = { active: true, text: '', error: null, ctl: new AbortController() };
    job = current;
    const input = [{ role: 'user', content: chatContext(data) }, ...turns.slice(-12)];
    ai.ask(input, {
      modelTier: 'default', cache: false, signal: current.ctl.signal,
      onText: ({ text }) => {
        current.text = text;
        jobListeners.forEach((fn) => fn());
      },
    }).then((res) => {
      turns.push({ role: 'assistant', content: res.text });
      job = null;
    }, (e) => {
      current.error = e.code;
      current.active = false;
      current.text = '';
    }).finally(() => jobListeners.forEach((fn) => fn()));
    paint();
  };

  send.addEventListener('click', ask);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask();
  });
  stop.addEventListener('click', () => job?.ctl.abort());
  clear.addEventListener('click', () => {
    turns.length = 0;
    job = null;
    status.textContent = '';
    paint();
  });
  jobListeners.add(paint);
  onCleanup(() => jobListeners.delete(paint));
  paint();
  return h('div', { class: 'chat' }, log, box, h('div', { class: 'chat-bar' }, send, stop, clear, status));
}
