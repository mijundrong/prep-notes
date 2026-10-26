// 엮기 탭 (claude.ai판에서만): 재료 현황 → 실행·진행 → 축별 묶음(내가 고친다) → 실 → 정의하기(내가 쓴다) → 포지셔닝과 대조.
// Claude가 낸 것은 .ai-out(다른 배경색과 "Claude 엮기" 머리표), 내가 쓰는 칸은 보통 입력칸으로 둔다.

import { h, nonEmpty, para, section, collapsible, answerBox, autosizeIn, focusLink, badge, aiBox, tabLabel, onCleanup, showToast } from '../app.js';
import * as ai from '../ai.js';
import * as store from '../store.js';
import * as weave from '../weave.js';
import {
  AXES, AXIS_INFO, IDENTITY_KEYS, IDENTITY_LABEL, liveClusters, looseCards, clusterName, positioningTargets, versionId,
} from '../weave-model.js';

// 접기 섹션은 다시 그려도 열린 채로 둔다.
const openAxes = new Set();
const NEW = '__new';

const when = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? store.formatStamp(new Date(iso)) : '');

function duration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`;
}

// 카드·압박 문항 id → 그 화면으로 가는 링크. axis가 있으면 그 문항으로.
function itemLink(ctx, id, axis, { withTitle = true } = {}) {
  const c = ctx.cards.get(id);
  if (c) {
    const focus = axis ? `card-${id}-q-${axis}` : `card-${id}-title`;
    return focusLink(`#/cards/${encodeURIComponent(id)}`, focus, h('span', { class: 'mono' }, id), withTitle ? ` ${c.title}` : '');
  }
  const p = ctx.pressure.get(id);
  if (p) return focusLink(`#/pressure/${encodeURIComponent(id)}`, `pressure-${id}-answer`, h('span', { class: 'mono' }, id), withTitle ? ` ${p.title}` : '');
  return h('span', { class: 'mono' }, id);
}

const idChips = (ctx, ids) => (ids.length ? h('span', { class: 'id-chips' }, ids.map((id) => [itemLink(ctx, id, null, { withTitle: false }), ' '])) : null);

const quoteLine = (ctx, q) => h('p', { class: 'ai-quote' }, `“${q.quote}”`, ' ', h('span', { class: 'small' }, itemLink(ctx, q.cardId, null, { withTitle: false })));

// ---- 재료 현황 ----

function lastWeaveAt() {
  const stamps = [...AXES.map((axis) => store.weaveDim(axis)?.at), store.weaveThread()?.at].filter(Boolean);
  return stamps.sort().pop() ?? null;
}

function statusBlock(ctx) {
  const st = weave.materialStatus(ctx.data);
  const runs = store.weaveRuns();
  const last = runs[runs.length - 1];
  const times = last?.steps?.length
    ? h('p', { class: 'small faint' }, `지난 실행(${when(last.at)}): `, last.steps.map((s) => `${s.key === 'thread' ? '엮기' : AXIS_INFO[s.key]?.step ?? s.key} ${s.ms !== null ? duration(s.ms) : '—'}${s.ok ? '' : ' (실패)'}`).join(' · '))
    : null;
  return section({ title: '재료 현황', id: 'weave-status' },
    h('p', { class: 'material-line' },
      AXES.map((axis) => h('span', { class: st.counts[axis] < weave.MIN_ANSWERS ? 'short' : null }, `${AXIS_INFO[axis].label} ${st.counts[axis]}/${st.total}`)).flatMap((el, i) => (i ? [' · ', el] : [el])),
      ` · 압박 문항 답 ${st.pressure}/${st.pressureTotal}`),
    h('p', { class: 'small muted' }, st.changed === null
      ? '아직 엮기 전입니다.'
      : `마지막 엮기 ${when(lastWeaveAt())} · 그 뒤로 바뀐 답 ${st.changed}개${st.changed ? ' — 다시 엮어야 반영됩니다 (저절로 다시 돌리지 않습니다)' : ''}`),
    times);
}

// ---- 실행·진행 ----

const STEP_ICON = { waiting: '○', blocked: '○', running: '◐', done: '✓', error: '✕' };

