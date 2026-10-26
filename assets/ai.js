// claude.ai 안에서만 생기는 Claude 호출 함수(sample)를 물어보기(coach.js)와 엮기(weave.js)가 함께 쓴다.
// GitHub Pages에는 window.claude가 없어 init(null) 상태로 남고, Claude 기능은 모두 숨겨진다.

let sample = null;
let notice = () => {};
const listeners = new Set();

// 이 코드가 오면 이 화면에서는 다시 묻지 않고 Claude 기능을 숨긴다.
const HIDE = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable']);
const ERROR_TEXT = {
  rate_limited: '요청이 많습니다. 잠시 뒤 다시 눌러 주세요.',
  session_expired: 'claude.ai 로그인이 끝났습니다. 다시 로그인한 뒤 눌러 주세요.',
  refused: 'Claude가 이 요청에는 답하지 않았습니다.',
  prompt_too_large: '보낼 내용이 너무 깁니다.',
  empty_completion: '빈 응답이 왔습니다. 다시 눌러 주세요.',
  invalid_json: '응답을 읽지 못했습니다(JSON 형식 아님). 다시 눌러 주세요.',
  upstream_error: '응답을 받지 못했습니다. 다시 눌러 주세요.',
};

export const available = () => Boolean(sample);
export const isHidden = (code) => HIDE.has(code);
export const errorText = (code) => ERROR_TEXT[code] ?? ERROR_TEXT.upstream_error;

export function init(fn) {
  sample = typeof fn === 'function' ? fn : null;
  if (typeof document !== 'undefined') document.documentElement.dataset.ai = sample ? 'on' : 'off';
  for (const cb of listeners) cb(Boolean(sample));
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onNotice(fn) {
  notice = fn;
}

function failed(e) {
  const code = e?.code ?? 'upstream_error';
  if (HIDE.has(code) && sample) {
    init(null);
    notice('이 화면에서는 Claude를 쓸 수 없어 Claude 기능을 숨겼습니다. 허용하려면 페이지를 다시 여세요.');
  }
  return { code, text: code === 'refused' ? '' : (e?.text ?? '') };
}

// 실패하면 { code, text } 하나로 거절한다. 같은 호출을 코드에서 다시 하지 않는다.
export async function ask(input, options) {
  if (!sample) throw { code: 'not_granted', text: '' };
  try {
    return await sample(input, options);
  } catch (e) {
    throw failed(e);
  }
}

// 응답 전체 → 코드 울타리 안 → 첫 { 부터 마지막 } 까지, 순서대로 JSON으로 읽어 본다.
export function parseLoose(text) {
  const tries = [text, /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]];
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) tries.push(text.slice(start, end + 1));
  for (const t of tries) {
    if (typeof t !== 'string' || !t.trim()) continue;
    try {
      return JSON.parse(t);
    } catch {
      // 다음 방법으로
    }
  }
  return undefined;
}

// 응답을 JSON 값 하나로 받는다. sample.json이 없는 런타임에서는 글로 받아 직접 읽는다.
export async function askJson(input, options) {
  if (!sample) throw { code: 'not_granted', text: '' };
  try {
    if (typeof sample.json === 'function') return await sample.json(input, options);
    const { text, truncated } = await sample(input, options);
    const value = truncated ? undefined : parseLoose(text);
    if (value === undefined) throw { code: 'invalid_json', text };
    return value;
  } catch (e) {
    throw failed(e);
  }
}
