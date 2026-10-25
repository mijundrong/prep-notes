#!/usr/bin/env node
// 평문 interview_data.json의 스키마·개수·개인식별정보 패턴을 검증한다.
// 사용: node scripts/check.mjs [경로]   (기본값 interview_data.json)
// encrypt.mjs가 validate()를 가져다 쓴다.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP_KEYS = ['meta', 'positioning', 'profile', 'job', 'company', 'cards', 'pressure', 'glossary', 'study', 'defense'];
const COMPANY_KEYS = ['해양 사업 개요', '구미 신사업장', '회사 연혁 요약', '지배구조', '미확인 — 단정 금지', '무인체계 전략', '경쟁 구도'];
const CARD_GROUPS = ['학교·학점·전공', '자격증', '교육', '수상', '연구실적', '병역', '기타', '자소서', '포트폴리오'];
const QUESTION_KEYS = ['why', 'what', 'learned', 'apply'];
const GLOSSARY_CATEGORIES = ['JD 직접', 'SE', '함급·사업', '아키텍처', '장비·체계', '조직·제도'];
const GRADES = ['강', '중~강', '중', '약', '없음'];
const PRIORITIES = [1, 2, 3];

// 스키마 표기: 'str' 문자열, 'str+' 비어 있지 않은 문자열, 'bool', 'int'
// { arr, len } 배열, { obj } 필수 키 객체, { enum } 허용 값, { map } 키가 정해지지 않은 객체
const S = 'str';
const NE = 'str+';
const arr = (item, len) => ({ arr: item, len });
const obj = (fields) => ({ obj: fields });
const oneOf = (...values) => ({ enum: values });
const strs = (len) => arr(S, len);

const SCHEMA = obj({
  meta: obj({
    title: S, owner: S, built: S, version: oneOf('v2'), deadline_note: S, principle: S,
    q4: arr(NE, 4),
    tabs: arr(NE, 8),
    counts: obj({ cards: 'int', pressure: 'int', glossary: 'int', defense: 'int', study: 'int', followups: 'int', pillars: 'int' }),
  }),
  positioning: obj({
    spine: obj({ headline: S, lines: arr(obj({ label: S, text: S })) }),
    naval_se: obj({ one_line: S, difficulties: arr(obj({ trait: S, meaning: S, need: S })), junior_note: S }),
    company_now: obj({ identity: S, axes: arr(obj({ axis: S, what: S, src: S })), compressed: S, caution: S }),
    company_needs: arr(obj({ theme: S, why: S, person: S })),
    thesis: obj({ core: S, layer: S, note: S }),
    evidence_map: arr(obj({ need: S, evidence: S, grade: oneOf(...GRADES) })),
    why_now: arr(obj({ now: S, need: S, me: S })),
    why_now_line: S,
    pillars: arr(obj({ n: 'int', title: S, role: S, evidence: S, line: S }), 5),
    combination: S,
    rediscovered: arr(obj({ exp: S, before: S, after: S, confirm: 'bool' })),
    vs_masters: obj({
      premise: S, they_bring: S, shift: S, i_bring: strs(), never: S,
      must_answer: arr(obj({ topic: S, what: S, link: S })),
    }),
    weaknesses: arr(obj({ weak: S, response: S })),
    scripts: obj({ note: S, intro60: S, whyme90: S }),
    to_confirm: strs(),
  }),
  profile: obj({
    name: S, school: S, period: S, gpa: S, language: S, military: S, target: S, identity: S,
    transcript: arr(obj({ term: S, gpa: S, courses: S })),
  }),
  job: obj({
    jd_raw: strs(3),
    jd_meta: obj({ 근무지: S, 선발학위: S, 선발전공: S, 우대사항: S, 지원: S }),
    jd_translated: arr(obj({ jd: S, real: S, junior: S, mine: S })),
    unmanned_extension: obj({ headline: S, structure: strs(), experiment_2026_08: strs(), for_junior: S }),
    se_practice_vocab: obj({ source: S, items: arr(obj({ term: S, note: S })) }),
    career_posting_hanwha_systems: obj({ title: S, known: S, missing: S, url: S }),
  }),
  company: obj(Object.fromEntries(COMPANY_KEYS.map((k) => [k, strs()]))),
  cards: arr(obj({
    id: NE, group: oneOf(...CARD_GROUPS), title: NE, priority: oneOf(...PRIORITIES), period: S,
    facts: strs(),
    questions: arr(obj({ key: oneOf(...QUESTION_KEYS), label: NE, hint: NE }), 4),
    caution: strs(),
    followups: strs(),
    options: arr(obj({ label: NE, detail: S })),
  })),
  pressure: arr(obj({
    id: NE, title: NE, priority: oneOf(...PRIORITIES), prompt: NE, hint: NE,
    material: strs(), caution: strs(),
  })),
  glossary: arr(obj({ term: NE, en: S, category: oneOf(...GLOSSARY_CATEGORIES), short: S, why: S, mine: S })),
  study: arr(obj({ id: NE, priority: oneOf(...PRIORITIES), title: NE, what: S, why: S, where: S })),
  defense: arr(obj({ topic: S, no: S, yes: S, why: S })),
});

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isPlainObject = (v) => typeName(v) === 'object';