function stepText(step) {
  if (step.state === 'waiting') return '대기';
  if (step.state === 'blocked') return '묶기 네 단계가 모두 끝나야 시작합니다';
  if (step.state === 'running') return step.chars ? `쓰는 중… ${step.chars.toLocaleString()}자` : '생각하는 중…';
  if (step.state === 'error') return step.error === 'cancelled' ? '중지했습니다' : ai.errorText(step.error);
  const d = step.dropped ?? {};
  const parts = [];
  if (d.quotes) parts.push(`내 답에 없는 인용 ${d.quotes}개를 버렸습니다`);
  if (d.clusters) parts.push(`경험이 하나만 남은 묶음 ${d.clusters}개를 풀었습니다`);
  if (d.links) parts.push(`없는 묶음을 가리킨 연결 ${d.links}개를 뺐습니다`);
  return parts.join(' · ') || '완료';
}

function runBlock(ctx) {
  const start = h('button', { type: 'button', class: 'btn primary', onclick: () => weave.startRun(ctx.data) });
  const stop = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => weave.stopRun() }, '중지');
  const reason = h('p', { class: 'small muted' });
  const stay = h('p', { class: 'stay-note', role: 'status' });
  const steps = h('ol', { class: 'steps', 'aria-label': '엮기 단계' });
  let tick = null;

  const stepRow = (step) => h('li', { class: `step st-${step.state}` },
    h('span', { class: 'step-icon', 'aria-hidden': 'true' }, STEP_ICON[step.state]),
    h('span', { class: 'step-label' }, step.label),
    h('span', { class: 'step-time' }, step.state === 'running' ? duration(Date.now() - step.startedAt) : step.ms !== null ? duration(step.ms) : ''),
    h('span', { class: 'step-text' }, stepText(step), step.cut ? ' · 긴 답 일부를 줄여 보냈습니다' : ''),
    step.state === 'error'
      ? h('button', { type: 'button', class: 'btn small', disabled: weave.busy(), onclick: () => weave.retryStep(ctx.data, step.key) }, '이 단계만 다시')
      : null);

  const paint = () => {
    const run = weave.runState();
    const st = weave.materialStatus(ctx.data);
    const ran = AXES.some((axis) => store.weaveDim(axis));
    start.textContent = ran ? '엮기 다시 실행' : '엮기 실행';
    start.disabled = weave.busy() || !st.ready;
    stop.hidden = !run?.active;
    reason.textContent = st.ready
      ? (ran ? '다시 실행해도 내가 고친 이름·의미·잠근 묶음·옮기거나 넣은 멤버·정의하기·내 포지셔닝은 그대로 남습니다. 잠그지 않은 Claude 묶음만 새 결과로 바뀝니다.' : '묶기 4번(왜 → 뭐 → 배움 → 입사 후)과 엮기 1번이 차례로 자동 진행됩니다. 끝난 뒤 결과를 고치면 됩니다.')
      : `${st.short.map((axis) => `${AXIS_INFO[axis].label} ${st.counts[axis]}개`).join(', ')} — 네 축 모두 답이 ${weave.MIN_ANSWERS}개 이상이어야 엮을 수 있습니다.`;
    stay.textContent = run?.active ? '이 화면을 떠나지 마세요 — 페이지를 닫거나 새로고침하면 진행 중인 단계가 멈춥니다.' : '';
    steps.hidden = !run;
    if (run) steps.replaceChildren(...run.steps.map(stepRow));
    if (run?.active && !tick) tick = setInterval(paint, 1000);
    if (!run?.active && tick) {
      clearInterval(tick);
      tick = null;
    }
  };
  onCleanup(() => clearInterval(tick));
  ctx.paintRun = paint;
  paint();
  return h('div', { class: 'run-block' }, h('div', { class: 'row' }, start, stop), reason, stay, steps);
}

// ---- 축별 묶음 ----

function excerpt(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  return Array.from(t).length > 60 ? `${Array.from(t).slice(0, 60).join('')}…` : t;
}

