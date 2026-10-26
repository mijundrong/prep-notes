#!/usr/bin/env node
// 방어선 어구 사전: lint-terms.json(평문, 커밋하지 않음) → assets/lint-terms.js(암호문, 공개)
//
// 사전은 면접 준비 내용 그 자체라 공개 저장소에 평문으로 둘 수 없다. 그래서 AES-256-GCM으로 암호화하되,
// 키는 비밀번호가 아니라 interview_data.json의 방어선(defense) 원문에서 만든다(SHA-256).
// data.enc.json을 연 사람만 열 수 있고, 비밀번호 없이도 다시 만들 수 있다.
// 방어선을 고치면 키가 바뀌므로 이 스크립트를 다시 돌린다 (encrypt.mjs가 data.enc.json을 만들 때 함께 돌린다).
//
// 사용:
//   node scripts/lint-terms.mjs            사전을 검사하고 assets/lint-terms.js를 갱신 (내용이 같으면 그대로 둔다)
//   node scripts/lint-terms.mjs --check    assets/lint-terms.js가 지금 데이터·사전과 맞는지 확인만
//   node scripts/lint-terms.mjs --extract  assets/lint-terms.js에서 lint-terms.json을 되살린다 (원본을 잃었을 때)

import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
// assets/lint.js의 SEAL_INFO와 같아야 한다.
const SEAL_INFO = 'prep-lint-terms:v1\n';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PATHS = {
  data: resolve(ROOT, 'interview_data.json'),
  dict: resolve(ROOT, 'lint-terms.json'),
  sealed: resolve(ROOT, 'assets/lint-terms.js'),
};
const HEADER = [
  '// 생성 파일 — 직접 고치지 않는다. 원본은 lint-terms.json(평문, 커밋하지 않음) → node scripts/lint-terms.mjs',
  '// 로컬 점검용 방어선 어구 사전을 AES-256-GCM으로 암호화했다. 키는 잠금 해제한 데이터의 방어선 원문에서 만든다.',
].join('\n');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function keyFor(data) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(SEAL_INFO + JSON.stringify(data.defense ?? [])));
  return subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// 사전 검사: 오류 목록 (비어 있으면 통과)
export function validateDict(dict, data) {
  const errors = [];
  if (!isObj(dict) || dict.v !== 1 || !Array.isArray(dict.rules)) return ['lint-terms.json 형식: { "v": 1, "rules": [...] }'];
  const topics = new Set((data.defense ?? []).map((d) => d.topic));
  const ids = new Set([...(data.cards ?? []).map((c) => c.id), ...(data.pressure ?? []).map((p) => p.id)]);
  dict.rules.forEach((r, i) => {
    const at = `rules[${i}]`;
    if (!isObj(r)) return errors.push(`${at}: 객체가 아님`);
    if (!topics.has(r.topic)) errors.push(`${at}: 방어선에 없는 주제 "${r.topic}"`);
    if (!Array.isArray(r.terms) || !r.terms.length || !r.terms.every((t) => typeof t === 'string' && t.trim())) errors.push(`${at}: terms는 비어 있지 않은 문자열 목록`);
    if (r.unless !== undefined && !(Array.isArray(r.unless) && r.unless.every((t) => typeof t === 'string' && t.trim()))) errors.push(`${at}: unless는 문자열 목록`);
    if (r.only !== undefined) {
      if (!Array.isArray(r.only) || !r.only.length) errors.push(`${at}: only는 비어 있지 않은 id 목록`);
      else for (const id of r.only) if (!ids.has(id)) errors.push(`${at}: 없는 카드·압박 문항 id "${id}"`);
    }
    return null;
  });
  return errors;
}

function readSealed(path = PATHS.sealed) {
  if (!existsSync(path)) return null;
  const m = /export default (\{[\s\S]*\});/.exec(readFileSync(path, 'utf8'));
  try {
    const sealed = m ? JSON.parse(m[1]) : null;
    return sealed && sealed.v === 1 && typeof sealed.iv === 'string' && typeof sealed.ct === 'string' ? sealed : null;
  } catch {
    return null;
  }
}

