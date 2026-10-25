import { h, nonEmpty, hasItems, para, list, chipRow, createTimer, shuffle, go, onCleanup, priorityBadge, tabLabel } from '../app.js';
import * as store from '../store.js';

const KINDS = [
  { value: 'card', text: '서류 해부 4문' },
  { value: 'followup', text: '꼬리질문' },
  { value: 'pressure', text: '압박 문항' },
];
const TIMES = [30, 60, 90, 120];

// 설정과 세션은 답을 고치러 다녀와도 이어지도록 모듈에 둔다.
const config = { kinds: new Set(['card', 'followup', 'pressure']), priorities: new Set(), groups: new Set(), unansweredOnly: false, seconds: 60 };
const session = { active: false, bag: [], current: null, solved: 0, timeouts: 0 };

function answerOf(q) {
  if (q.kind === 'card') return store.answerText(q.card.id, q.q.key);
  if (q.kind === 'followup') return store.followupText(q.card.id, q.index);
  return store.pressure(q.item.id)?.text ?? '';
}

function buildPool(data) {
  const pool = [];
  const prioOk = (p) => !config.priorities.size || config.priorities.has(p);
  const groupOk = (g) => !config.groups.size || config.groups.has(g);
  for (const c of data.cards ?? []) {
    if (!prioOk(c.priority) || !groupOk(c.group)) continue;
    if (config.kinds.has('card')) for (const q of c.questions ?? []) pool.push({ kind: 'card', card: c, q, key: `card:${c.id}:${q.key}` });
    if (config.kinds.has('followup')) {
      (c.followups ?? []).forEach((text, index) => {
        if (nonEmpty(text)) pool.push({ kind: 'followup', card: c, index, text, key: `fu:${c.id}:${index}` });
      });
    }
  }
  if (config.kinds.has('pressure')) {
    for (const p of data.pressure ?? []) if (prioOk(p.priority)) pool.push({ kind: 'pressure', item: p, key: `p:${p.id}` });
  }
  return config.unansweredOnly ? pool.filter((q) => !answerOf(q).trim()) : pool;
}

function draw(data) {
  if (!session.bag.length) {
    const lastKey = session.current?.key;
    const fresh = shuffle(buildPool(data));
    if (fresh.length > 1 && fresh[fresh.length - 1].key === lastKey) fresh.unshift(fresh.pop());
    session.bag = fresh;
  }
  session.current = session.bag.pop() ?? null;
}

function describe(q) {
  const tab = (route) => tabLabel(route);
  if (q.kind === 'card') {
    return { eyebrow: [`${tab('cards')} 4문`, q.card.id], priority: q.card.priority, text: `[${q.card.title}] ${q.q.label}` };
  }
  if (q.kind === 'followup') {
    return { eyebrow: ['꼬리질문', q.card.id], priority: q.card.priority, text: `[${q.card.title}] ${q.text}` };
  }
  return { eyebrow: [tab('pressure'), q.item.id, q.item.title], priority: q.item.priority, text: q.item.prompt };
}

function materialOf(q) {
  const part = (title, node, cls) => (node ? h('div', { class: cls ? `drill-part ${cls}` : 'drill-part' }, h('h3', null, title), node) : null);
  if (q.kind === 'pressure') {
    const p = q.item;
    return [part('재료', list(p.material)), part('힌트', para(p.hint)), hasItems(p.caution) ? part('⚠ 주의', list(p.caution), 'warn') : null];
  }
  const c = q.card;
  return [
    q.kind === 'card' ? part('재료', para(q.q.hint)) : null,
    part('확정 사실', list(c.facts, { cls: 'facts' })),
    hasItems(c.caution) ? part('⚠ 주의', list(c.caution), 'warn') : null,
  ];
}

function editTarget(q) {
  if (q.kind === 'card') return [`#/cards/${encodeURIComponent(q.card.id)}`, `card-${q.card.id}-q-${q.q.key}`];
  if (q.kind === 'followup') return [`#/cards/${encodeURIComponent(q.card.id)}`, `card-${q.card.id}-fu-${q.index}`];
  return [`#/pressure/${encodeURIComponent(q.item.id)}`, `pressure-${q.item.id}-answer`];
}