function moveSelect({ label, first, clusters, onPick }) {
  const select = h('select', { class: 'move-select', 'aria-label': label },
    h('option', { value: '' }, first),
    clusters.map((c) => h('option', { value: c.id }, clusterName(c))),
    h('option', { value: NEW }, '새 묶음으로'));
  select.addEventListener('change', () => {
    if (select.value) onPick(select.value === NEW ? null : select.value);
  });
  return select;
}

function memberRow(ctx, axis, cluster, m, others, editable) {
  const answer = store.answerText(m.cardId, axis);
  const shown = m.quote
    ? h('p', { class: m.source === 'ai' ? 'ai-quote' : 'my-quote' }, `“${m.quote}”`)
    : h('p', { class: 'small faint' }, answer.trim() ? `내 답: ${excerpt(answer)}` : '(지금은 이 문항 답이 비어 있습니다)');
  const refresh = () => ctx.refresh(`axis-${axis}`);
  return h('li', { class: 'member' },
    h('div', { class: 'member-head' }, itemLink(ctx, m.cardId, axis), m.source === 'me' ? [' ', badge('내가 넣음', 'me-badge')] : null),
    shown,
    editable ? h('div', { class: 'member-tools' },
      moveSelect({
        label: `${m.cardId}을 다른 묶음으로`,
        first: '다른 묶음으로…',
        clusters: others,
        onPick: (to) => {
          store.moveClusterMember(axis, cluster.id, m.cardId, to);
          refresh();
        },
      }),
      h('button', { type: 'button', class: 'btn small', onclick: () => { store.removeClusterMember(axis, cluster.id, m.cardId); refresh(); } }, '빼기'))
      : null);
}

function clusterCard(ctx, axis, c, clusters, editable) {
  const refresh = () => ctx.refresh(`axis-${axis}`);
  const name = h('input', {
    type: 'text', class: 'cluster-name', value: c.myName, maxlength: 40, disabled: !editable,
    placeholder: c.aiName || '묶음 이름을 쓰세요', 'aria-label': '묶음 이름',
  });
  name.addEventListener('input', () => store.renameCluster(axis, c.id, name.value));
  const others = clusters.filter((x) => x.id !== c.id);
  return h('article', { class: c.locked ? 'cluster locked' : 'cluster', id: `cluster-${c.id}` },
    h('div', { class: 'cluster-head' },
      name,
      editable
        ? h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(c.locked), onclick: () => { store.setClusterLocked(axis, c.id, !c.locked); refresh(); } }, c.locked ? '잠김 · 풀기' : '잠그기')
        : (c.locked ? badge('잠김') : null)),
    c.origin === 'ai'
      ? aiBox(null,
        h('p', { class: 'ai-name' }, badge(c.type, 'ai-type'), ' ', c.aiName ? ['Claude가 붙인 이름: ', h('strong', null, c.aiName)] : null),
        para(c.aiThread))
      : h('p', { class: 'small faint' }, '내가 만든 묶음'),
    h('p', { class: 'input-label' }, `경험 ${c.members.length}개`),
    c.members.length
      ? h('ul', { class: 'members' }, c.members.map((m) => memberRow(ctx, axis, c, m, others, editable)))
      : h('p', { class: 'small faint' }, '아직 경험이 없습니다. 아래 "묶이지 않은 경험"에서 넣을 수 있습니다.'),
    h('p', { class: 'input-label' }, '이 묶음이 나에게 의미하는 것'),
    editable
      ? answerBox({ value: c.myMeaning, onInput: (v) => store.setClusterMeaning(axis, c.id, v), rows: 2, maxlength: 3000, label: `${clusterName(c)} — 나에게 의미하는 것`, placeholder: '내 말로 씁니다' })
      : para(c.myMeaning, { class: 'pre' }) ?? h('p', { class: 'small faint' }, '(아직 안 씀)'),
    editable && !c.locked
      ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: () => { store.deleteCluster(axis, c.id); refresh(); } }, '묶음 지우기'))
      : null);
}

