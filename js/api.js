(() => {
'use strict';
const { DEMO_URL, handleDemo, t } = window.Jjim;
const TIMEOUT_MS = 30000;

const FULL_STATE_EVERY = 30;

const fail = (error, message) => ({ ok: false, error, message });

let layout = null; // { url, key, seats, floors, items, walls }
let statesSinceFull = 0;

function forgetLayout() {
  layout = null;
  statesSinceFull = 0;
}

async function send(url, body) {
  if (url === DEMO_URL) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return handleDemo(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  let text = '';
  let reading = false;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: controller.signal
    });
    if (response.ok) {
      reading = true;
      text = (await response.text()).trimStart();
    }
  } catch (error) {
    clearTimeout(timer);
    if (error && error.name === 'AbortError') return fail('timeout', t('응답이 늦어요. 잠시 뒤 다시 해 주세요.'));
    if (navigator.onLine === false || reading) return fail('network', t('인터넷에 연결되어 있는지 확인해 주세요.'));
    if (await reachable(url)) return fail('gone', t('좌석 예약 서버와 연결하지 못했어요. 관리자에게 웹 앱 배포가 살아 있고 액세스 권한이 \'모든 사용자\' 인지 확인해 달라고 해 주세요.'));
    return fail('network', t('좌석 예약 서버와 연결하지 못했어요. 관리자에게 웹 앱 배포가 살아 있고 액세스 권한이 \'모든 사용자\' 인지 확인해 달라고 해 주세요.'));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const code = response.status;
    if (code === 404) return fail('server', t('좌석 예약 서버를 찾지 못했어요(404). 관리자에게 연결 코드가 맞는지 확인해 달라고 해 주세요.'));
    if (code === 401 || code === 403) return fail('server', t('좌석 예약 서버가 접근을 막았어요({code}). 웹 앱 액세스 권한이 \'모든 사용자\' 여야 해요.', { code }));
    if (code === 429) return fail('server', t('지금 예약하는 분이 많아요. 잠시 뒤 다시 해 주세요.'));
    return fail('server', code >= 500 ? t('좌석 예약 서버에 문제가 생겼어요({code}). 잠시 뒤 다시 해 주세요.', { code }) : t('좌석 예약 서버가 요청을 받지 않았어요({code}).', { code }));
  }

  if (!text.startsWith('{')) {
    return fail('bad-response', t('좌석 예약 서버가 올바른 답을 주지 않았어요. 웹 앱 액세스 권한이 \'모든 사용자\' 인지 확인해 주세요.'));
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed.ok && !parsed.message) parsed.message = t('요청이 받아들여지지 않았어요.');
    return parsed;
  } catch (e) {
    return fail('bad-response', t('답을 읽지 못했어요.'));
  }
}

async function reachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function post(connection, personId, action, extra = {}) {
  if (!connection) return Promise.resolve(fail('network', t('연결하지 못했어요.')));
  const body = { ...extra, action, device: personId };
  if (connection.adminKey) body.admin = connection.adminKey;
  return send(connection.url, body);
}

function normalize(state) {
  state.itemsSupported = Array.isArray(state.items);
  state.items = state.itemsSupported ? state.items : [];
  state.walls = Array.isArray(state.walls) ? state.walls : [];
  state.seats = Array.isArray(state.seats) ? state.seats : [];
  state.floors = Array.isArray(state.floors) ? state.floors : [];
  state.taken = Array.isArray(state.taken) ? state.taken : [];
  state.canUnlimit = state.canUnlimit === true;
  state.maxPerPerson = state.canUnlimit && state.maxPerPerson === 0 ? 0 : Math.min(Math.max(state.maxPerPerson | 0 || 1, 1), 20);
  state.showNames = state.showNames !== false;
  return state;
}

function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
}

async function getState(connection, personId) {
  let knownKey = null;

  if (layout && layout.url === connection.url) {
    statesSinceFull++;
    if (statesSinceFull >= FULL_STATE_EVERY) statesSinceFull = 0;
    else knownKey = layout.key;
  }

  const extra = knownKey ? { layoutKey: knownKey } : {};
  const zone = connection.adminKey ? localZone() : '';
  if (zone) extra.tz = zone;
  const state = await post(connection, personId, 'state', extra);
  if (!state.ok) return state;

  if (!state.layoutSame) {
    if (state.layoutKey) {
      if (!layout || layout.url !== connection.url || layout.key !== state.layoutKey) statesSinceFull = 0;
      layout = { url: connection.url, key: state.layoutKey, seats: state.seats || [], floors: state.floors || [], items: state.items, walls: state.walls };
    } else {
      forgetLayout();
    }
    return normalize(state);
  }

  if (layout && layout.url === connection.url && layout.key === state.layoutKey) {
    state.seats = layout.seats.slice();
    state.floors = layout.floors.slice();
    if (Array.isArray(state.items)) state.items = (layout.items || []).slice();
    if (Array.isArray(state.walls)) state.walls = (layout.walls || []).slice();
    state.layoutSame = false;
    return normalize(state);
  }

  forgetLayout();
  const full = await post(connection, personId, 'state', zone ? { tz: zone } : {});
  if (!full.ok) return full;
  if (full.layoutSame) return fail('bad-response', t('답을 읽지 못했어요.'));
  if (full.layoutKey) layout = { url: connection.url, key: full.layoutKey, seats: full.seats || [], floors: full.floors || [], items: full.items, walls: full.walls };
  return normalize(full);
}

async function saveLayout(connection, personId, seats, floors, items, walls) {
  forgetLayout();
  const response = await post(connection, personId, 'saveLayout', { seats, floors, items, walls });
  forgetLayout();
  return response;
}
Object.assign(window.Jjim = window.Jjim || {}, { forgetLayout, post, getState, saveLayout });
})();
