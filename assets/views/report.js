// 자료 모음 — 내가 쓴 글과 이미 받아 둔 결과(엮기·렌즈 메모·카드 코멘트)를 한곳에 모은다. 여기서 Claude를 부르지 않는다.
// 인쇄(PDF)하거나, 스타일을 담은 HTML 파일 하나로 저장할 수 있다. GitHub Pages판과 claude.ai판 모두 같다.
// (Claude가 8섹션으로 정리하는 최종 보고서는 따로 #/final — views/final.js)

import { h, nonEmpty, section, table, badge, focusLink, aiBox, saveFile, tabLabel } from '../app.js';
import * as ai from '../ai.js';
import * as store from '../store.js';
import * as lint from '../lint.js';
import { commentView } from './cards.js';
import { isStale } from '../comment.js';
import { AXES, AXIS_INFO, IDENTITY_KEYS, IDENTITY_LABEL, liveClusters, clusterName, positioningTargets } from '../weave-model.js';

const SCRIPTS = [['intro60', '자기소개 60초', 60], ['whyme90', 'Why Me 90초', 90]];
const when = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? store.formatStamp(new Date(iso)) : '');
const pad = (n) => String(n).padStart(2, '0');

const textBlock = (text, empty = '(아직 안 씀)') => (text.trim() ? h('p', { class: 'pre' }, text) : h('p', { class: 'small faint' }, empty));
const lengthMeta = (text, seconds) => (text.trim() ? h('p', { class: 'report-meta' }, lint.lengthLine(text), seconds ? ` · 목표 ${seconds}초` : '') : null);

function describe(f) {
  if (f.kind === 'defense') return [h('strong', null, '⚠ 방어선: '), `"${f.term}"`, f.yes ? [' → 이렇게 말한다: ', f.yes] : ''];
  return [h('strong', null, '⚠ 확정 자료에 없는 숫자: '), f.values.join(', '), f.more ? ` 외 ${f.more}개` : ''];
}