function looseBlock(ctx, axis, loose, clusters, editable) {
  if (!loose.length) return null;
  const refresh = () => ctx.refresh(`axis-${axis}`);
  return h('div', { class: 'loose' },
    h('h3', null, `묶이지 않은 경험 ${loose.length}개`),
    h('ul', { class: 'members' }, loose.map((l) => h('li', { class: 'member' },
      h('div', { class: 'member-head' }, itemLink(ctx, l.cardId, axis), l.fresh ? [' ', badge('엮은 뒤 새로 쓴 답')] : null),
      l.why ? aiBox(null, h('p', null, l.why)) : l.auto ? h('p', { class: 'small faint' }, '인용을 확인하고 나니 혼자 남은 경험') : null,
      editable ? h('div', { class: 'member-tools' }, moveSelect({
        label: `${l.cardId}을 묶음에 넣기`,
        first: '묶음에 넣기…',
        clusters,
        onPick: (to) => {
          const target = to ?? store.createCluster(axis, '');
          store.addClusterMember(axis, target, l.cardId, '');
          refresh();
        },
      })) : null))));
}

function tensionsBlock(ctx, dim) {
  if (!dim.tensions.length) return null;
  return h('div', { class: 'tensions' },
    h('h3', null, '서로 어긋나는 답'),
    aiBox(null, h('ul', null, dim.tensions.map((t) => h('li', null,
      quoteLine(ctx, t.a), quoteLine(ctx, t.b), nonEmpty(t.note) ? h('p', { class: 'small' }, t.note) : null)))));
}

function archivedBlock(ctx, dim) {
  if (!dim.archived.length) return null;
  return collapsible(`이전 묶음 ${dim.archived.length}개 — 다시 엮을 때 옮겨 붙일 곳이 없던 내 이름·의미`, h('ul', { class: 'archived' }, dim.archived.map((a) => h('li', null,
    h('p', null, h('strong', null, a.myName || a.aiName || '이름 없음'), ' ', h('span', { class: 'small faint' }, when(a.at))),
    para(a.myMeaning, { class: 'pre' }),
    a.members.length ? h('p', { class: 'small' }, '경험: ', idChips(ctx, a.members.map((m) => m.cardId))) : null))), { cls: 'archived-box' });
}

function axisBlock(ctx, axis) {
  const dim = store.weaveDim(axis);
  const info = AXIS_INFO[axis];
  const editable = !weave.runState()?.active;
  const clusters = liveClusters(dim);
  const loose = dim ? looseCards(dim, weave.axisEntries(ctx.data, axis).map(([id]) => id)) : [];
  const order = new Map((ctx.data.cards ?? []).map((c, i) => [c.id, i]));
  loose.sort((a, b) => (order.get(a.cardId) ?? 99) - (order.get(b.cardId) ?? 99));
  const summary = [h('strong', null, `${info.label} — ${info.meaning}`), h('span', { class: 'small faint' }, dim ? ` · 묶음 ${clusters.length} · 묶이지 않은 경험 ${loose.length}` : ' · 아직 엮기 전')];
  const body = dim
    ? [
      h('p', { class: 'small faint' }, `가로로 모으면 보이는 것: ${info.sees}${dim.at ? ` · ${when(dim.at)} 묶음` : ''}`),
      editable ? null : h('p', { class: 'small muted' }, '엮는 중에는 고칠 수 없습니다. 끝나면 고치세요.'),
      clusters.map((c) => clusterCard(ctx, axis, c, clusters, editable)),
      editable ? h('div', { class: 'row' }, h('button', {
        type: 'button', class: 'btn small',
        onclick: () => {
          const id = store.createCluster(axis, '');
          ctx.refresh(`axis-${axis}`);
          document.getElementById(`cluster-${id}`)?.querySelector('input')?.focus();
        },
      }, '새 묶음 만들기')) : null,
      looseBlock(ctx, axis, loose, clusters, editable),
      tensionsBlock(ctx, dim),
      archivedBlock(ctx, dim),
    ]
    : h('p', { class: 'small faint' }, '엮기를 실행하면 여기에 묶음이 생깁니다.');
  const details = collapsible(summary, body, { open: openAxes.has(axis), cls: 'axis', id: `weave-${axis}` });
  details.addEventListener('toggle', () => {
    if (details.open) openAxes.add(axis);
    else openAxes.delete(axis);
  });
  return details;
}