function checkNode(value, schema, path, errors) {
  if (schema === S || schema === NE) {
    if (typeof value !== 'string') errors.push(`${path}: 문자열이어야 함 (현재 ${typeName(value)})`);
    else if (schema === NE && value.trim() === '') errors.push(`${path}: 비어 있으면 안 됨`);
    return;
  }
  if (schema === 'bool') {
    if (typeof value !== 'boolean') errors.push(`${path}: boolean이어야 함 (현재 ${typeName(value)})`);
    return;
  }
  if (schema === 'int') {
    if (!Number.isInteger(value)) errors.push(`${path}: 정수여야 함 (현재 ${JSON.stringify(value)})`);
    return;
  }
  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: 허용 값이 아님 ${JSON.stringify(value)} (허용: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')})`);
    }
    return;
  }
  if (schema.arr) {
    if (!Array.isArray(value)) {
      errors.push(`${path}: 배열이어야 함 (현재 ${typeName(value)})`);
      return;
    }
    if (schema.len !== undefined && value.length !== schema.len) {
      errors.push(`${path}: 항목이 정확히 ${schema.len}개여야 함 (현재 ${value.length}개)`);
    }
    value.forEach((item, i) => checkNode(item, schema.arr, `${path}[${i}]`, errors));
    return;
  }
  if (schema.obj) {
    if (!isPlainObject(value)) {
      errors.push(`${path}: 객체여야 함 (현재 ${typeName(value)})`);
      return;
    }
    for (const [key, sub] of Object.entries(schema.obj)) {
      if (!(key in value)) errors.push(`${path}.${key}: 필수 키 없음`);
      else checkNode(value[key], sub, `${path}.${key}`, errors);
    }
    for (const key of Object.keys(value)) {
      if (!(key in schema.obj)) errors.push(`${path}.${key}: 스키마에 없는 키`);
    }
  }
}

function checkUnique(list, field, path, errors) {
  if (!Array.isArray(list)) return;
  const seen = new Set();
  list.forEach((item, i) => {
    const v = item?.[field];
    if (v === undefined) return;
    if (seen.has(v)) errors.push(`${path}[${i}].${field}: 중복 값 ${JSON.stringify(v)}`);
    seen.add(v);
  });
}

