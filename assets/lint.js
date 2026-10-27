// 로컬 점검 — Claude 없이 코드로만 한다. GitHub Pages판과 claude.ai판 모두 같다.
// 1) 방어선 어구: 손으로 정리한 사전(assets/lint-terms.js, 암호문)과 문자열로 맞춘다
// 2) 확정 숫자 대조: 답의 숫자 중 데이터 어디에도 없는 것 (방어선 ❌ 문장에만 있는 숫자는 확정으로 치지 않는다)
// 3) 분량: 글자 수 → 말하기 시간 (분당 300~350자)

// scripts/lint-terms.mjs와 같은 값이어야 한다. 사전을 여는 키 = SHA-256(SEAL_INFO + 방어선 원문 JSON)
export const SEAL_INFO = 'prep-lint-terms:v1\n';
const PER_MINUTE = 325;
const MAX_NUMBERS = 6;

let rules = [];
let known = new Set();

const charCount = (text) => Array.from(text ?? '').length;

export function speakLabel(chars) {
  const sec = (chars * 60) / PER_MINUTE;
  if (sec < 55) return `${Math.max(5, Math.round(sec / 5) * 5)}초`;
  const rounded = Math.round(sec / 10) * 10;
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

// "312자 · 말하기 약 1분"
export function lengthLine(text) {
  const n = charCount(text);
  return n ? `${n}자 · 말하기 약 ${speakLabel(n)}` : '0자';
}

// 대소문자·띄어쓰기를 무시하고 맞춘다. 가운뎃점 모양도 하나로.
const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[・‧∙]/g, '·').replace(/\s+/g, '');

// ---- 숫자 ----

const NUM = /[A-Za-z]?\d[\d,]*(?:\.\d+)*/g;

// 숫자 토큰: ROS2·PX4·E1처럼 영문에 붙은 숫자는 이름으로 보고 뺀다. 1,000 → 1000
function numberTokens(text) {
  const out = [];
  for (const m of text.matchAll(NUM)) {
    if (/^[A-Za-z]/.test(m[0])) continue;
    const t = m[0].replace(/,(?=\d{3}(?!\d))/g, '');
    for (const part of t.split(',')) if (part) out.push(part);
  }
  return out;
}

const stripLead = (s) => s.replace(/^0+(?=\d)/, '');

// 같은 숫자로 볼 모양들: 4.20 = 4.2, 2026.07 = 2026.7, 07 = 7
function shapes(token) {
  const parts = token.split('.');
  if (parts.length === 1) return [stripLead(token)];
  const date = parts.map(stripLead).join('.');
  if (parts.length > 2) return [date];
  const frac = parts[1].replace(/0+$/, '');
  return [...new Set([frac ? `${stripLead(parts[0])}.${frac}` : stripLead(parts[0]), date])];
}

function collectKnown(data) {
  const out = new Set();
  const addToken = (token) => {
    const parts = token.split('.');
    for (const s of shapes(token)) out.add(s);
    if (parts.length < 2) return;
    for (const p of parts) for (const s of shapes(p)) out.add(s);
    for (let i = 0; i < parts.length - 1; i++) for (const s of shapes(`${parts[i]}.${parts[i + 1]}`)) out.add(s);
  };
  const skip = new Set((data.defense ?? []).map((d) => d?.no).filter((v) => typeof v === 'string'));
  // 주소의 숫자(게시물 번호, 한글을 바꾼 %ED%85%9C 같은 바이트)는 사실이 아니라 확정으로 치지 않는다
  const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!skip.has(v) && !isUrl(v)) for (const t of numberTokens(v)) addToken(t);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(data);
  return out;
}

// ---- 방어선 사전 ----

const fromB64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function openSealed(data, sealed) {
  if (!sealed || sealed.v !== 1 || typeof sealed.iv !== 'string' || typeof sealed.ct !== 'string') return null;
  const material = new TextEncoder().encode(SEAL_INFO + JSON.stringify(data.defense ?? []));
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', material), { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function compile(dict, data) {
  const yes = new Map((data.defense ?? []).map((d) => [d.topic, d.yes]));
  const list = Array.isArray(dict?.rules) ? dict.rules : [];
  return list.filter((r) => r && typeof r.topic === 'string' && Array.isArray(r.terms)).map((r) => ({
    topic: r.topic,
    yes: typeof yes.get(r.topic) === 'string' ? yes.get(r.topic) : '',
    terms: r.terms.filter((t) => typeof t === 'string' && t.trim()).map((t) => ({ label: t, key: norm(t) })),
    unless: (Array.isArray(r.unless) ? r.unless : []).filter((t) => typeof t === 'string' && t.trim()).map(norm),
    only: Array.isArray(r.only) ? new Set(r.only) : null,
  }));
}

// 잠금 해제 직후 한 번. 실패해도 숫자·분량 점검은 그대로 돈다.
export async function prepare(data) {
  known = collectKnown(data);
  rules = [];
  try {
    const mod = await import('./lint-terms.js');
    const dict = await openSealed(data, mod.default);
    if (dict) rules = compile(dict, data);
  } catch (err) {
    console.warn('방어선 사전을 열지 못했습니다 — 데이터가 바뀌었다면 node scripts/lint-terms.mjs', err);
  }
}

export const ruleCount = () => rules.length;

// scope: 이 답이 속한 카드·압박 문항 id (only가 붙은 어구는 그 id에서만 본다)
export function check(text, scope = null) {
  const found = [];
  if (!text || !text.trim()) return found;
  const flat = norm(text);
  const topics = new Set();
  for (const r of rules) {
    if (r.only && !(scope && r.only.has(scope))) continue;
    if (topics.has(r.topic)) continue;
    let hay = flat;
    for (const u of r.unless) if (u) hay = hay.split(u).join('\u0001');
    const hit = r.terms.find((t) => t.key && hay.includes(t.key));
    if (!hit) continue;
    topics.add(r.topic);
    found.push({ kind: 'defense', term: hit.label, topic: r.topic, yes: r.yes });
  }
  const odd = [];
  for (const t of numberTokens(text)) {
    if (!shapes(t).some((s) => known.has(s)) && !odd.includes(t)) odd.push(t);
  }
  if (odd.length) found.push({ kind: 'numbers', values: odd.slice(0, MAX_NUMBERS), more: Math.max(0, odd.length - MAX_NUMBERS) });
  return found;
}