// ---- 실 ----

function threadBlock(ctx) {
  const thread = store.weaveThread();
  if (!thread) {
    return section({ title: '실 — 엮기 결과', id: 'weave-thread' }, h('p', { class: 'small faint' }, '엮기를 실행하면 반복되는 흐름, 시간순으로 바뀐 것과 그대로인 것, 근거가 비는 곳이 여기에 나옵니다.'));
  }
  const r = thread.result;
  const stale = AXES.some((axis) => (store.weaveDim(axis)?.at ?? null) !== (thread.dimsAt[axis] ?? null));
  const clusterOf = (axis, id) => liveClusters(store.weaveDim(axis)).find((c) => c.id === id);
  const chains = r.chains.map((c) => h('li', { class: 'chain' },
    h('p', null, h('strong', null, c.name)),
    para(c.pattern),
    c.links.length ? h('p', { class: 'small links' }, c.links.map((l) => {
      const found = clusterOf(l.axis, l.clusterId);
      return h('span', { class: 'link-chip' }, `${AXIS_INFO[l.axis].label}: ${found ? clusterName(found) : '(지금은 없는 묶음)'}`);
    })) : null,
    c.cards.length ? h('p', { class: 'small' }, '경험: ', idChips(ctx, c.cards)) : null,
    c.evidence.map((q) => quoteLine(ctx, q))));
  const timeline = r.timeline.map((t) => h('li', null,
    h('p', null, h('strong', null, t.stage), ' ', idChips(ctx, t.cards)),
    nonEmpty(t.shift) ? h('p', null, h('span', { class: 'label' }, '달라진 것'), ' ', t.shift) : null,
    nonEmpty(t.kept) ? h('p', null, h('span', { class: 'label' }, '그대로인 것'), ' ', t.kept) : null));
  const gaps = r.gaps.map((g) => h('li', null, badge(g.kind, 'ai-type'), ' ', g.note, ' ', idChips(ctx, g.cards)));
  return section({ title: '실 — 엮기 결과', id: 'weave-thread' },
    h('p', { class: 'small faint' }, `${when(thread.at)} 엮음`, stale ? ' · 그 뒤로 묶음이 다시 만들어졌습니다 (다시 엮으면 반영)' : ''),
    aiBox(null,
      h('h3', null, '반복되는 흐름'), chains.length ? h('ul', { class: 'chains' }, chains) : h('p', { class: 'small faint' }, '없음'),
      h('h3', null, '시간순 — 무엇이 바뀌고 무엇이 그대로였나'), timeline.length ? h('ol', { class: 'timeline' }, timeline) : h('p', { class: 'small faint' }, '없음'),
      h('h3', null, '빈 곳'), gaps.length ? h('ul', { class: 'gaps' }, gaps) : h('p', { class: 'small faint' }, '없음')));
}

// ---- 정의하기 ----

function materialBox(ctx, key) {
  const result = store.weaveThread()?.result;
  const im = result?.identity_material;
  const chainLine = (name) => {
    const c = result.chains.find((x) => x.name === name);
    return h('li', null, h('strong', null, name), c?.pattern ? ` — ${c.pattern}` : '');
  };
  const parts = [];
  if (im && (key === 'whoAmI' || key === 'whyMe') && im[key].chains.length) parts.push(h('ul', { class: 'mat-chains' }, im[key].chains.map(chainLine)));
  if (im && key === 'whoAmI') parts.push(...im.whoAmI.quotes.map((q) => quoteLine(ctx, q)));
  if (im && key === 'whyMe' && nonEmpty(im.whyMe.rare)) parts.push(h('p', null, h('span', { class: 'label' }, '드문 조합'), ' ', im.whyMe.rare));
  const pairs = im && (key === 'whyJob' || key === 'whyCompany') ? im[key].pairs : [];
  const side = key === 'whyJob' ? 'jd' : 'company';
  for (const p of pairs) {
    parts.push(h('div', { class: 'pair' },
      quoteLine(ctx, p.mine),
      h('p', { class: 'pair-other' }, h('span', { class: 'label' }, side === 'jd' ? 'JD' : '회사 자료'), ' ', `“${p[side]}”`)));
  }
  return h('div', { class: 'identity-material' }, parts.length
    ? aiBox('Claude 엮기 — 재료', ...parts)
    : h('p', { class: 'small faint' }, im ? '이 칸에 모인 재료가 없습니다.' : '엮기 결과가 나오면 재료(내 답 인용, JD·회사 자료와의 대응)가 여기에 모입니다.'));
}

