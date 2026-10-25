import { h, nonEmpty, para, chipRow, tabLabel } from '../app.js';
import * as store from '../store.js';

// 검색어·분류 필터와 퀴즈 진행 상태는 탭을 오가도 유지한다.
const filter = { q: '', cats: new Set() };
const quiz = { on: false, mode: 'term', unknownFirst: false, current: null, revealed: false, asked: 0, knew: 0, missed: 0 };

const FIELDS = ['term', 'en', 'short', 'why', 'mine'];

function matches(g) {
  if (filter.cats.size && !filter.cats.has(g.category)) return false;
  const q = filter.q.trim().toLowerCase();
  return !q || FIELDS.some((f) => (g[f] ?? '').toLowerCase().includes(q));
}

function knownToggle(term) {
  const yes = h('button', { type: 'button', class: 'chip' }, '앎');
  const no = h('button', { type: 'button', class: 'chip' }, '모름');
  const sync = () => {
    const k = store.known(term);
    yes.setAttribute('aria-pressed', String(k === true));
    no.setAttribute('aria-pressed', String(k === false));
  };
  // 이미 눌린 쪽을 다시 누르면 표시를 지운다.
  const set = (value) => {
    store.setKnown(term, store.known(term) === value ? null : value);
    sync();
  };
  yes.addEventListener('click', () => set(true));
  no.addEventListener('click', () => set(false));
  sync();
  return h('div', { class: 'known-toggle', role: 'group', 'aria-label': `${term} 앎/모름` }, yes, no);
}

function termCard(g, i) {
  return h('article', { class: 'term', id: `glossary-${i}` },
    h('div', { class: 'term-head' },
      h('h2', { class: 'term-name' }, g.term, nonEmpty(g.en) ? h('span', { class: 'term-en' }, g.en) : null),
      knownToggle(g.term)),
    nonEmpty(g.category) ? h('p', { class: 'term-cat' }, g.category) : null,
    para(g.short, { class: 'term-short' }),
    nonEmpty(g.why) ? h('p', { class: 'term-why' }, h('span', { class: 'label' }, '왜 나오나'), ' ', g.why) : null,
    nonEmpty(g.mine) ? h('div', { class: 'mine' }, h('p', { class: 'mine-label' }, '내 경험 연결'), h('p', null, g.mine)) : null);
}

