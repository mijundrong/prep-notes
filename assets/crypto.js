// data.enc.json 복호화. 형식은 scripts/encrypt.mjs와 같다.
// { v:1, kdf:"PBKDF2", hash:"SHA-256", iter, salt, iv, ct }  — 값은 모두 base64

const KEY_NAME = 'prep:key';

export class FetchError extends Error {}

export const supported = () => Boolean(globalThis.crypto && crypto.subtle && window.isSecureContext);

const fromB64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

function toB64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

let envelope = null;

export async function loadEnvelope() {
  if (envelope) return envelope;
  let res;
  try {
    res = await fetch('data.enc.json', { cache: 'no-cache' });
  } catch {
    throw new FetchError('network');
  }
  if (!res.ok) throw new FetchError(String(res.status));
  const env = await res.json().catch(() => null);
  const ok = env && env.v === 1 && env.kdf === 'PBKDF2' && env.hash === 'SHA-256' &&
    Number.isInteger(env.iter) && [env.salt, env.iv, env.ct].every((s) => typeof s === 'string' && s);
  if (!ok) throw new Error('format');
  envelope = env;
  return env;
}

export async function deriveKey(password, env) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(env.salt), iterations: env.iter, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt'],
  );
}

export async function decrypt(key, env) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

export const exportKey = async (key) => toB64(await crypto.subtle.exportKey('raw', key));

export const importKey = (text) => crypto.subtle.importKey('raw', fromB64(text), { name: 'AES-GCM' }, false, ['decrypt']);

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function storedKey() {
  return safe(() => sessionStorage.getItem(KEY_NAME)) ?? safe(() => localStorage.getItem(KEY_NAME));
}

export function storeKey(text, remember) {
  safe(() => sessionStorage.setItem(KEY_NAME, text));
  safe(() => (remember ? localStorage.setItem(KEY_NAME, text) : localStorage.removeItem(KEY_NAME)));
}

export function forgetKey() {
  safe(() => sessionStorage.removeItem(KEY_NAME));
  safe(() => localStorage.removeItem(KEY_NAME));
}