function identityBlock(ctx) {
  return section({ title: '정의하기', id: 'weave-identity' },
    h('p', { class: 'muted' }, '네 칸은 내가 씁니다. 옆의 재료는 Claude가 내 답과 직무·회사 자료에서 그대로 모아 온 인용일 뿐, 완성 문장이 아닙니다.'),
    IDENTITY_KEYS.map((key) => h('div', { class: 'identity-row', id: `identity-${key}` },
      h('div', { class: 'identity-write' },
        h('h3', null, IDENTITY_LABEL[key]),
        answerBox({
          value: store.identityText(key),
          onInput: (v) => {
            store.setIdentity(key, v);
            ctx.paintCompare?.();
          },
          rows: 5,
          label: IDENTITY_LABEL[key],
          check: true,
        })),
      ctx.slot(`material-${key}`, () => materialBox(ctx, key)))));
}

// ---- 포지셔닝과 대조 ----

function pillarName(ctx, ref) {
  if (ref === 'thesis') return '한 줄 명제';
  const p = (ctx.data.positioning?.pillars ?? []).find((x) => x.n === ref);
  return p ? `기둥 ${store.circled(p.n)} ${p.title}` : `기둥 ${ref}`;
}

function proposalRow(ctx, p, i, decision, at) {
  const label = positioningTargets(ctx.data).find((t) => t.target === p.target)?.label ?? p.target;
  const refresh = () => ctx.refresh('compare');
  // 어느 대조의 몇 번째 제안에서 온 내 버전인지 (버리면 그 제안에서 온 것만 되돌린다)
  const from = `${at}#${i}`;
  const editor = h('div', { class: 'proposal-edit', hidden: true });
  const choose = (value) => h('button', {
    type: 'button', class: 'btn small', 'aria-pressed': String(decision?.value === value),
    onclick: () => {
      if (value === 'edited') {
        const area = answerBox({ value: store.myPositioning(p.target)?.text ?? p.suggested, onInput: () => {}, rows: 3, label: `${label} 내가 고친 문구`, check: true });
        editor.replaceChildren(area, h('div', { class: 'row' },
          h('button', {
            type: 'button', class: 'btn small primary',
            onclick: () => {
              const text = area.querySelector('textarea').value.trim();
              if (!text) return;
              store.setMyPositioning(p.target, text, from);
              store.setDecision(i, 'edited');
              refresh();
            },
          }, '이대로 받아들이기'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { editor.hidden = true; } }, '취소')));
        editor.hidden = false;
        autosizeIn(editor);
        editor.querySelector('textarea').focus();
        return;
      }
      if (value === 'accepted') store.setMyPositioning(p.target, p.suggested, from);
      if (value === 'rejected' && store.myPositioning(p.target)?.fromProposal === from) store.setMyPositioning(p.target, '');
      store.setDecision(i, value);
      refresh();
    },
  }, { accepted: '받아들이기', edited: '내가 고쳐서 받아들이기', rejected: '버리기' }[value]);
  const state = decision?.value
    ? h('p', { class: 'small decision' }, { accepted: '받아들였습니다', edited: '고쳐서 받아들였습니다', rejected: '버렸습니다' }[decision.value],
      decision.value !== 'rejected' && store.myPositioning(p.target)
        ? [' — ', focusLink('#/positioning', versionId(p.target), '포지셔닝 탭'), '에 내 버전으로 보입니다'] : '')
    : null;
  return h('li', { class: 'proposal' },
    h('p', null, h('strong', null, label)),
    h('p', { class: 'small' }, h('span', { class: 'label' }, '지금'), ' ', p.current),
    aiBox(null, h('p', null, h('span', { class: 'label' }, '제안'), ' ', p.suggested), nonEmpty(p.reason) ? h('p', { class: 'small' }, p.reason) : null),
    h('div', { class: 'row' }, choose('accepted'), choose('edited'), choose('rejected')),
    editor,
    state);
}