function setupView(data, rerender) {
  const groups = [...new Set((data.cards ?? []).map((c) => c.group))];
  const poolLine = h('p', { class: 'pool-line' });
  const startBtn = h('button', { type: 'button', class: 'btn primary' }, '시작');
  const updatePool = () => {
    const n = buildPool(data).length;
    poolLine.textContent = `출제 가능: ${n}문항`;
    startBtn.disabled = n === 0;
  };

  const kindBoxes = KINDS.map((k) => h('label', { class: 'check inline' },
    h('input', {
      type: 'checkbox', checked: config.kinds.has(k.value),
      onchange: (e) => {
        if (e.target.checked) config.kinds.add(k.value);
        else config.kinds.delete(k.value);
        updatePool();
      },
    }),
    h('span', null, k.text)));
  const timeRadios = TIMES.map((s) => h('label', { class: 'check inline' },
    h('input', { type: 'radio', name: 'drill-time', checked: config.seconds === s, onchange: () => { config.seconds = s; } }),
    h('span', null, `${s}초`)));

  startBtn.addEventListener('click', () => {
    Object.assign(session, { active: true, bag: [], current: null, solved: 0, timeouts: 0 });
    draw(data);
    rerender();
  });
  updatePool();

  return [
    h('p', { class: 'muted' }, '면접처럼 질문을 하나씩 받습니다. 답하는 동안 재료와 주의는 숨겨 둡니다.'),
    h('fieldset', null, h('legend', null, '출제 범위'), h('div', { class: 'row' }, kindBoxes)),
    h('fieldset', null, h('legend', null, '필터'),
      chipRow({
        label: '우선순위',
        options: [1, 2, 3].map((p) => ({ value: p, text: String(p) })),
        selected: config.priorities,
        onChange: updatePool,
      }),
      chipRow({ label: '그룹', options: groups.map((g) => ({ value: g, text: g })), selected: config.groups, onChange: updatePool }),
      h('p', { class: 'small faint' }, '그룹 필터는 서류 해부 4문과 꼬리질문에만 적용됩니다.'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: config.unansweredOnly, onchange: (e) => { config.unansweredOnly = e.target.checked; updatePool(); } }),
        h('span', null, '아직 답 안 쓴 것만'))),
    h('fieldset', null, h('legend', null, '타이머'), h('div', { class: 'row' }, timeRadios)),
    poolLine,
    h('div', { class: 'row' }, startBtn),
  ];
}

function runningView(data, rerender, disposers) {
  const q = session.current;
  if (!q) {
    session.active = false;
    return [h('p', { class: 'empty' }, '출제할 질문이 없습니다. 설정을 바꿔 보세요.'), h('button', { type: 'button', class: 'btn', onclick: rerender }, '설정으로')];
  }
  const info = describe(q);
  const stats = h('p', { class: 'drill-stats' });
  const syncStats = () => { stats.textContent = `이번 세션: 푼 질문 ${session.solved} · 시간 초과 ${session.timeouts}`; };
  syncStats();

  let countedTimeout = false;
  const timer = createTimer({
    presets: [config.seconds],
    overtime: true,
    onExpire: () => {
      if (countedTimeout) return;
      countedTimeout = true;
      session.timeouts += 1;
      syncStats();
    },
  });

  const material = h('div', { class: 'drill-material', hidden: true }, materialOf(q));
  const materialBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false' }, '재료·주의 보기 (R)');
  const toggleMaterial = () => {
    material.hidden = !material.hidden;
    materialBtn.textContent = material.hidden ? '재료·주의 보기 (R)' : '재료·주의 숨기기 (R)';
    materialBtn.setAttribute('aria-expanded', String(!material.hidden));
  };
  materialBtn.addEventListener('click', toggleMaterial);

  const mine = answerOf(q);
  const answerPanel = h('div', { class: 'drill-answer', hidden: true }, h('h3', null, '내가 써둔 답'), h('p', { class: 'pre' }, mine));
  const answerBtn = nonEmpty(mine)
    ? h('button', {
      type: 'button', class: 'btn',
      onclick: (e) => {
        answerPanel.hidden = !answerPanel.hidden;
        e.currentTarget.textContent = answerPanel.hidden ? '내가 써둔 답 보기' : '내가 써둔 답 숨기기';
      },
    }, '내가 써둔 답 보기')
    : null;

  const next = () => {
    session.solved += 1;
    draw(data);
    rerender();
  };
  const [editHash, editFocus] = editTarget(q);

  const onKey = (e) => {
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      next();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      toggleMaterial();
    } else if (e.code === 'KeyT') {
      e.preventDefault();
      timer.start();
    }
  };
  document.addEventListener('keydown', onKey);
  disposers.push(() => document.removeEventListener('keydown', onKey), () => timer.stop());
  timer.start();

  return [
    h('div', { class: 'drill-top' }, stats,
      h('button', { type: 'button', class: 'btn small', onclick: () => { session.active = false; rerender(); } }, '설정 바꾸기')),
    h('div', { class: 'drill-q' },
      h('p', { class: 'eyebrow' }, info.eyebrow.filter(nonEmpty).join(' · '), ' ', priorityBadge(info.priority)),
      h('p', { class: 'drill-question' }, info.text)),
    timer.el,
    h('div', { class: 'row' }, materialBtn, h('button', { type: 'button', class: 'btn', onclick: () => timer.start() }, '타이머 다시 (T)')),
    material,
    h('div', { class: 'row drill-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: next }, '다음 질문 (Space)'),
      answerBtn,
      h('button', { type: 'button', class: 'btn', onclick: () => go(editHash, editFocus, { edit: true }) }, '이 질문 답 수정하러 가기')),
    answerPanel,
    h('p', { class: 'small faint keys' }, '키보드: Space 다음 질문 · R 재료 보기 · T 타이머 다시 시작'),
  ];
}

export function render({ data }) {
  const body = h('div', { class: 'drill-body' });
  const disposers = [];
  // 다시 그릴 때마다 이전 질문의 타이머와 키 입력 처리를 정리한다.
  const dispose = () => {
    for (const fn of disposers.splice(0)) fn();
  };
  const rerender = () => {
    dispose();
    body.replaceChildren(...(session.active ? runningView(data, rerender, disposers) : setupView(data, rerender)).filter(Boolean));
  };
  onCleanup(dispose);
  rerender();
  return h('div', { class: 'drill' }, h('h1', null, tabLabel('drill')), body);
}
