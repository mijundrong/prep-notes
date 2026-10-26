#!/usr/bin/env node
// 평문 interview_data.json → data.enc.json
// PBKDF2-HMAC-SHA256 600,000회로 키를 유도하고 AES-256-GCM으로 암호화한다.
//
// 사용:
//   node scripts/encrypt.mjs                        비밀번호를 터미널에서 입력 (화면에는 * 표시)
//   node scripts/encrypt.mjs --pass-env PREP_PASS   환경변수에서 비밀번호를 읽는다 (로컬 테스트 전용)
//   --in <path>  --out <path>                       기본값 interview_data.json → data.enc.json
//   --skip-lint-terms                               assets/lint-terms.js를 건드리지 않는다 (시험용 사본을 만들 때)
//
// 입력이 저장소의 interview_data.json이면(경로 표기와 상관없이) 방어선 어구 사전 assets/lint-terms.js도 함께 갱신한다.
//
// 같은 비밀번호로 다시 암호화하면 기존 salt를 유지한다. 그래야 "이 기기에서 기억하기"로
// 저장된 키가 데이터 갱신 후에도 그대로 맞는다. 비밀번호가 바뀌면 salt를 새로 만든다.

import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';
import { validate } from './check.mjs';
import { updateSealed, sealedOpens, isDataPath } from './lint-terms.mjs';

const { subtle } = webcrypto;
const ITER = 600000;
const MIN_LENGTH = 12;
const TEST_PASSWORD = 'local-test-only';

const HELP = `사용: node scripts/encrypt.mjs [--in interview_data.json] [--out data.enc.json] [--pass-env VAR] [--skip-lint-terms]`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { in: 'interview_data.json', out: 'data.enc.json', passEnv: null, skipLintTerms: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) fail(`${arg} 다음에 값이 필요합니다.\n${HELP}`);
      return v;
    };
    if (arg === '--in') opts.in = value();
    else if (arg === '--out') opts.out = value();
    else if (arg === '--pass-env') opts.passEnv = value();
    else if (arg === '--skip-lint-terms') opts.skipLintTerms = true;
    else if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else fail(`알 수 없는 옵션: ${arg}\n${HELP}`);
  }
  return opts;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));
const randomBytes = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const charCount = (text) => Array.from(text).length;

// 입력이 화면에 보이지 않는 프롬프트. raw mode로 키를 하나씩 받아 * 만 출력한다.
function askHidden(question) {
  return new Promise((resolvePrompt, rejectPrompt) => {
    const input = process.stdin;
    if (!input.isTTY) {
      rejectPrompt(new Error(
        '비밀번호를 입력할 터미널을 찾지 못했습니다. PowerShell·명령 프롬프트·Windows Terminal에서 실행하세요.\n' +
        '(Git Bash라면: winpty node scripts/encrypt.mjs)',
      ));
      return;
    }
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stdout.write(question);
    let value = '';

    const finish = (error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) rejectPrompt(error);
      else resolvePrompt(value);
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('취소했습니다.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') {
        if (value) {
          value = Array.from(value).slice(0, -1).join('');
          process.stdout.write('\b \b');
        }
        return;
      }
      if (key.ctrl || key.meta || !str || /[\u0000-\u001f\u007f]/.test(str)) return;
      value += str;
      process.stdout.write('*'.repeat(charCount(str)));
    };
    input.on('keypress', onKey);
  });
}

async function promptPassword() {
  for (;;) {
    const first = await askHidden('비밀번호: ');
    if (charCount(first) < MIN_LENGTH) {
      console.error(`경고: 비밀번호가 ${MIN_LENGTH}자 미만입니다. 더 길게 다시 입력하세요.`);
      continue;
    }
    const second = await askHidden('비밀번호 확인: ');
    if (first !== second) {
      console.error('두 입력이 일치하지 않습니다. 처음부터 다시 입력하세요.');
      continue;
    }
    return first;
  }
}