export function render({ data }) {
  const warnings = [];
  // 경고를 그 자리에 보이고, 맨 아래 목록에도 모은다.
  const checked = (text, scope, where) => {
    const found = lint.check(text, scope);
    for (const f of found) warnings.push({ where, f });
    return found.length ? h('ul', { class: 'lint' }, found.map((f) => h('li', null, describe(f)))) : null;
  };
  const cardLink = (c, key, label) => focusLink(`#/cards/${encodeURIComponent(c.id)}`, key ? `card-${c.id}-q-${key}` : `card-${c.id}-title`, label);

  // ---- 정의하기 (claude.ai판에서 쓴다. GitHub판에는 백업으로 가져온 경우에만 보인다) ----
  const identityShown = ai.available() || IDENTITY_KEYS.some((k) => store.identityText(k).trim());
  const identity = identityShown ? section({ title: '정의하기 — 내가 쓴 네 문단', id: 'report-identity' },
    IDENTITY_KEYS.map((k) => {
      const text = store.identityText(k);
      return h('div', { class: 'report-item' }, h('h3', null, IDENTITY_LABEL[k]), textBlock(text), lengthMeta(text),
        checked(text, null, focusLink('#/weave', `identity-${k}`, `정의하기 · ${IDENTITY_LABEL[k]}`)));
    })) : null;

  // ---- 말하기·포지셔닝: 내 버전과 내 문장 ----
  const pos = data.positioning ?? {};
  const scripts = section({ title: '말하기 — 내 버전', id: 'report-scripts' },
    SCRIPTS.filter(([key]) => nonEmpty(pos.scripts?.[key])).map(([key, label, seconds]) => {
      const text = store.scriptText(key);
      return h('div', { class: 'report-item' }, h('h3', null, label), textBlock(text), lengthMeta(text, seconds),
        checked(text, null, focusLink('#/positioning', `script-${key}`, `말하기 · ${label}`)));
    }));
  const mine = positioningTargets(data).filter((t) => store.myPositioning(t.target)).map((t) => h('div', { class: 'report-item' },
    h('h3', null, `${t.label} `, badge('내 버전', 'mine-badge')), h('p', { class: 'pre' }, store.myPositioning(t.target).text)));
  const pillarLines = (pos.pillars ?? []).filter((p) => store.pillarText(p.n).trim()).map((p) => {
    const text = store.pillarText(p.n);
    return h('div', { class: 'report-item' }, h('h3', null, `기둥 ${store.circled(p.n)} ${store.myPositioning(`pillars[${p.n}].title`)?.text ?? p.title} — 내 문장`), h('p', { class: 'pre' }, text),
      checked(text, null, focusLink('#/positioning', `pillar-${p.n}`, `기둥 ${store.circled(p.n)} 내 문장`)));
  });
  const positioning = section({ title: '포지셔닝 — 내 문장', id: 'report-positioning' }, mine, pillarLines);

  // ---- 엮기 결과 (이미 받아 둔 것) ----
  const thread = store.weaveThread()?.result;
  const threadSection = thread && (thread.chains.length || thread.timeline.length) ? section({ title: '실 — 엮기 결과', id: 'report-thread' },
    aiBox('Claude 엮기',
      thread.chains.length ? [h('h3', null, '반복되는 흐름'), h('ul', null, thread.chains.map((c) => h('li', null,
        h('strong', null, c.name), nonEmpty(c.pattern) ? ` — ${c.pattern}` : '', c.cards.length ? h('span', { class: 'small faint' }, ` (${c.cards.join(', ')})`) : null)))] : null,
      thread.timeline.length ? [h('h3', null, '시간순'), h('ul', null, thread.timeline.map((t) => h('li', null,
        h('strong', null, t.stage), t.cards.length ? h('span', { class: 'small faint' }, ` (${t.cards.join(', ')})`) : null,
        nonEmpty(t.shift) ? h('p', { class: 'small' }, '달라진 것: ', t.shift) : null,
        nonEmpty(t.kept) ? h('p', { class: 'small' }, '그대로인 것: ', t.kept) : null)))] : null)) : null;
  // 직무 렌즈 — JD 업무마다 내가 쓴 메모
  const lensRows = (store.lens()?.result?.coverage ?? []).filter((r) => store.lensNote(r.jd).trim());
  const lensNotes = lensRows.length ? section({ title: '직무 렌즈 — 내 메모', id: 'report-lens' },
    lensRows.map((r) => h('div', { class: 'report-item' },
      h('h3', null, r.jd, ' ', h('span', { class: 'report-tag' }, r.strength)),
      h('p', { class: 'pre' }, store.lensNote(r.jd)),
      checked(store.lensNote(r.jd), null, focusLink('#/weave', 'weave-lens', `직무 렌즈 · ${r.jd}`))))) : null;
  const clusters = section({ title: '축별 묶음 — 내 의미', id: 'report-clusters' }, AXES.map((axis) => {
    const list = liveClusters(store.weaveDim(axis));
    if (!list.length) return null;
    return h('div', { class: 'report-item' },
      h('h3', null, `${AXIS_INFO[axis].label} — ${AXIS_INFO[axis].meaning}`),
      h('ul', { class: 'report-clusters' }, list.map((c) => h('li', null,
        h('strong', null, clusterName(c)), c.myName.trim() ? null : h('span', { class: 'small faint' }, ' (Claude가 붙인 이름)'),
        c.myMeaning.trim() ? h('p', { class: 'pre' }, c.myMeaning.trim()) : h('p', { class: 'small faint' }, '내 의미는 아직 안 씀'),
        c.members.length ? h('p', { class: 'small faint' }, `경험: ${c.members.map((m) => m.cardId).join(', ')}`) : null))));
  }));

  // ---- 서류 해부: 제출본(없으면 지금 답), 꼬리질문 답, 카드 코멘트 ----
  const cards = data.cards ?? [];
  const hasAny = (c) => (c.questions ?? []).some((q) => store.answerText(c.id, q.key).trim() || store.submitted(c.id, q.key))
    || (c.followups ?? []).some((_, i) => store.followupText(c.id, i).trim());
  const cardBlocks = cards.filter(hasAny).map((c) => {
    const questions = (c.questions ?? []).map((q) => {
      const sent = store.submitted(c.id, q.key);
      const current = store.answerText(c.id, q.key);
      const text = sent?.text ?? current;
      const tag = sent ? `제출 ${when(sent.updatedAt)}${sent.text === current ? '' : ' · 그 뒤로 고침'}` : (current.trim() ? '제출 안 함' : '');
      return h('div', { class: 'report-q' },
        h('h4', null, q.label, tag ? h('span', { class: sent ? 'report-tag' : 'report-tag unsent' }, tag) : null),
        textBlock(text, '(답 없음)'),
        lengthMeta(text),
        checked(text, c.id, cardLink(c, q.key, `[${c.id}] ${q.label}`)));
    });
    const followups = (c.followups ?? []).map((q, i) => [q, store.followupText(c.id, i), i]).filter(([, a]) => a.trim());
    const saved = store.cardComment(c.id);
    return h('article', { class: 'report-card', id: `report-card-${c.id}` },
      h('h3', null, cardLink(c, null, `[${c.id}] ${c.title}`)),
      h('p', { class: 'small faint' }, [c.period, `상태: ${store.STATUS_LABEL[store.cardStatus(c.id)]}`, `제출 ${store.submittedCount(c.id)}/4`].filter(nonEmpty).join(' · ')),
      questions,
      followups.length ? h('div', { class: 'report-q' }, h('h4', null, '꼬리질문'), h('ul', { class: 'report-followups' }, followups.map(([q, a, i]) => h('li', null,
        h('p', { class: 'small muted' }, q), h('p', { class: 'pre' }, a),
        checked(a, c.id, focusLink(`#/cards/${encodeURIComponent(c.id)}`, `card-${c.id}-fu-${i}`, `[${c.id}] 꼬리질문`)))))) : null,
      saved ? commentView(data, c, saved, { stale: isStale(c) }) : null);
  });
  const emptyCards = cards.filter((c) => !hasAny(c)).map((c) => c.id);
  const cardsSection = section({ title: '서류 해부 — 카드별', id: 'report-cards' },
    h('p', { class: 'small faint' }, '제출한 문항은 제출본을, 제출하지 않은 문항은 지금 답을 보여 줍니다.'),
    cardBlocks,
    emptyCards.length ? h('p', { class: 'small faint' }, `아직 답이 없는 카드: ${emptyCards.join(', ')}`) : null);

  // ---- 압박 문항 ----
  const pressure = section({ title: '압박 문항', id: 'report-pressure' }, (data.pressure ?? []).map((p) => {
    const text = store.pressure(p.id)?.text ?? '';
    const link = focusLink(`#/pressure/${encodeURIComponent(p.id)}`, `pressure-${p.id}-answer`, `[${p.id}] ${p.title}`);
    return h('article', { class: 'report-card', id: `report-pressure-${p.id}` },
      h('h3', null, link),
      nonEmpty(p.prompt) ? h('blockquote', { class: 'prompt-small' }, p.prompt) : null,
      textBlock(text, '(답 없음)'),
      lengthMeta(text),
      checked(text, p.id, focusLink(`#/pressure/${encodeURIComponent(p.id)}`, `pressure-${p.id}-answer`, `[${p.id}] 답`)));
  }));

  // ---- 방어선 ----
  const defense = section({ title: '방어선', id: 'report-defense' }, table({
    head: ['주제', '❌ 하지 않을 말', '✅ 이렇게 말한다'],
    wide: true,
    cls: 'defense-table',
    rows: (data.defense ?? []).map((d) => [nonEmpty(d.topic) ? h('strong', null, d.topic) : '', d.no, d.yes]),
  }));

  // ---- 남은 점검 경고: 위에서 모은 것 ----
  const warningSection = section({ title: `남은 점검 경고 ${warnings.length}건`, id: 'report-lint' },
    warnings.length
      ? h('ul', { class: 'report-warnings' }, warnings.map((w) => h('li', null, h('span', { class: 'report-where' }, w.where), ' ', describe(w.f))))
      : h('p', { class: 'small faint' }, '로컬 점검에 걸린 곳이 없습니다.'));

  // ---- 위: 요약과 저장 ----
  const total = cards.reduce((n, c) => n + (c.questions ?? []).length, 0);
  const submittedTotal = cards.reduce((n, c) => n + store.submittedCount(c.id), 0);
  const comments = cards.filter((c) => store.cardComment(c.id)).length;
  const pressureDone = (data.pressure ?? []).filter((p) => (store.pressure(p.id)?.text ?? '').trim()).length;
  const status = h('p', { class: 'small muted', role: 'status' });
  const root = h('div', { class: 'report' });
  const tools = h('div', { class: 'row report-tools' },
    h('button', { type: 'button', class: 'btn primary', onclick: () => window.print() }, '인쇄 / PDF로 저장'),
    h('button', { type: 'button', class: 'btn', onclick: async () => { status.textContent = await saveReport(root, data); } }, 'HTML 파일로 저장'));
  // 비어 있는 섹션은 null이다 — append는 null을 글자로 넣으므로 걸러 낸다.
  root.append(...[
    h('h1', null, tabLabel('report')),
    h('p', { class: 'muted' }, '내가 쓴 글과 이미 받아 둔 결과를 한곳에 모았습니다. 이 화면은 Claude를 부르지 않습니다 — 보라색 칸은 엮기 탭과 카드에서 받아 둔 Claude 결과입니다.'),
    h('p', { class: 'report-summary' },
      `${store.formatStamp(new Date())} 기준 · 제출한 문항 ${submittedTotal}/${total} · 카드 코멘트 ${comments}/${cards.length} · 압박 문항 답 ${pressureDone}/${(data.pressure ?? []).length}`,
      identityShown ? ` · 정의하기 ${IDENTITY_KEYS.filter((k) => store.identityText(k).trim()).length}/4` : '',
      ' · ', focusLink('#/report', 'report-lint', `점검 경고 ${warnings.length}건`)),
    tools,
    h('p', { class: 'small faint report-tools' }, 'claude.ai 안에서 인쇄가 안 되면 HTML 파일로 저장해 브라우저에서 열고 인쇄하세요. 저장한 파일은 평문이니 공개된 곳에 올리지 마세요.'),
    status,
    identity, scripts, positioning, threadSection, lensNotes, clusters, cardsSection, pressure, defense, warningSection,
  ].filter(Boolean));
  return root;
}

// 화면에 보이는 자료 모음을 스타일까지 담은 HTML 파일 하나로 (앱 안 링크는 글자로 바꾼다)
async function saveReport(root, data) {
  const css = await fetch('assets/styles.css', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const d = new Date();
  const doc = document.implementation.createHTMLDocument(`${tabLabel('report')} — ${data.meta?.title ?? ''}`);
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
  const copy = root.cloneNode(true);
  for (const el of copy.querySelectorAll('.report-tools, [role="status"]')) el.remove();
  for (const a of copy.querySelectorAll('a')) a.replaceWith(...a.childNodes);
  const main = doc.createElement('main');
  main.className = 'view';
  main.append(doc.importNode(copy, true));
  doc.body.append(main);
  const name = `prep-materials-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`;
  return saveFile({ name, body: `<!doctype html>\n${doc.documentElement.outerHTML}\n`, type: 'text/html' });
}