function pick(pool) {
  let candidates = pool;
  if (quiz.unknownFirst) {
    const missed = pool.filter((g) => store.known(g.term) === false);
    const unrated = pool.filter((g) => store.known(g.term) === null);
    candidates = missed.length ? missed : unrated.length ? unrated : pool;
  }
  if (candidates.length > 1 && quiz.current) candidates = candidates.filter((g) => g.term !== quiz.current.term);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

function quizPanel(pool, rerender) {
  const next = () => {
    quiz.current = pick(pool);
    quiz.revealed = false;
    rerender();
  };
  if (!quiz.current || !pool.some((g) => g.term === quiz.current.term)) quiz.current = pick(pool);
  const g = quiz.current;

  const modeRadio = (value, text) => h('label', { class: 'check inline' },
    h('input', {
      type: 'radio', name: 'quiz-mode', value, checked: quiz.mode === value,
      onchange: () => {
        quiz.mode = value;
        quiz.revealed = false;
        rerender();
      },
    }),
    h('span', null, text));

  const settings = h('div', { class: 'quiz-settings' },
    h('div', { class: 'row', role: 'radiogroup', 'aria-label': '출제 방식' },
      modeRadio('term', '① 용어 보고 정의 떠올리기'),
      modeRadio('short', '② 정의 보고 용어 떠올리기')),
    h('label', { class: 'check inline' },
      h('input', {
        type: 'checkbox', checked: quiz.unknownFirst,
        onchange: (e) => {
          quiz.unknownFirst = e.target.checked;
        },
      }),
      h('span', null, '몰랐던 용어 먼저 출제')),
    h('p', { class: 'small faint' }, `출제 범위: 현재 필터의 용어 ${pool.length}개`));

  if (!g) {
    return h('div', { class: 'quiz' }, settings, h('p', { class: 'empty' }, '출제할 용어가 없습니다. 필터를 바꿔 보세요.'));
  }

  const grade = (knew) => {
    store.setKnown(g.term, knew);
    quiz.asked += 1;
    if (knew) quiz.knew += 1;
    else quiz.missed += 1;
    next();
  };

  const question = quiz.mode === 'term'
    ? [h('p', { class: 'quiz-q' }, g.term), nonEmpty(g.en) ? h('p', { class: 'term-en' }, g.en) : null, h('p', { class: 'small faint' }, '정의를 떠올려 보세요.')]
    : [h('p', { class: 'quiz-q quiz-q-long' }, g.short), h('p', { class: 'small faint' }, '어떤 용어인지 떠올려 보세요.')];
  const answer = quiz.mode === 'term'
    ? [para(g.short)]
    : [h('p', { class: 'quiz-q' }, g.term), nonEmpty(g.en) ? h('p', { class: 'term-en' }, g.en) : null];

  return h('div', { class: 'quiz' },
    settings,
    h('div', { class: 'quiz-card', 'aria-live': 'polite' },
      question,
      quiz.revealed
        ? [h('div', { class: 'quiz-answer' }, h('p', { class: 'mine-label' }, '정답'), answer),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn primary', onclick: () => grade(true) }, '알았다'),
            h('button', { type: 'button', class: 'btn', onclick: () => grade(false) }, '몰랐다'))]
        : h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary', onclick: () => { quiz.revealed = true; rerender(); } }, '정답 보기'),
          h('button', { type: 'button', class: 'btn', onclick: next }, '건너뛰기'))),
    h('p', { class: 'small muted' }, `이번 퀴즈: ${quiz.asked}문제 · 알았다 ${quiz.knew} · 몰랐다 ${quiz.missed}`));
}

export function render({ data, focus }) {
  const items = data.glossary ?? [];
  if (focus) {
    filter.q = '';
    filter.cats.clear();
    quiz.on = false;
  }
  const categories = [...new Set(items.map((g) => g.category).filter(nonEmpty))];
  const countLine = h('p', { class: 'count-line' });
  const body = h('div', { class: 'glossary-body' });
  const search = h('input', { type: 'search', class: 'filter-input', value: filter.q, placeholder: '용어·영문·설명·내 경험 검색', 'aria-label': '용어 검색' });
  const quizBtn = h('button', { type: 'button', class: 'btn' });

  const refresh = () => {
    const shown = items.map((g, i) => [g, i]).filter(([g]) => matches(g));
    countLine.textContent = `${items.length}개 중 ${shown.length}개`;
    quizBtn.textContent = quiz.on ? '퀴즈 끝내기' : '퀴즈 모드';
    quizBtn.setAttribute('aria-pressed', String(quiz.on));
    if (quiz.on) {
      body.replaceChildren(quizPanel(shown.map(([g]) => g), refresh));
      return;
    }
    body.replaceChildren(...shown.map(([g, i]) => termCard(g, i)));
    if (!shown.length) body.append(h('p', { class: 'empty' }, '조건에 맞는 용어가 없습니다.'));
  };

  search.addEventListener('input', () => {
    filter.q = search.value;
    refresh();
  });
  quizBtn.addEventListener('click', () => {
    quiz.on = !quiz.on;
    if (quiz.on) Object.assign(quiz, { current: null, revealed: false, asked: 0, knew: 0, missed: 0 });
    refresh();
  });
  refresh();

  return h('div', { class: 'glossary' },
    h('h1', null, tabLabel('glossary')),
    h('div', { class: 'filters' },
      h('div', { class: 'row' }, search, quizBtn),
      chipRow({
        label: '분류',
        options: categories.map((c) => ({ value: c, text: c, count: items.filter((g) => g.category === c).length })),
        selected: filter.cats,
        onChange: refresh,
      })),
    countLine,
    body);
}