function compareResult(ctx, cmp) {
  const r = cmp.result;
  const notes = (list) => h('ul', null, list.map((x) => h('li', null, h('strong', null, pillarName(ctx, x.pillar)), ' — ', x.note)));
  return [
    h('p', { class: 'small faint' }, `${when(cmp.at)} 대조`),
    aiBox(null,
      h('h3', null, '맞아떨어지는 곳'), r.agree.length ? notes(r.agree) : h('p', { class: 'small faint' }, '없음'),
      h('h3', null, '포지셔닝에 없는 것'), r.missing_in_positioning.length
        ? h('ul', null, r.missing_in_positioning.map((m) => h('li', null, m.what, m.evidence.map((q) => quoteLine(ctx, q)))))
        : h('p', { class: 'small faint' }, '없음'),
      h('h3', null, '내 글에서 근거가 안 나오는 것'), r.not_grounded.length ? notes(r.not_grounded) : h('p', { class: 'small faint' }, '없음')),
    h('h3', null, `포지셔닝 문구 수정안 ${r.proposals.length}개`),
    r.proposals.length
      ? h('ol', { class: 'proposals' }, r.proposals.map((p, i) => proposalRow(ctx, p, i, cmp.decisions[i], cmp.at)))
      : h('p', { class: 'small faint' }, '제안이 없습니다.'),
  ];
}

function compareBlock(ctx) {
  const btn = h('button', { type: 'button', class: 'btn primary', onclick: () => weave.startCompare(ctx.data) }, '포지셔닝과 대조');
  const stop = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => weave.stopCompare() }, '중지');
  const status = h('p', { class: 'small muted', role: 'status' });
  let tick = null;
  const paint = () => {
    const job = weave.compareState();
    btn.disabled = weave.busy() || !weave.identityReady();
    stop.hidden = !job?.active;
    if (job?.active) status.textContent = `${job.chars ? `쓰는 중… ${job.chars.toLocaleString()}자` : '생각하는 중… (1~3분 걸릴 수 있습니다)'} · ${duration(Date.now() - job.startedAt)}`;
    else if (job?.error && job.error !== 'cancelled') status.textContent = ai.errorText(job.error);
    else if (!weave.identityReady()) status.textContent = '정의하기 네 칸을 모두 쓰면 대조할 수 있습니다.';
    else status.textContent = job?.dropped?.quotes || job?.dropped?.proposals
      ? `확인에서 내 답에 없는 인용 ${job.dropped.quotes}개, 원문과 맞지 않는 수정안 ${job.dropped.proposals}개를 버렸습니다.`
      : '';
    if (job?.active && !tick) tick = setInterval(paint, 1000);
    if (!job?.active && tick) {
      clearInterval(tick);
      tick = null;
    }
  };
  onCleanup(() => clearInterval(tick));
  ctx.paintCompare = paint;
  paint();
  const cmp = store.compare();
  return section({ title: '포지셔닝과 대조', id: 'weave-compare' },
    h('p', { class: 'muted' }, '내가 쓴 정의 네 문단을 포지셔닝 문구와 나란히 놓고, 맞는 곳·빠진 곳·근거가 안 나오는 곳을 짚습니다. Claude가 문장을 제안하는 곳은 여기뿐이고, 대상은 내 경험이 아니라 포지셔닝 문구입니다. 받아들인 문구는 포지셔닝 탭에 "내 버전"으로 보이고 원문은 그대로 남습니다.'),
    h('div', { class: 'row' }, btn, stop),
    status,
    cmp ? compareResult(ctx, cmp) : null);
}

// ---- 화면 ----