// 모든 문자열(키 포함)을 훑어 개인식별정보로 보이는 패턴을 찾는다.
function scanPii(value, path, errors) {
  const scanText = (text, where) => {
    const digits = text.match(/\d{8,}/g);
    if (digits) errors.push(`${where}: 8자리 이상 연속 숫자 ${digits.map((d) => JSON.stringify(d)).join(', ')}`);
    for (const m of text.matchAll(/(?<!\d)(\d{4})\.(\d{1,2})\.(\d{1,2})(?!\d)/g)) {
      const [whole, y, mo, d] = m;
      const month = Number(mo);
      const day = Number(d);
      if (Number(y) < 2021 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        errors.push(`${where}: 생년월일로 보이는 날짜 ${JSON.stringify(whole)} (2021년 이후 날짜만 허용)`);
      }
    }
  };
  if (typeof value === 'string') scanText(value, path);
  else if (typeof value === 'number') scanText(String(value), path);
  else if (Array.isArray(value)) value.forEach((v, i) => scanPii(v, `${path}[${i}]`, errors));
  else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      scanText(k, `${path} 키 ${JSON.stringify(k)}`);
      scanPii(v, `${path}.${k}`, errors);
    }
  }
}

export function countItems(data) {
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  return {
    cards: cards.length,
    pressure: Array.isArray(data?.pressure) ? data.pressure.length : 0,
    glossary: Array.isArray(data?.glossary) ? data.glossary.length : 0,
    defense: Array.isArray(data?.defense) ? data.defense.length : 0,
    study: Array.isArray(data?.study) ? data.study.length : 0,
    followups: cards.reduce((sum, c) => sum + (Array.isArray(c?.followups) ? c.followups.length : 0), 0),
    pillars: Array.isArray(data?.positioning?.pillars) ? data.positioning.pillars.length : 0,
  };
}

// 오류 목록을 돌려준다. 빈 배열이면 통과.
export function validate(data) {
  const errors = [];
  if (!isPlainObject(data)) return [`최상위: 객체여야 함 (현재 ${typeName(data)})`];

  const keys = Object.keys(data);
  if (keys.join('\u0000') !== TOP_KEYS.join('\u0000')) {
    errors.push(`최상위 키 순서가 다름: 현재 [${keys.join(', ')}] / 기대 [${TOP_KEYS.join(', ')}]`);
  }
  checkNode(data, SCHEMA, '$', errors);

  if (Array.isArray(data.cards)) {
    data.cards.forEach((card, i) => {
      if (!Array.isArray(card?.questions)) return;
      const qKeys = card.questions.map((q) => q?.key);
      if (qKeys.join(',') !== QUESTION_KEYS.join(',')) {
        errors.push(`$.cards[${i}](${card.id}).questions: key가 ${QUESTION_KEYS.join('/')} 순서여야 함 (현재 ${qKeys.join('/')})`);
      }
    });
  }
  checkUnique(data.cards, 'id', '$.cards', errors);
  checkUnique(data.pressure, 'id', '$.pressure', errors);
  checkUnique(data.study, 'id', '$.study', errors);
  checkUnique(data.glossary, 'term', '$.glossary', errors);
  checkUnique(data.positioning?.pillars, 'n', '$.positioning.pillars', errors);

  const declared = data.meta?.counts;
  if (isPlainObject(declared)) {
    const actual = countItems(data);
    for (const [key, n] of Object.entries(actual)) {
      if (declared[key] !== undefined && declared[key] !== n) {
        errors.push(`meta.counts.${key} = ${declared[key]} 이지만 실제 개수는 ${n}`);
      }
    }
  }

  scanPii(data, '$', errors);
  return errors;
}

export function checkFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { data: null, errors: [`파일을 읽을 수 없음: ${path} (${e.code ?? e.message})`] };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { data: null, errors: [`JSON 파싱 실패: ${e.message}`] };
  }
  return { data, errors: validate(data) };
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const path = process.argv[2] ?? 'interview_data.json';
  const { data, errors } = checkFile(path);
  if (errors.length) {
    console.error(`검증 실패: ${path} — 오류 ${errors.length}건`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const c = countItems(data);
  console.log(`검증 통과: ${path} (meta.version ${data.meta.version})`);
  console.log(`  cards ${c.cards} · pressure ${c.pressure} · glossary ${c.glossary} · defense ${c.defense} · study ${c.study} · followups ${c.followups} · pillars ${c.pillars}`);
}
