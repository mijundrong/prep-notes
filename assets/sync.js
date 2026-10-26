// claude.ai 안에서 열었을 때만 쓴다: 상태를 계정의 비공개 저장소 data/users/<id>/ 와 맞춘다.
// 문서마다 updatedAt이 최근인 항목을 남기는 병합(store.mergeDoc)이라 기기 순서와 상관없이 같은 결과로 모인다.
// 없앤 기능의 문서(문항별 피드백 fb_*, 전체 점검 review)는 보이면 지운다.

import * as store from './store.js';

const PUSH_DELAY = 1200;
const MAX_WAIT = 5000;
const RETRY_DELAY = 15000;
// 호출 한도에 걸렸을 때(resource_exhausted)는 더 오래 쉬었다가 다시 올린다.
const BUSY_DELAY = 60000;
const MAX_PARALLEL = 2;
// 문서 하나는 256 KiB까지. 넘으면 올리지 않고 알린다.
const MAX_DOC_BYTES = 256 * 1024;
const FATAL = new Set(['invalid_argument', 'transform_error', 'quota_exceeded', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed']);

let col = null;
let active = false;
let ready = false;
let timer = null;
let pendingSince = 0;
let resubscribed = false;
const remote = new Map();
// 계정 저장소에서 받아 둔 문서 본문 (덮어쓰기 가져오기가 지울 칸을 찾을 때 쓴다)
const bodies = new Map();
const dirty = new Set();
const inflight = new Set();
const obsolete = new Set();
const removed = new Set();
let onRemote = () => {};
let onStatus = () => {};

export const isActive = () => active;
export const knownDocs = () => [...bodies];

// 키 순서와 상관없이 같은 내용이면 같은 문자열
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function differs(id) {
  const body = store.docBody(id);
  return Boolean(body) && canon(body) !== remote.get(id);
}

function report(state, code) {
  onStatus({ state, code, at: new Date() });
}

// 입력이 이어져도 MAX_WAIT 안에는 한 번 올린다.
function schedule(delay = PUSH_DELAY) {
  const now = Date.now();
  if (!pendingSince) pendingSince = now;
  clearTimeout(timer);
  timer = setTimeout(() => {
    pendingSince = 0;
    pushDirty();
  }, Math.max(0, Math.min(delay, pendingSince + MAX_WAIT - now)));
}

// 화면이 가려질 때(앱 전환·탭 닫기) 기다리지 않고 바로 올린다.
export function flushNow() {
  clearTimeout(timer);
  pendingSince = 0;
  pushDirty();
}

function pushDirty() {
  if (!active || !ready) return;
  for (const id of [...obsolete]) {
    if (inflight.size >= MAX_PARALLEL) break;
    if (!inflight.has(id)) drop(id);
  }
  for (const id of [...dirty]) {
    if (inflight.size >= MAX_PARALLEL) break;
    if (inflight.has(id)) continue;
    dirty.delete(id);
    if (differs(id)) push(id);
  }
}

// 이 페이지 열기 동안 문서마다 한 번만 지워 본다. 실패하면 다음에 열 때 다시 지운다.
async function drop(id) {
  obsolete.delete(id);
  removed.add(id);
  inflight.add(id);
  try {
    await col.doc(id).delete();
  } catch {
    // 남아 있어도 읽지 않는 문서라 해가 없다.
  } finally {
    inflight.delete(id);
  }
  if (obsolete.size || dirty.size) schedule(200);
}

async function push(id) {
  const body = store.docBody(id);
  if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_DOC_BYTES) {
    report('error', 'too_large');
    return;
  }
  inflight.add(id);
  report('syncing');
  let failure = null;
  try {
    await col.doc(id).set(body);
    remote.set(id, canon(body));
  } catch (e) {
    failure = e?.code ?? 'unavailable';
    dirty.add(id);
  } finally {
    inflight.delete(id);
  }
  if (failure && FATAL.has(failure)) {
    active = false;
    report('error', failure);
    return;
  }
  if (failure) {
    report('retry', failure);
    clearTimeout(timer);
    pendingSince = 0;
    timer = setTimeout(pushDirty, failure === 'resource_exhausted' ? BUSY_DELAY : RETRY_DELAY);
    return;
  }
  if (dirty.size) schedule(200);
  else if (!inflight.size) report('synced');
}

export async function start({ db, user, onRemoteChange, onStatusChange }) {
  if (!db || !user || active) return false;
  const uid = await user.id();
  if (!uid) return false;
  try {
    col = db.collection(`data/users/${uid}`);
  } catch {
    return false;
  }
  onRemote = onRemoteChange ?? onRemote;
  onStatus = onStatusChange ?? onStatus;
  active = true;
  report('connecting');

  store.onDocChange((id) => {
    dirty.add(id);
    schedule();
  });
  subscribe();
  return true;
}

function subscribe() {
  let first = true;
  col.onSnapshot((snap) => {
    const docs = first ? snap.docs : snap.docChanges().filter((c) => c.type !== 'removed').map((c) => c.doc);
    first = false;
    const changed = [];
    for (const doc of docs) {
      const body = doc.data();
      if (!body) continue;
      if (store.isObsoleteDoc(doc.id)) {
        if (!removed.has(doc.id)) obsolete.add(doc.id);
        continue;
      }
      bodies.set(doc.id, body);
      remote.set(doc.id, canon(body));
      if (store.mergeDoc(doc.id, body)) changed.push(doc.id);
    }
    // 캐시에서 온 첫 결과로 서버 문서를 덮어쓰지 않도록, 서버가 확인한 결과를 받은 뒤부터 올린다.
    if (!snap.metadata.fromCache && !ready) {
      ready = true;
      for (const id of store.docIds()) if (differs(id)) dirty.add(id);
      if (!dirty.size) report('synced');
    }
    for (const doc of docs) if (!store.isObsoleteDoc(doc.id) && differs(doc.id)) dirty.add(doc.id);
    if (changed.length) onRemote(changed);
    if (ready && (dirty.size || obsolete.size)) schedule(300);
  }, (e) => {
    const code = e?.code ?? 'unavailable';
    // 연결이 끊겨 구독이 끝났으면(unavailable) 한 번은 다시 구독한다. 그래도 끝나면 새로고침 전까지 멈춘다.
    if (code === 'unavailable' && !resubscribed) {
      resubscribed = true;
      report('retry', code);
      setTimeout(subscribe, RETRY_DELAY);
      return;
    }
    active = false;
    report('error', code);
  });
}