export function render({ data }) {
  if (!ai.available()) {
    return h('div', { class: 'weave' },
      h('h1', null, tabLabel('weave')),
      h('p', { class: 'muted' }, '엮기는 claude.ai에서 이 사이트를 열었을 때만 쓸 수 있습니다.'));
  }
  const slots = new Map();
  const waiting = new Set();
  const typingIn = (node) => {
    const el = document.activeElement;
    return Boolean(el && node.contains(el) && el.matches('textarea, input, select'));
  };
  const ctx = {
    data,
    cards: new Map((data.cards ?? []).map((c) => [c.id, c])),
    pressure: new Map((data.pressure ?? []).map((p) => [p.id, p])),
    slot(key, build) {
      const node = build();
      slots.set(key, { node, build });
      return node;
    },
    // 한 부분만 다시 그린다 (입력 중인 다른 칸은 그대로). 내가 누른 단추로 고칠 때 쓴다.
    refresh(...keys) {
      for (const key of keys) {
        const s = slots.get(key);
        if (!s?.node?.isConnected) continue;
        waiting.delete(key);
        const next = s.build();
        s.node.replaceWith(next);
        s.node = next;
        autosizeIn(next);
      }
    },
    // 엮기 진행처럼 저절로 다시 그릴 때: 그 부분에서 글을 쓰는 중이면 미루고 "새로 보기"를 띄운다.
    // 미룬 칸에 이어 쓴 글은 그 묶음을 이어받은 새 묶음(또는 이전 묶음)에 저장된다 (weave-model.js의 findLive).
    refreshAuto(...keys) {
      const now = keys.filter((key) => {
        const s = slots.get(key);
        if (!s?.node?.isConnected || !typingIn(s.node)) return true;
        waiting.add(key);
        return false;
      });
      ctx.refresh(...now);
      if (waiting.size) showToast('새 결과가 있습니다. 쓰던 칸은 그대로 두었습니다.', { label: '새로 보기', run: () => ctx.refresh(...waiting) });
    },
  };

  // 단계가 끝날 때마다 그 축(또는 실·재료)만 새로 그린다.
  const snapshot = () => {
    const run = weave.runState();
    return { active: Boolean(run?.active), steps: Object.fromEntries((run?.steps ?? []).map((s) => [s.key, s.state])), compare: Boolean(weave.compareState()?.active) };
  };
  let prev = snapshot();
  const off = weave.onChange(() => {
    const next = snapshot();
    const keys = new Set();
    if (next.active !== prev.active) {
      for (const axis of AXES) keys.add(`axis-${axis}`);
      keys.add('status');
    }
    for (const [key, state] of Object.entries(next.steps)) {
      if (state !== 'done' || prev.steps[key] === 'done') continue;
      keys.add('status');
      if (key === 'thread') {
        keys.add('thread');
        for (const k of IDENTITY_KEYS) keys.add(`material-${k}`);
      } else keys.add(`axis-${key}`);
    }
    if (prev.compare && !next.compare) keys.add('compare');
    prev = next;
    if (keys.size) ctx.refreshAuto(...keys);
    ctx.paintRun?.();
    ctx.paintCompare?.();
  });
  onCleanup(off);

  return h('div', { class: 'weave' },
    h('h1', null, tabLabel('weave')),
    h('p', { class: 'muted' }, '내가 쓴 답 전체를 가로로 다시 읽어, 같은 질문에 비슷한 답이 나온 경험끼리 묶고 묶음을 실로 꿰어 봅니다. Claude는 묶고 내 말을 인용하고 공통점을 한 줄로 짚는 데서 멈춥니다. 묶음이 나에게 의미하는 것과 정의 네 문단은 내가 씁니다.'),
    ctx.slot('status', () => statusBlock(ctx)),
    runBlock(ctx),
    section({ title: '축별 묶음', id: 'weave-axes' },
      h('p', { class: 'small muted' }, '이름 바꾸기·의미 쓰기·멤버 빼기와 옮기기·잠그기는 다시 엮어도 남습니다. 멤버를 누르면 그 카드의 그 문항으로 갑니다.'),
      AXES.map((axis) => ctx.slot(`axis-${axis}`, () => axisBlock(ctx, axis)))),
    ctx.slot('thread', () => threadBlock(ctx)),
    identityBlock(ctx),
    ctx.slot('compare', () => compareBlock(ctx)));
}