export async function openSealed(data, sealed) {
  if (!sealed) return null;
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, await keyFor(data), unb64(sealed.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

async function seal(data, dict) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(dict));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(data), plain));
  return `${HEADER}\nexport default ${JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) })};\n`;
}

// encrypt.mjs도 부른다. { changed, errors, missing }
export async function updateSealed(data, { dictPath = PATHS.dict, sealedPath = PATHS.sealed } = {}) {
  if (!existsSync(dictPath)) return { changed: false, errors: [], missing: true };
  let dict;
  try {
    dict = JSON.parse(readFileSync(dictPath, 'utf8'));
  } catch (e) {
    return { changed: false, errors: [`lint-terms.json을 읽지 못함: ${e.message}`], missing: false };
  }
  const errors = validateDict(dict, data);
  if (errors.length) return { changed: false, errors, missing: false };
  const current = await openSealed(data, readSealed(sealedPath));
  if (current && JSON.stringify(current) === JSON.stringify(dict)) return { changed: false, errors: [], missing: false };
  writeFileSync(sealedPath, await seal(data, dict));
  return { changed: true, errors: [], missing: false };
}

// 이 경로가 실제 데이터(저장소의 interview_data.json)인가 — encrypt.mjs가 사전을 함께 갱신할지 정할 때 쓴다.
// 경로 표기(./, 절대 경로)와 상관없이, Windows에서는 대소문자도 무시하고 비교한다.
export function isDataPath(path) {
  const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(path) === norm(PATHS.data);
}

// 지금 데이터로 assets/lint-terms.js가 열리는지 — encrypt.mjs가 사전 원본이 없을 때 경고용으로 쓴다.
export async function sealedOpens(data, sealedPath = PATHS.sealed) {
  return Boolean(await openSealed(data, readSealed(sealedPath)));
}

function loadData() {
  try {
    return JSON.parse(readFileSync(PATHS.data, 'utf8'));
  } catch (e) {
    console.error(`interview_data.json을 읽지 못했습니다: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const mode = process.argv[2] ?? '';
  const data = loadData();
  if (mode === '--extract') {
    const dict = await openSealed(data, readSealed());
    if (!dict) {
      console.error('assets/lint-terms.js를 지금 interview_data.json으로 열 수 없습니다 (방어선이 바뀌었으면 바뀌기 전 데이터가 필요합니다).');
      process.exit(1);
    }
    if (existsSync(PATHS.dict)) {
      console.error('lint-terms.json이 이미 있습니다. 덮어쓰지 않습니다.');
      process.exit(1);
    }
    writeFileSync(PATHS.dict, JSON.stringify(dict, null, 2) + '\n');
    console.log(`되살렸습니다: ${PATHS.dict} (규칙 ${dict.rules?.length ?? 0}개)`);
    return;
  }
  if (mode === '--check') {
    const opened = await openSealed(data, readSealed());
    if (!opened) {
      console.error('assets/lint-terms.js가 지금 데이터로 열리지 않습니다: node scripts/lint-terms.mjs');
      process.exit(1);
    }
    if (existsSync(PATHS.dict) && JSON.stringify(opened) !== JSON.stringify(JSON.parse(readFileSync(PATHS.dict, 'utf8')))) {
      console.error('assets/lint-terms.js가 lint-terms.json과 다릅니다: node scripts/lint-terms.mjs');
      process.exit(1);
    }
    console.log(`맞습니다 (규칙 ${opened.rules?.length ?? 0}개).`);
    return;
  }
  if (mode) {
    console.error('사용: node scripts/lint-terms.mjs [--check | --extract]');
    process.exit(1);
  }
  const { changed, errors, missing } = await updateSealed(data);
  if (missing) {
    console.error('lint-terms.json이 없습니다. 원본을 잃었다면: node scripts/lint-terms.mjs --extract');
    process.exit(1);
  }
  if (errors.length) {
    console.error(`사전 검사 실패 — 만들지 않습니다. 오류 ${errors.length}건:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(changed ? '갱신: assets/lint-terms.js' : '변경 없음: assets/lint-terms.js');
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) main();