async function deriveKey(password, salt, iterations) {
  const material = await subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function readEnvelope(path) {
  try {
    const env = JSON.parse(readFileSync(path, 'utf8'));
    const ok = env && env.v === 1 && env.kdf === 'PBKDF2' && env.hash === 'SHA-256' &&
      Number.isInteger(env.iter) && [env.salt, env.iv, env.ct].every((s) => typeof s === 'string' && s);
    return ok ? env : null;
  } catch {
    return null;
  }
}

// 기존 data.enc.json이 같은 비밀번호로 열리면 그 salt와 키를 돌려준다.
async function reusableKey(path, password) {
  const prev = existsSync(path) ? readEnvelope(path) : null;
  if (!prev || prev.iter !== ITER) return null;
  const salt = unb64(prev.salt);
  const key = await deriveKey(password, salt, ITER);
  try {
    await subtle.decrypt({ name: 'AES-GCM', iv: unb64(prev.iv) }, key, unb64(prev.ct));
    return { salt, key };
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inPath = resolve(opts.in);
  const outPath = resolve(opts.out);
  if (inPath.toLowerCase() === outPath.toLowerCase()) fail('--in과 --out이 같은 파일입니다.');

  let plain;
  try {
    plain = readFileSync(inPath);
  } catch (e) {
    fail(`입력 파일을 읽을 수 없습니다: ${inPath} (${e.code ?? e.message})`);
  }

  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch (e) {
    fail(`입력 파일이 올바른 UTF-8 JSON이 아닙니다: ${e.message}`);
  }
  const errors = validate(data);
  if (errors.length) {
    console.error(`스키마 검증 실패 — 암호화하지 않습니다. 오류 ${errors.length}건:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  let password;
  if (opts.passEnv) {
    password = process.env[opts.passEnv] ?? '';
    if (!password) fail(`환경변수 ${opts.passEnv}가 비어 있습니다.`);
    if (charCount(password) < MIN_LENGTH) fail(`비밀번호가 ${MIN_LENGTH}자 미만입니다.`);
  } else {
    try {
      password = await promptPassword();
    } catch (e) {
      fail(e.message);
    }
  }

  console.log('키 유도 중… (PBKDF2 600,000회)');
  const reused = await reusableKey(outPath, password);
  const salt = reused ? reused.salt : randomBytes(16);
  const key = reused ? reused.key : await deriveKey(password, salt, ITER);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));

  const envelope = { v: 1, kdf: 'PBKDF2', hash: 'SHA-256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  const out = JSON.stringify(envelope, null, 2) + '\n';
  writeFileSync(outPath, out);

  console.log(`완료: ${outPath}`);
  console.log(`  크기: ${Buffer.byteLength(out)} 바이트 (평문 ${plain.length} 바이트)`);
  console.log(`  meta.version: ${data.meta.version}`);
  console.log(`  meta.counts: ${JSON.stringify(data.meta.counts)}`);
  console.log(reused
    ? '  salt: 기존 값 유지 (같은 비밀번호) — "이 기기에서 기억하기"를 켠 기기는 그대로 열립니다.'
    : '  salt: 새로 생성 — "이 기기에서 기억하기"를 켠 기기는 다시 잠금 해제해야 합니다.');
  if (password === TEST_PASSWORD) {
    console.log('  주의: 테스트 비밀번호로 암호화했습니다. 이 파일은 pre-commit 훅이 커밋을 막습니다.');
  }

  // 방어선 어구 사전(assets/lint-terms.js)의 키는 방어선 원문에서 나온다. 방어선이 바뀌면 여기서 함께 다시 만든다.
  if (opts.skipLintTerms) {
    console.log('  assets/lint-terms.js: 건너뜀 (--skip-lint-terms)');
    return;
  }
  if (!isDataPath(inPath)) {
    console.log('  assets/lint-terms.js: 건너뜀 (입력이 저장소의 interview_data.json이 아님)');
    return;
  }
  const lint = await updateSealed(data);
  if (lint.errors.length) {
    console.error('  주의: lint-terms.json 검사 실패 — assets/lint-terms.js를 갱신하지 않았습니다.');
    for (const e of lint.errors) console.error(`    - ${e}`);
  } else if (lint.missing) {
    if (!(await sealedOpens(data))) console.log('  주의: lint-terms.json이 없고 assets/lint-terms.js가 이 데이터로 열리지 않습니다 — 방어선 어구 경고가 꺼집니다.');
  } else {
    console.log(lint.changed ? '  assets/lint-terms.js: 갱신 — data.enc.json과 함께 커밋하세요.' : '  assets/lint-terms.js: 변경 없음');
  }
}

main();
