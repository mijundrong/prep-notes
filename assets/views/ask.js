import { h, tabLabel } from '../app.js';
import * as ai from '../ai.js';
import * as coach from '../coach.js';

export function render({ data }) {
  if (!ai.available()) {
    return h('div', { class: 'ask-view' },
      h('h1', null, tabLabel('ask')),
      h('p', { class: 'muted' }, '물어보기는 claude.ai에서 이 화면을 열었을 때만 쓸 수 있습니다.'));
  }
  return h('div', { class: 'ask-view' },
    h('h1', null, tabLabel('ask')),
    h('p', { class: 'muted' }, '내가 쓴 답 전체와 준비 자료, 엮기 결과를 아는 Claude에게 물어보세요. 답을 대신 써 주지는 않습니다. 대화는 이 화면을 연 동안만 남고, Ctrl+Enter로 보낼 수 있습니다.'),
    h('p', { class: 'small faint' }, `지금 쓴 답: ${coach.statsLine(coach.answerStats(data))}`),
    coach.chatPanel(data));
}
