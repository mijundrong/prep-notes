// Claude가 인용한 구간이 원문(내 답·자료)에 그대로 있는지 확인한다. 엮기와 카드 코멘트가 함께 쓴다.

const EDGE = /^[\s"'“”‘’「」『』«»<>…·]+|[\s"'“”‘’「」『』«»<>….,·]+$/g;

// 앞뒤 따옴표·말줄임표·마침표를 뗀 모양
export const trimQuote = (text) => text.replace(EDGE, '');

// quote가 source 안에 그대로 있으면 source에서 그 구간을 돌려준다. 띄어쓰기·줄바꿈 차이만 너그럽게 본다.
export function locate(source, quote) {
  if (typeof source !== 'string' || typeof quote !== 'string') return null;
  const q = trimQuote(quote);
  if (Array.from(q).length < 2) return null;
  if (source.includes(q)) return q;
  const map = [];
  let flat = '';
  for (let i = 0; i < source.length; i++) {
    if (/\s/.test(source[i])) {
      if (!flat || flat.endsWith(' ')) continue;
      flat += ' ';
    } else flat += source[i];
    map.push(i);
  }
  const nq = q.replace(/\s+/g, ' ');
  const at = flat.indexOf(nq);
  return at < 0 ? null : source.slice(map[at], map[at + nq.length - 1] + 1);
}

export function locateIn(texts, quote) {
  for (const t of texts) {
    const hit = locate(t, quote);
    if (hit) return hit;
  }
  return null;
}
