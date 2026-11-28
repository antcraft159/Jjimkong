(() => {
'use strict';
const { SeatGeometry, LayoutDraft, CELL_W, CELL_H, FAN_ANGLE, ROUND_ANGLE, MIN_ANGLE, MAX_ANGLE, MAX_ROWS, MAX_COLS, floorName, normalizeKind, normalizeShape, kindName, ITEMS, t, tm, LANGS, LANG, setLang, translatePage, withLang, formatDate, isItemKind, MAX_WALL_POINTS, parseCode, memberUrlFromParams, pickLink, buildInvite, buildShareText, fingerprint, TEMPLATE_COPY_URL, DEMO_URL, post, getState, saveLayout: postLayout, forgetLayout } = window.Jjim;
const REFRESH_MS = 20000;
const ADMIN_REFRESH_MS = 4000;
const STORE_KEY = 'jjimkong.v1';
const HALF_DIAGONAL = 40;
const STAGE_VISIBLE = 40;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;

const $ = id => document.getElementById(id);
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ───────────── 저장 ─────────────

const PERSON_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function loadStore() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { data = {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  if (typeof data.personId !== 'string' || !PERSON_PATTERN.test(data.personId)) data.personId = randomId();
  if (typeof data.name !== 'string') data.name = '';
  if (!data.pins || typeof data.pins !== 'object') data.pins = {};
  if (!data.kept || typeof data.kept !== 'object') data.kept = {};
  if (!data.persons || typeof data.persons !== 'object' || Array.isArray(data.persons)) data.persons = {};
  for (const url of Object.keys(data.persons)) if (!PERSON_PATTERN.test(String(data.persons[url]))) delete data.persons[url];
  if (!data.conn || typeof data.conn.url !== 'string') data.conn = null;
  return data;
}

const store = loadStore();

function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 개인 창 등 */ }
}
saveStore();

// ───────────── 상태 ─────────────

let lastState = null;
let seats = [];
let items = [];
let walls = new Map();
let floors = [];
let viewFloorId = 0;
let viewFloorChosen = false;
let busy = false;
let refreshSeq = 0;
let messageFromRefresh = false;
let draft = null;
let tool = 'chair';
let connFingerprint = '';

const isConnected = () => !!store.conn;
const idFor = url => (url && store.persons[url]) || store.personId;
const myId = () => idFor(store.conn && store.conn.url);
const isAdmin = () => !!(store.conn && store.conn.adminKey && lastState && lastState.admin);
const editing = () => draft !== null;

function setBusy(value) {
  busy = value;
  if (value) refreshSeq++;
  document.body.classList.toggle('busy', value);
  ['connectButton', 'refreshButton', 'editLayoutButton', 'nextSessionButton', 'saveLayoutButton', 'cancelEditButton',
    'publishedToggle', 'showNamesToggle', 'maxMinus', 'maxPlus'].forEach(id => { $(id).disabled = value; });
  $('editorPanel').querySelectorAll('button').forEach(b => { b.disabled = value; });
  updateConnectButton();
}

function needsName() {
  if ($('nameInput').value.trim()) return false;
  const raw = $('codeInput').value;
  const link = parseCode(raw);
  return !!link && !link.adminKey && link.url !== DEMO_URL && !readOwnKey(pickLink(raw)).key;
}

function updateConnectButton() {
  $('connectButton').disabled = busy || needsName();
}

// ───────────── 알림 ─────────────

let toastTimer = 0;

function say(text, fromRefresh = false) {
  messageFromRefresh = fromRefresh && !!text;
  const target = isConnected() ? null : $('connectMessage');

  if (target) {
    target.textContent = text || '';
    target.hidden = !text;
    return;
  }

  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.textContent = text || '';
  toast.hidden = !text;
  if (text && !/…$/.test(text)) toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function noticeBox(title, text) {
  const dialog = $('noticeDialog');
  if (typeof dialog.showModal !== 'function') {
    window.alert(title + '\n\n' + text);
    return Promise.resolve();
  }
  $('noticeTitle').textContent = title;
  $('noticeText').textContent = text;
  if (!dialog.open) dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
}

function confirmBox(title, text) {
  const dialog = $('confirmDialog');
  if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(title + '\n\n' + text));
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
  });
}

// ───────────── 연결 ─────────────

async function connect() {
  if (busy) return;
  const link = parseCode($('codeInput').value);

  if (!link) {
    say(t('연결 코드를 읽지 못했어요. 관리자가 준 링크나 https://script.google.com/… 주소를 그대로 붙여 넣어 주세요.'));
    return;
  }

  if (needsName()) {
    say(t('이름을 적어 주세요.'));
    $('nameInput').focus();
    return;
  }

  const own = readOwnKey(pickLink($('codeInput').value));
  if (own.key) store.persons[link.url] = own.key;
  if (own.name && !$('nameInput').value.trim()) $('nameInput').value = own.name;
  store.name = $('nameInput').value.trim();
  saveStore();

  const candidate = { url: link.url, adminKey: link.adminKey, room: '' };
  setBusy(true);
  say(t('연결하는 중…'));
  const state = await getState(candidate, idFor(candidate.url));
  setBusy(false);

  if (!state.ok) {
    say(tm(state.message) || t('연결하지 못했어요.'));
    return;
  }

  if (link.adminKey && !state.admin) {
    say(t('관리자 키가 맞지 않아요. 시트에서 관리자 QR 을 다시 열어 주세요(키를 새로 만들었을 수 있어요).'));
    return;
  }

  candidate.room = state.room || '';
  say('');
  store.conn = candidate;
  saveStore();
  window.Jjim.countUse(candidate.url, !!link.adminKey);
  $('codeInput').value = '';
  $('codeCheck').hidden = true;
  say('');
  await onConnectionChanged();
  applyState(state);
  startTimer();
}

async function disconnect() {
  if (!store.conn) return;
  const hasMine = seats.some(seat => seat.state === 'mine');
  const text = hasMine
    ? t('연결을 끊어도 찜해 둔 자리는 그대로 남아요. 이 브라우저에서 같은 코드로 다시 연결하면 내 자리로 보여요. 끊을까요?')
    : t('좌석 예약 연결을 끊을까요? 같은 코드로 언제든 다시 연결할 수 있어요.');
  if (!await confirmBox(t('연결 끊기'), text)) return;
  await dropConnection();
}

async function dropConnection() {
  store.conn = null;
  saveStore();
  forgetLayout();
  lastState = null;
  seats = [];
  floors = [];
  draft = null;
  pendingMax = null;
  viewFloorChosen = false;
  setBusy(false);
  stopTimer();
  $('toast').hidden = true;
  $('connectMessage').hidden = true;
  await onConnectionChanged();
}

async function onConnectionChanged() {
  goneCount = 0;
  connFingerprint = store.conn && store.conn.url !== DEMO_URL ? await fingerprint(store.conn.url) : '';
  render();
}

function acceptInvite(memberUrl) {
  if (!store.conn) {
    $('codeInput').value = memberUrl;
    updateCodeCheck();
    say(t('초대 링크로 들어왔어요. 이름을 적고 [연결] 을 눌러 주세요.'));
    if (!$('nameInput').value) $('nameInput').focus();
    return;
  }

  if (store.conn.url === memberUrl) {
    say(t('이미 이 좌석 예약에 연결돼 있어요.'));
    return;
  }

  say(t('다른 좌석 예약에 연결돼 있어요. 초대받은 곳으로 바꾸려면 [연결 끊기] 를 누른 뒤 연결해 주세요(코드는 넣어 둘게요).'));
  $('codeInput').value = memberUrl;
  updateCodeCheck();
}

async function readHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return;

  if (/(^|&)s=/.test(hash)) {
    const url = memberUrlFromParams(hash);
    const own = readOwnKey('#' + hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!url) say(t('초대 링크를 읽지 못했어요. 링크가 잘렸을 수 있어요. 관리자에게 다시 받아 주세요.'));
    else if (own.key) await acceptMyLink(url, own.key, own.name);
    else acceptInvite(url);
  }
}

function readOwnKey(text) {
  const key = /[#&]k=([A-Za-z0-9-]{8,64})(?=&|$)/.exec(text);
  const name = /[#&]n=([^&]*)/.exec(text);
  let decoded = '';
  try { decoded = name ? decodeURIComponent(name[1]).trim().slice(0, 20) : ''; } catch (e) { decoded = ''; }
  return { key: key ? key[1] : '', name: decoded };
}

const OWN_LINK_DONE = t('내 자리 링크로 들어왔어요. 찜해 둔 자리가 내 자리로 보여요.');

async function acceptMyLink(url, key, name) {
  if (store.conn && store.conn.url !== url) {
    if (!await confirmBox(t('내 자리 링크'), t('지금 다른 좌석 예약에 연결돼 있어요. 링크의 좌석 예약으로 바꿀까요?'))) return;
    await dropConnection();
  }

  if (!store.conn) {
    if (name) store.name = name;
    saveStore();
    $('nameInput').value = store.name;
    $('codeInput').value = url;
    await connect();
    if (!store.conn || store.conn.url !== url) return;
  }

  if (await adoptPerson(key, name, OWN_LINK_DONE)) markKept(url);
}

async function adoptPerson(personId, name, doneText) {
  const conn = store.conn;
  if (!conn) return false;
  if (personId !== idFor(conn.url)) {
    if (!lastState) await refresh(true);
    if (conn !== store.conn) return false;
    const hasMine = seats.some(seat => seat.state === 'mine');
    if (hasMine && !await confirmBox(t('내 자리 되찾기'),
      t('이 브라우저에서 새로 찜한 자리는 더 이상 내 자리로 보이지 않아요(남아 있으면 관리자가 취소할 수 있어요). 바꿀까요?'))) return false;
    if (conn !== store.conn) return false;
    store.persons[conn.url] = personId;
  }
  if (name) {
    store.name = name;
    $('myNameInput').value = name;
  }
  saveStore();
  await refresh(false);
  say(doneText);
  return true;
}

async function updateCodeCheck() {
  const link = parseCode($('codeInput').value);
  const code = link && link.url !== DEMO_URL ? await fingerprint(link.url) : '';
  updateConnectButton();
  $('codeFingerprint').textContent = code;
  $('codeCheck').hidden = !code;
}

// ───────────── 불러오기 ─────────────

let timer = 0;

function startTimer() {
  stopTimer();
  const every = store.conn && store.conn.adminKey ? ADMIN_REFRESH_MS : REFRESH_MS;
  timer = setInterval(() => { if (!document.hidden && !refreshing) refresh(true); }, every);
}

function stopTimer() {
  clearInterval(timer);
  timer = 0;
}

const GONE_LIMIT = 3;
const ADMIN_GONE_LIMIT = 10;
const GONE_MIN_MS = 120000;
let goneCount = 0;
let goneSince = 0;

async function dropGoneConnection() {
  goneCount = 0;
  const admin = !!(store.conn && store.conn.adminKey);
  await dropConnection();
  if (admin) {
    say(t('좌석 예약 시트에 닿지 않아 연결을 끊었어요. 시트가 살아 있다면 관리자용 글로 다시 연결해 주세요.'));
    await noticeBox(t('좌석 예약이 닫혔어요'), t('좌석 예약 시트가 지워졌거나 웹 앱 배포가 닫힌 것 같아요. 연결을 끊었어요. 시트가 살아 있다면 시트의 [2. 연결 QR 보기] 에 있는 관리자용 글로 다시 연결해 주세요.'));
    return;
  }
  say(t('좌석 예약이 닫혀 연결을 끊었어요. 관리자에게 받은 초대 링크를 다시 확인하고 들어와 주세요.'));
  await noticeBox(t('좌석 예약이 닫혔어요'), t('관리자가 좌석 예약 시트를 지웠거나 닫은 것 같아요. 연결을 끊었어요. 관리자에게 받은 초대 링크(연결 코드)가 맞는지 다시 확인하고 들어와 주세요.'));
}

let refreshing = false;

async function refresh(quiet) {
  if (!store.conn || busy || editing()) return;
  if (!quiet) setBusy(true);
  const sequence = ++refreshSeq;
  const conn = store.conn;
  refreshing = true;
  let state;
  try {
    state = await getState(conn, idFor(conn.url));
  } finally {
    refreshing = false;
  }
  if (!quiet) setBusy(false);

  if (sequence !== refreshSeq || conn !== store.conn || editing()) return;

  if (!state.ok) {
    if (state.error === 'gone') {
      if (!goneCount) goneSince = Date.now();
      goneCount++;
    } else {
      goneCount = 0;
    }
    if (goneCount >= (conn.adminKey ? ADMIN_GONE_LIMIT : GONE_LIMIT) && Date.now() - goneSince >= GONE_MIN_MS) {
      await dropGoneConnection();
      return;
    }
    say(tm(state.message) || '', true);
    return;
  }

  goneCount = 0;
  if (messageFromRefresh) say('');
  applyState(state);
}

function applyState(state) {
  if (pendingMax !== null) state.maxPerPerson = pendingMax;
  lastState = state;

  if (store.conn && store.conn.room !== state.room) {
    store.conn.room = state.room || '';
    saveStore();
  }

  const takenById = new Map(state.taken.map(item => [item.seat, item]));
  seats = state.seats.map(seat => {
    const reservation = takenById.get(seat.id);
    let stateName = 'free';
    let name = '';
    if (seat.blocked && !(reservation && (reservation.mine || state.admin))) stateName = 'blocked';
    else if (reservation) {
      stateName = reservation.mine ? 'mine' : 'taken';
      name = reservation.name || '';
    }
    return {
      id: seat.id, r: seat.r | 0, c: seat.c | 0, f: seat.f | 0, label: String(seat.label || seat.id),
      kind: normalizeKind(seat.kind), bench: seat.bench || '', state: stateName, name
    };
  });

  items = (state.items || [])
    .filter(item => item && isItemKind(item.kind) && item.kind !== 'pulpit' && Number.isFinite(item.x) && Number.isFinite(item.y))
    .map(item => ({ f: item.f | 0, kind: item.kind, x: item.x, y: item.y, a: item.a || 0 }));
  walls = new Map((state.walls || [])
    .filter(wall => wall && Array.isArray(wall.points) && wall.points.length >= 3)
    .map(wall => [wall.f | 0, wall.points]));

  const known = new Map();
  for (const floor of state.floors) {
    const id = floor.f | 0;
    if (id >= 0 && !known.has(id)) known.set(id, { f: id, shape: normalizeShape(floor.shape), angle: floor.angle | 0, rows: floor.rows | 0, cols: floor.cols | 0, stage: ['rows', 'none', 'custom'].includes(floor.stage) ? floor.stage : 'full', sl: floor.sl | 0, sr: floor.sr | 0 });
  }
  for (const id of [...new Set(seats.map(seat => seat.f))].sort((a, b) => a - b)) {
    if (!known.has(id)) known.set(id, { f: id, shape: 'grid', angle: 0, rows: 0, cols: 0 });
  }
  floors = [...known.values()];
  if (floors.length === 0) floors.push({ f: 0, shape: 'grid', angle: 0, rows: 0, cols: 0 });

  if (!viewFloorChosen && seats.length > 0) {
    viewFloorChosen = true;
    const mine = seats.find(seat => seat.state === 'mine');
    const filled = floors.find(floor => seats.some(seat => seat.f === floor.f));
    viewFloorId = mine ? mine.f : (filled || floors[0]).f;
  }
  if (!floors.some(floor => floor.f === viewFloorId)) viewFloorId = floors[0].f;

  render();
}

function statusText(state) {
  if (!state.published) {
    return state.admin
      ? t('공개 전이에요. 유저에게는 아직 좌석표가 보이지 않아요.')
      : t('아직 예약을 받지 않아요. 관리자가 좌석표를 열면 여기에 보여요.');
  }

  if (!state.isOpen) {
    const opens = formatTime(state.opensAt);
    const closes = formatTime(state.closesAt);
    if (opens && closes) return t('지금은 예약 시간이 아니에요({opens} ~ {closes}).', { opens, closes });
    return opens ? t('{opens}부터 예약할 수 있어요.', { opens }) : t('예약이 마감됐어요.');
  }

  return state.maxPerPerson > 1
    ? t('빈자리를 누르면 찜! 한 사람이 {n}자리까지 잡을 수 있어요.', { n: state.maxPerPerson })
    : t('빈자리를 누르면 찜! 다른 빈자리를 누르면 그리로 옮겨요.');
}

function floorLabel(position) {
  return t('{n}층', { n: position + 1 });
}

function formatTime(iso) {
  if (!iso) return '';
  const time = new Date(iso);
  if (isNaN(time.getTime())) return '';
  return formatDate(time);
}

// ───────────── 이름 ─────────────

function adoptServerName(response) {
  const name = response && typeof response.name === 'string' ? response.name.trim() : '';
  if (!name || name === store.name) return '';
  store.name = name;
  saveStore();
  $('myNameInput').value = name;
  return name;
}

function sameNameNote(name) {
  return name ? ' ' + t("같은 이름이 있어서 '{name}'(으)로 적었어요.", { name }) : '';
}

async function commitName() {
  const conn = store.conn;
  if (!conn) return true;
  const name = $('myNameInput').value.trim();
  if (name === store.name) return true;

  if (name && (seats.some(seat => seat.state === 'mine') || store.pins[conn.url])) {
    const response = await post(conn, idFor(conn.url), 'rename', { name });
    if (conn !== store.conn) return false;
    if (!response.ok) {
      say(t('이름을 바꾸지 못했어요.') + ' ' + (tm(response.message) || ''));
      return false;
    }
    store.name = name;
    if (response.pinCleared && store.pins[conn.url]) {
      delete store.pins[conn.url];
      store.kept[conn.url] = true;
    }
    saveStore();
    say(t('이름을 바꿨어요.') + sameNameNote(adoptServerName(response)) +
      (response.pinCleared ? ' ' + t('비밀번호는 옛 이름에 묶여 있어 지웠어요. 새 이름으로 비밀번호를 다시 정해 주세요.') : ''));
    await refresh(true);
    return true;
  }

  store.name = name;
  saveStore();
  return true;
}

// ───────────── 자리 누르기 ─────────────

async function tapSeat(seat) {
  if (!store.conn || busy || editing()) return;

  if (seat.state === 'blocked') {
    say(t('앉을 수 없는 자리예요.'));
    return;
  }

  if (seat.state === 'mine') {
    await cancelMine(seat);
    return;
  }

  if (seat.state === 'taken') {
    if (isAdmin()) await forceCancel(seat);
    else say(seat.name ? t('{seat} 은(는) {name} 님 자리예요.', { seat: seat.label, name: seat.name }) : t('{seat} 은(는) 이미 찜한 자리예요.', { seat: seat.label }));
    return;
  }

  await reserveOrMove(seat);
}

async function reserveOrMove(seat) {
  const conn = store.conn;

  if (!$('myNameInput').value.trim()) {
    say(t('위의 이름 칸에 이름을 먼저 적어 주세요.'));
    $('myNameInput').focus();
    return;
  }

  setBusy(true);

  if (!await commitName() || conn !== store.conn) {
    setBusy(false);
    return;
  }

  const max = lastState ? lastState.maxPerPerson : 1;
  const mine = seats.filter(item => item.state === 'mine');
  const isMove = mine.length > 0 && mine.length >= max && max === 1;

  say(isMove ? t('{from} → {seat} 로 옮기는 중…', { from: mine[0].label, seat: seat.label }) : t('{seat} 찜하는 중…', { seat: seat.label }));

  const response = isMove
    ? await post(conn, idFor(conn.url), 'move', { name: store.name, from: mine[0].id, seat: seat.id })
    : await post(conn, idFor(conn.url), 'reserve', { name: store.name, seat: seat.id });

  setBusy(false);
  if (conn !== store.conn) return;

  say(response.ok
    ? (isMove ? t('{seat} 로 옮겼어요.', { seat: seat.label }) : t('{seat} 찜콩! 자리를 잡았어요.', { seat: seat.label })) + sameNameNote(adoptServerName(response))
    : tm(response.message) || '');
  await refresh(true);
}

async function cancelMine(seat) {
  if (!await confirmBox(t('찜 취소'), t('{seat} 예약을 취소할까요?', { seat: seat.label }))) return;
  const conn = store.conn;
  if (!conn || busy) return;
  setBusy(true);
  const response = await post(conn, idFor(conn.url), 'cancel', { seat: seat.id });
  setBusy(false);
  if (conn !== store.conn) return;
  say(response.ok ? t('{seat} 예약을 취소했어요.', { seat: seat.label }) : tm(response.message) || '');
  await refresh(true);
}

async function forceCancel(seat) {
  const question = seat.name
    ? t('{name} 님의 {seat} 예약을 관리자 권한으로 취소할까요?', { name: seat.name, seat: seat.label })
    : t('{seat} 예약을 관리자 권한으로 취소할까요?', { seat: seat.label });
  if (!await confirmBox(t('관리자 취소'), question)) return;
  const conn = store.conn;
  if (!conn || busy) return;
  setBusy(true);
  const extra = { seat: seat.id };
  if (seat.name) extra.name = seat.name;
  const response = await post(conn, idFor(conn.url), 'forceCancel', extra);
  setBusy(false);
  if (conn !== store.conn) return;
  say(response.ok ? t('{seat} 예약을 취소했어요.', { seat: seat.label }) : tm(response.message) || '');
  await refresh(true);
}

// ───────────── 관리자: 설정 ─────────────

let settingsQueue = Promise.resolve();

function saveSettings(settings) {
  const run = settingsQueue.then(() => sendSettings(settings));
  settingsQueue = run.catch(() => {});
  return run;
}

async function sendSettings(settings) {
  const conn = store.conn;
  if (!conn || !isAdmin()) return;

  if (settings.published === true && seats.length === 0) {
    $('publishedToggle').checked = false;
    say(t('배치도를 먼저 만들어 저장해 주세요.'));
    return;
  }

  refreshSeq++;
  const response = await post(conn, idFor(conn.url), 'saveSettings', { settings });
  refreshSeq++;
  if (conn !== store.conn) return;

  if (!response.ok) {
    say(tm(response.message) || '');
  } else if (settings.published !== undefined) {
    say(settings.published ? t('공개했어요. 이제 유저가 찜할 수 있어요.') : t('공개를 멈췄어요.'));
    if (lastState) {
      lastState.published = settings.published;
      $('statusText').textContent = statusText(lastState);
    }
  }

  await refresh(true);
}

let pendingMax = null;

async function changeMax(delta) {
  if (!lastState) return;
  const current = pendingMax !== null ? pendingMax : lastState.maxPerPerson;
  const next = clamp(current + delta, 1, 20);
  if (next === current) return;
  pendingMax = next;
  lastState.maxPerPerson = next;
  $('maxValue').textContent = next;
  try {
    await saveSettings({ maxPerPerson: next });
  } finally {
    if (pendingMax === next) pendingMax = null;
  }
}

async function nextSession() {
  if (!store.conn || !isAdmin()) return;
  const count = seats.filter(seat => seat.state === 'taken' || seat.state === 'mine').length;
  if (!await confirmBox(t('다음 회차로'), t('지금 예약 {n}자리를 \'지난 예약\' 탭으로 옮기고 좌석표를 비워요. 배치도와 공개 상태는 그대로예요. 할까요?', { n: count }))) return;
  setBusy(true);
  const response = await post(store.conn, myId(), 'nextSession');
  setBusy(false);
  say(response.ok ? t('다음 회차로 넘겼어요.') : tm(response.message) || '');
  await refresh(true);
}

function inviteLink() {
  return store.conn ? buildInvite(store.conn.url) : null;
}

async function copyInvite() {
  const link = inviteLink();
  if (!link) {
    say(store.conn && store.conn.url === DEMO_URL ? t('체험 모드에서는 초대 링크를 만들 수 없어요.') : t('이 연결 주소로는 초대 링크를 만들 수 없어요.'));
    return;
  }

  await copyText(buildShareText(link, lastState ? lastState.room : '', connFingerprint), t('초대 글을 복사했어요. 카톡 단체방에 붙여 넣으세요.'));
}

async function copyText(text, doneText) {
  try {
    await navigator.clipboard.writeText(text);
    say(doneText);
    return true;
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    say(ok ? doneText : t('복사하지 못했어요. 다시 눌러 주세요.'));
    return !!ok;
  }
}

// ───────────── 내 자리 지키기 ─────────────

function myLink() {
  const invite = inviteLink();
  if (!invite) return null;
  return invite + '&k=' + myId() + (store.name ? '&n=' + encodeURIComponent(store.name) : '');
}

async function copyMyLink() {
  const link = myLink();
  if (!link) {
    say(store.conn && store.conn.url === DEMO_URL ? t('체험 모드에서는 내 자리 링크를 만들 수 없어요.') : t('이 연결 주소로는 내 자리 링크를 만들 수 없어요.'));
    return;
  }
  const room = String(lastState ? lastState.room : '').trim();
  const text = `[${room ? room + ' ' : ''}${t('내 자리 링크')}]\n${t('나만 갖고 계세요. 이 링크를 누르면 어느 기기에서든 내가 찜한 자리로 들어가요.')}\n${link}`;
  const conn = store.conn;
  let done = false;

  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      say(t("내 자리 링크를 보냈어요. '나와의 채팅'에 잘 들어갔는지 한 번 봐 주세요."));
      done = true;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }

  if (!done) done = await copyText(text, t("내 자리 링크를 복사했어요. 카톡 '나와의 채팅'이나 메모에 붙여 두세요."));
  if (done && conn === store.conn) markKept(conn.url);
}

function markKept(url) {
  if (store.kept[url]) return;
  store.kept[url] = true;
  saveStore();
  render();
}

function needsKeepGate() {
  return !!store.conn && !store.conn.adminKey && !store.kept[store.conn.url] && !store.pins[store.conn.url];
}

let pinMode = 'set';

function openPinDialog(mode) {
  pinMode = mode;
  const setting = mode === 'set';
  $('pinTitle').textContent = setting ? (hasPin() ? t('비밀번호 바꾸기') : t('비밀번호 정하기')) : t('내 자리 되찾기');
  $('pinText').textContent = setting
    ? t('기록을 지우거나 기기를 바꿨을 때 이 이름과 비밀번호로 내 자리를 되찾아요. 생일처럼 남이 짐작하기 쉬운 번호는 피해 주세요.')
    : t('비밀번호를 정할 때 쓴 이름과 비밀번호를 넣으세요. 그때 찜한 자리가 다시 내 자리로 보여요.');
  $('pinNameInput').value = store.name;
  $('pinInput').value = '';
  showPinMessage('');
  $('pinOkButton').disabled = false;
  $('pinDialog').showModal();
  ($('pinNameInput').value ? $('pinInput') : $('pinNameInput')).focus();
}

function showPinMessage(text) {
  $('pinMessage').textContent = text;
  $('pinMessage').hidden = !text;
}

function hasPin() {
  return !!(store.conn && store.pins[store.conn.url]);
}

async function submitPin(event) {
  if (event.submitter && event.submitter.value !== 'yes') return;
  event.preventDefault();
  if (!store.conn || $('pinOkButton').disabled) return;

  const name = $('pinNameInput').value.trim();
  const pin = $('pinInput').value.trim();
  if (!name) return showPinMessage(t('이름을 적어 주세요.'));
  if (!/^\d{4}$/.test(pin)) return showPinMessage(t('비밀번호는 숫자 4자리로 적어 주세요.'));

  const conn = store.conn;
  $('pinOkButton').disabled = true;
  showPinMessage(t('보내는 중…'));
  const response = await post(conn, idFor(conn.url), pinMode === 'set' ? 'setPin' : 'reclaim', { name, pin });
  $('pinOkButton').disabled = false;

  if (!response.ok) {
    showPinMessage(response.error === 'bad-action'
      ? t('이 좌석 예약 시트가 아직 옛 판이라 비밀번호를 쓸 수 없어요. 관리자에게 시트를 새 판으로 배포해 달라고 해 주세요.')
      : tm(response.message) || t('되지 않았어요. 다시 해 주세요.'));
    return;
  }
  if (pinMode === 'reclaim' && !PERSON_PATTERN.test(String(response.device || ''))) {
    showPinMessage(t('답을 읽지 못했어요. 다시 해 주세요.'));
    return;
  }

  $('pinDialog').close();

  if (pinMode === 'set') {
    const before = store.name;
    store.pins[conn.url] = true;
    store.name = typeof response.name === 'string' && response.name.trim() ? response.name.trim() : name;
    saveStore();
    if (store.name !== before && seats.some(seat => seat.state === 'mine')) {
      await post(conn, idFor(conn.url), 'rename', { name: store.name });
      if (conn === store.conn) refresh(true);
    }
    $('myNameInput').value = store.name;
    render();
    say(store.name !== name
      ? t("같은 이름이 있어서 '{name}'(으)로 정했어요. 되찾을 때도 이 이름과 비밀번호로 적어 주세요.", { name: store.name })
      : t('비밀번호를 정했어요. 이름과 함께 꼭 기억해 두세요. 이제 자리를 찜하세요!'));
    return;
  }

  await adoptPerson(response.device, name, t('내 자리를 되찾았어요.'));
  if (idFor(conn.url) === response.device && store.conn === conn) {
    store.pins[conn.url] = true;
    saveStore();
    render();
  }
}

function showQr() {
  const link = inviteLink();
  if (!link) {
    say(store.conn && store.conn.url === DEMO_URL ? t('체험 모드에서는 초대 QR 을 만들 수 없어요.') : t('이 연결 주소로는 초대 QR 을 만들 수 없어요.'));
    return;
  }
  if (typeof window.QRCode !== 'function') {
    say(t('QR 그리기를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'));
    return;
  }
  const box = $('qrBox');
  box.textContent = '';
  new window.QRCode(box, { text: link, width: 240, height: 240, correctLevel: window.QRCode.CorrectLevel.M });
  $('qrFingerprint').textContent = connFingerprint;
  $('qrLink').textContent = link;
  $('qrDialog').showModal();
}

// ───────────── 관리자: 배치도 그리기 ─────────────

function beginEdit() {
  if (!isAdmin() || !lastState || busy) return;
  draft = LayoutDraft.fromSeats(lastState.seats, lastState.floors, lastState.items, lastState.walls);
  selectedItem = -1;
  selectedVertex = -1;
  const position = draft.toFloors().findIndex(floor => floor.f === viewFloorId);
  draft.selectFloor(Math.max(position, 0));
  tool = 'chair';
  $('panToggle').checked = false;
  say(draft.seatCount === 0
    ? t('도구를 고르고 칸을 누르거나 끌어서 의자를 그리세요. 장의자는 한 줄로 끌면 한 덩어리가 돼요.')
    : t('도구를 고르고 칸을 누르거나 끌어서 고치세요. 다 되면 [저장].'));
  render();
}

async function cancelEdit() {
  if (busy) return;
  draft = null;
  say('');
  render();
  await refresh(true);
}

function applyTool(row1, col1, row2, col2) {
  if (!draft || busy) return;
  const error = draft.apply(tool, row1, col1, row2, col2);
  if (error) say(error);
  render();
}

async function resizeDraft(deltaRows, deltaCols) {
  if (!draft || busy) return;
  const rows = clamp(draft.rows + deltaRows, 1, MAX_ROWS);
  const cols = clamp(draft.cols + deltaCols, 1, MAX_COLS);
  const lost = draft.countOutside(rows, cols);
  if (lost > 0 && !await confirmBox(t('판 줄이기'), t('판 밖으로 나가는 의자 {n}개가 지워져요. 줄일까요?', { n: lost }))) return;
  draft.resize(rows, cols);
  render();
}

function shapePreset(shape, angle) {
  return normalizeShape(shape) === 'grid' ? 'grid' : angle >= 300 ? 'round' : 'fan';
}

async function changeShape(shape, angle) {
  const lost = draft.countLostByShape(shape, angle);
  if (lost > 0 && !await confirmBox(t('모양 바꾸기'), t('새 모양에 들어가지 않는 의자 {n}개가 지워져요. 바꿀까요?', { n: lost }))) {
    render();
    return;
  }
  draft.setShape(shape, angle);
  if (tool === 'stage' && draft.shape === 'arc') tool = 'chair';
  render();
}

async function setShapePreset(preset) {
  if (!draft || busy) return;
  const [shape, angle] = preset === 'fan' ? ['arc', FAN_ANGLE] : preset === 'round' ? ['arc', ROUND_ANGLE] : ['grid', 0];
  if (shapePreset(draft.shape, draft.angle) === preset) return;
  await changeShape(shape, angle);
}

function setStageWidth(stage) {
  if (!draft || busy || draft.cur.stage === stage) return;
  draft.cur.stage = stage;
  render();
}

async function changeAngle(delta) {
  if (!draft || busy || draft.shape !== 'arc') return;
  const angle = clamp(draft.angle + delta, MIN_ANGLE, MAX_ANGLE);
  if (angle !== draft.angle) await changeShape('arc', angle);
}

function addFloor() {
  if (!draft || busy) return;
  const error = draft.addFloor();
  if (!error) afterFloorChange();
  say(error || t('{floor}을 더했어요. 모양을 고르고 의자를 그리세요.', { floor: floorLabel(draft.current) }));
  render();
}

async function removeFloor() {
  if (!draft || busy || draft.floorCount <= 1) return;
  const name = floorLabel(draft.current);
  const floor = draft.cur;
  if (draft.currentFloorSeatCount > 0) {
    if (!await confirmBox(t('층 지우기'), t('{floor}의 의자 {n}개가 함께 지워져요. 지울까요?', { floor: name, n: draft.currentFloorSeatCount }))) return;
  } else if (floor.items.length > 0 || floor.outline) {
    if (!await confirmBox(t('층 지우기'), t('{floor}에 그린 외벽 · 물건도 함께 지워져요. 지울까요?', { floor: name }))) return;
  }
  if (!draft || draft.cur !== floor) return;
  draft.removeCurrentFloor();
  afterFloorChange();
  say(t('{floor}을 지웠어요. [저장] 해야 반영돼요.', { floor: name }));
  render();
}

async function saveLayoutNow() {
  if (!store.conn || !isAdmin() || !draft || busy) return;
  const newSeats = draft.toSeats();

  if (newSeats.length === 0) {
    say(t('의자를 하나 이상 그려 주세요.'));
    return;
  }

  const conn = store.conn;
  setBusy(true);
  const fresh = await getState(conn, idFor(conn.url));
  setBusy(false);
  if (conn !== store.conn || !draft) return;
  const taken = fresh.ok && Array.isArray(fresh.taken) ? fresh.taken : lastState ? lastState.taken : [];
  if (taken.length > 0) {
    const kept = new Set(newSeats.filter(seat => !seat.blocked).map(seat => seat.id));
    const lost = taken.filter(item => !kept.has(item.seat)).length;
    if (lost > 0 && !await confirmBox(t('배치도 저장'), t('지우거나 비워 두는 자리에 예약이 {n}개 있어요. 저장하면 그 예약은 취소돼요(기록 탭에 남아요). 저장할까요?', { n: lost }))) return;
  }

  const newItems = draft.toItems();
  const newWalls = draft.toWalls();
  if ((newItems.length > 0 || newWalls.length > 0) && lastState && !lastState.itemsSupported &&
    !await confirmBox(t('배치도 저장'), t('이 좌석 예약 시트가 옛 판이라 외벽 · 물건은 저장되지 않아요(관리자 사용법의 새 판 배포를 해 주세요). 의자만 저장할까요?'))) return;

  setBusy(true);
  say(t('배치도 저장하는 중…'));
  const newFloors = draft.toFloors();
  const response = await postLayout(conn, idFor(conn.url), newSeats, newFloors, newItems, newWalls);
  setBusy(false);
  if (conn !== store.conn || !draft) return;

  if (!response.ok) {
    say(tm(response.message) || '');
    return;
  }

  viewFloorId = newFloors[clamp(draft.current, 0, newFloors.length - 1)].f;
  viewFloorChosen = true;
  draft = null;
  say(lastState && lastState.published ? t('배치도를 저장했어요.') : t('배치도를 저장했어요. 다 됐으면 [공개] 를 켜 주세요.'));
  render();
  await refresh(false);
}

// ───────────── 그리기 ─────────────

let geometry = null;
let offsetX = 0;
let offsetY = 0;
let builtKey = '';
let seatButtons = new Map();
let editorCells = new Map();
let zoom = 1;

function render() {
  const connected = isConnected();
  $('connectView').hidden = connected;
  $('seatView').hidden = !connected;
  $('roomLine').hidden = !connected;
  $('topbarSep').hidden = !connected;
  $('topbarActions').hidden = !connected;

  if (!connected) {
    $('nameInput').value = $('nameInput').value || store.name;
    clearBoard();
    return;
  }

  const admin = isAdmin();
  const state = lastState;
  $('roomName').textContent = (state && state.room) || store.conn.room || t('좌석 예약');
  $('adminBadge').hidden = !admin;
  $('connFingerprint').textContent = connFingerprint || '—';
  if (document.activeElement !== $('myNameInput')) $('myNameInput').value = store.name;

  const open = seats.filter(seat => seat.state !== 'blocked').length;
  const reserved = seats.filter(seat => seat.state === 'taken' || seat.state === 'mine').length;
  const mine = seats.filter(seat => seat.state === 'mine').map(seat => seat.label);
  const percent = open ? Math.round(reserved / open * 100) : 0;
  $('statTotal').textContent = open;
  $('statReserved').textContent = reserved;
  $('statFree').textContent = open - reserved;
  $('statMine').textContent = mine.length ? mine.join(', ') : '—';
  $('statMeter').style.width = percent + '%';
  $('reservedCount').textContent = open ? t('{n}% 찼어요', { n: percent }) : '';

  const phase = !state ? 'loading' : !state.published ? 'off' : state.isOpen ? 'on' : 'closed';
  $('statusChip').textContent = { loading: t('불러오는 중'), off: t('공개 전'), on: t('예약 중'), closed: t('예약 시간 아님') }[phase];
  $('statusChip').className = 'chip ' + phase;

  let mineText = '';
  if (state) {
    const shown = new Set(seats.map(seat => seat.id));
    const ghosts = state.taken.filter(item => item.mine && !shown.has(item.seat)).length;
    if (ghosts > 0) {
      const ghostText = t('배치도에 없는 자리의 내 예약 {n}개 — 관리자가 배치도를 한 번 저장하면 정리돼요', { n: ghosts });
      mineText = mineText ? mineText + ' · ' + ghostText : ghostText;
    }
  }
  $('mySeats').textContent = mineText;

  $('statusText').textContent = state ? statusText(state) : t('불러오는 중…');
  $('statusText').hidden = editing();

  $('adminPanel').hidden = !admin;
  if (admin && state) {
    $('publishedToggle').checked = !!state.published;
    $('showNamesToggle').checked = state.showNames !== false;
    $('maxValue').textContent = state.maxPerPerson;
    $('sessionText').textContent = t('{n}회차', { n: state.session || 1 });
  }
  $('adminControls').hidden = editing();
  $('adminActions').hidden = editing();
  $('editorPanel').hidden = !editing();
  $('guideLink').setAttribute('href', withLang(admin ? 'guide.html#admin' : 'guide.html#member'));
  const gate = needsKeepGate();
  $('keepGate').hidden = !gate;
  $('statsRow').hidden = gate;
  $('dashRow').hidden = gate;
  $('pinButton').textContent = hasPin() ? t('비밀번호 바꾸기') : t('비밀번호 정하기');
  $('pinState').textContent = hasPin() ? t('이 기기에서 비밀번호를 정해 뒀어요.') : '';
  $('pinState').hidden = !hasPin();

  if (editing()) syncEditorControls();
  buildFloorPanel();
  buildBoard();
}

function syncEditorControls() {
  $('editorPanel').querySelectorAll('.pill[data-tool]').forEach(pill => pill.setAttribute('aria-checked', String(pill.dataset.tool === tool)));
  const preset = shapePreset(draft.shape, draft.angle);
  $('shapePanel').querySelectorAll('.pill').forEach(pill => pill.setAttribute('aria-checked', String(pill.dataset.shape === preset)));
  const isArc = draft.shape === 'arc';
  $('anglePanel').hidden = !isArc;
  $('stageToolButton').hidden = isArc;
  $('stageToolPanel').hidden = tool !== 'stage' || isArc;
  $('stageToolPanel').querySelectorAll('[data-stage-step]').forEach(button => { button.disabled = draft.cur.stage === 'none'; });
  $('stageNoneButton').hidden = draft.current === 0 && draft.cur.stage !== 'none';
  $('stagePanel').querySelectorAll('.pill').forEach(pill => pill.setAttribute('aria-checked', String(pill.dataset.stage === draft.cur.stage)));
  $('angleValue').textContent = draft.angle + '°';
  $('colsLabel').textContent = isArc ? t('첫 줄 자리') : t('칸');
  const floor = draft.floorCount > 1 ? floorLabel(draft.current) + ' · ' : '';
  $('draftSize').textContent = isArc
    ? floor + t('{rows}줄 · 첫 줄 {cols}자리 · {angle}° · 의자 {n}개', { rows: draft.rows, cols: draft.cols, angle: draft.angle, n: draft.seatCount })
    : floor + t('판 {rows}줄 × {cols}칸 · 의자 {n}개', { rows: draft.rows, cols: draft.cols, n: draft.seatCount });
  $('outlinePanel').hidden = tool !== 'outline';
  $('itemHint').hidden = !isItemKind(tool);
  $('deleteVertexButton').disabled = selectedVertex < 0 || !draft.cur.outline || draft.cur.outline.length <= 3;
}

function afterFloorChange() {
  selectedItem = -1;
  selectedVertex = -1;
  lastVertexTap = null;
  if (tool === 'stage' && draft.shape === 'arc') tool = 'chair';
  if (tool === 'outline' && !draft.cur.outline) tool = 'chair';
}

function chooseTool(next) {
  tool = next;
  selectedItem = -1;
  selectedVertex = -1;
  if (tool === 'outline' && !draft.cur.outline) {
    draft.setOutline(defaultOutline());
    say(t('그려 둔 의자 · 물건을 외벽으로 감쌌어요. 동그라미(꼭짓점)를 끌어 모양을 맞추세요. 변 가운데 작은 점을 끌면 꼭짓점이 늘어요.'));
  }
  render();
}

const WRAP_PADDING = 24;
const WRAP_MAX_POINTS = 16;

function defaultOutline() {
  const geo = draft.geometry;
  const points = contentPoints(geo);

  if (points.length === 0) {
    const box = boundsOf(geo, allSlots(geo), [], 0);
    const pad = 20;
    if (geo.isArc) box.minY = Math.min(box.minY, 0);
    return [[box.minX - pad, box.minY - pad], [box.maxX + pad, box.minY - pad], [box.maxX + pad, box.maxY + pad], [box.minX - pad, box.maxY + pad]];
  }

  const loop = simplifyLoop(convexHull(points), WRAP_MAX_POINTS);
  return fitAround(loop, points, WRAP_PADDING).map(([x, y]) => [Math.round(x), Math.round(y)]);
}

// 줄인 다각형의 변 방향은 그대로 두고, 모든 점이 안쪽 padding 만큼 떨어지게 변마다 바깥으로 민다.
function fitAround(loop, points, padding) {
  if (loop.length < 3) return loop;
  let signed = 0;
  loop.forEach((point, i) => {
    const next = loop[(i + 1) % loop.length];
    signed += point[0] * next[1] - next[0] * point[1];
  });
  const turn = signed > 0 ? 1 : -1;

  const lines = loop.map((point, i) => {
    const next = loop[(i + 1) % loop.length];
    const dx = next[0] - point[0];
    const dy = next[1] - point[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = turn * dy / length;
    const ny = -turn * dx / length;
    let reach = -Infinity;
    for (const [x, y] of points) reach = Math.max(reach, x * nx + y * ny);
    return { nx, ny, c: reach + padding, dx, dy };
  });

  return lines.map((line, i) => {
    const prev = lines[(i + lines.length - 1) % lines.length];
    const det = prev.nx * line.ny - prev.ny * line.nx;
    if (Math.abs(det) < 1e-6) return [loop[i][0] + line.nx * padding, loop[i][1] + line.ny * padding];
    return [(prev.c * line.ny - line.c * prev.ny) / det, (prev.nx * line.c - line.nx * prev.c) / det];
  });
}

function placedSlots() {
  return [...draft.cur.cells.keys()].map(k => {
    const [row, col] = k.split(',').map(Number);
    return { row, col };
  });
}

function contentPoints(geo) {
  const points = frontCorners(frontRect(geo, placedSlots(), draft.cur));
  const halfW = CELL_W / 2 - 3;
  const halfH = CELL_H / 2 - 3;

  for (const k of draft.cur.cells.keys()) {
    const [row, col] = k.split(',').map(Number);
    const { x, y, rotation } = geo.place(row, col);
    const turn = (rotation || 0) * Math.PI / 180;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    for (const [dx, dy] of [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]]) {
      points.push([x + dx * cos - dy * sin, y + dx * sin + dy * cos]);
    }
  }

  for (const item of draft.cur.items) {
    for (const [dx, dy] of [[-30, -12], [30, -12], [30, 12], [-30, 12]]) points.push([item.x + dx, item.y + dy]);
  }

  if (geo.isArc && points.length > 0) {
    const top = isHalfStage(geo) ? 0 : -Infinity;
    const radius = stageRadius(geo);
    for (let step = 0; step < 72; step++) {
      const turn = step * Math.PI / 36;
      const px = Math.sin(turn) * radius;
      const py = Math.cos(turn) * radius;
      if (py >= top) points.push([px, py]);
    }
  }

  return points;
}

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function simplifyLoop(points, limit) {
  const loop = points.slice();
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (loop.length > 3) {
    let smallest = Infinity;
    let at = -1;
    for (let i = 0; i < loop.length; i++) {
      const size = area(loop[(i + loop.length - 1) % loop.length], loop[i], loop[(i + 1) % loop.length]);
      if (size < smallest) {
        smallest = size;
        at = i;
      }
    }
    const crowded = loop.findIndex((point, i) => Math.hypot(point[0] - loop[(i + 1) % loop.length][0], point[1] - loop[(i + 1) % loop.length][1]) < 36);
    if (crowded >= 0) {
      loop.splice(crowded, 1);
      continue;
    }
    if (loop.length <= limit && smallest > 400) break;
    loop.splice(at, 1);
  }
  return loop;
}

function resetOutline() {
  if (!draft || busy) return;
  draft.setOutline(defaultOutline());
  selectedVertex = -1;
  say(t('지금 그려 둔 의자 · 물건을 다시 감쌌어요.'));
  render();
}

function clearOutline() {
  if (!draft || busy) return;
  draft.setOutline(null);
  selectedVertex = -1;
  tool = 'chair';
  say(t('외벽을 없앴어요. [저장] 해야 반영돼요.'));
  render();
}

function deleteSelected() {
  if (!draft || busy) return;
  if (tool === 'outline' && selectedVertex >= 0 && draft.cur.outline && draft.cur.outline.length > 3) {
    draft.cur.outline.splice(selectedVertex, 1);
    selectedVertex = -1;
    render();
  } else if (isItemKind(tool) && selectedItem >= 0) {
    draft.removeItem(selectedItem);
    selectedItem = -1;
    render();
  }
}

function buildFloorPanel() {
  const panel = $('floorPanel');
  panel.textContent = '';

  const addPill = (text, checked, onClick) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.textContent = text;
    pill.setAttribute('aria-checked', String(checked));
    pill.addEventListener('click', onClick);
    panel.appendChild(pill);
    return pill;
  };

  if (editing()) {
    for (let position = 0; position < draft.floorCount; position++) {
      addPill(floorLabel(position), position === draft.current, () => {
        if (busy || position === draft.current) return;
        draft.selectFloor(position);
        afterFloorChange();
        render();
      });
    }
    const add = addPill(t('+ 층'), false, addFloor);
    add.classList.add('ghosty');
    if (draft.floorCount > 1) addPill(t('{floor} 지우기', { floor: floorLabel(draft.current) }), false, removeFloor);
    panel.hidden = false;
    return;
  }

  if (floors.length <= 1 || seats.length === 0) {
    panel.hidden = true;
    return;
  }

  floors.forEach((floor, position) => {
    const mine = seats.some(seat => seat.f === floor.f && seat.state === 'mine');
    addPill(floorLabel(position) + (mine ? ' · ' + t('내 자리') : ''), floor.f === viewFloorId, () => {
      if (floor.f === viewFloorId) return;
      viewFloorId = floor.f;
      viewFloorChosen = true;
      render();
    });
  });
  panel.hidden = false;
}

function clearBoard() {
  $('board').textContent = '';
  seatButtons = new Map();
  editorCells = new Map();
  geometry = null;
  builtKey = '';
}

function stageRadius(geo) {
  return Math.max(26, geo.innerRadius - 30);
}

const isHalfStage = geo => geo.isArc && geo.angle <= 200;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SNAP_KINDS = ['door', 'window', 'tv', 'ac'];
const SNAP_DISTANCE = 40;
const EDIT_MARGIN = 90;

function allSlots(geo) {
  const all = [];
  for (let row = 0; row < geo.rows; row++) {
    for (let col = 0; col < geo.capacity(row); col++) all.push({ row, col });
  }
  return all;
}

function boundsOf(geo, cells, extra, margin) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const halfW = geo.isArc ? HALF_DIAGONAL : CELL_W / 2;
  const halfH = geo.isArc ? HALF_DIAGONAL : CELL_H / 2;

  for (const { row, col } of cells) {
    const { x, y } = geo.place(row, col);
    minX = Math.min(minX, x - halfW);
    maxX = Math.max(maxX, x + halfW);
    minY = Math.min(minY, y - halfH);
    maxY = Math.max(maxY, y + halfH);
  }

  if (geo.isArc) {
    const stage = stageRadius(geo);
    minX = Math.min(minX, -stage);
    maxX = Math.max(maxX, stage);
    maxY = Math.max(maxY, stage);
    minY = isHalfStage(geo) ? Math.min(minY, stage - STAGE_VISIBLE) : Math.min(minY, -stage);
  }

  for (const [x, y] of extra) {
    minX = Math.min(minX, x - 40);
    maxX = Math.max(maxX, x + 40);
    minY = Math.min(minY, y - 40);
    maxY = Math.max(maxY, y + 40);
  }

  if (minX > maxX) minX = maxX = minY = maxY = 0;
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

const FRONT_GAP = 10;
const FRONT_HEIGHT = 28;

const STAGE_MIN = 60;

function frontRect(geo, cells, floor) {
  const stage = floor ? floor.stage : 'full';
  if (geo.isArc || stage === 'none') return null;
  const bottom = -FRONT_GAP;
  if (stage === 'custom' && floor.sr - floor.sl >= STAGE_MIN) return { left: floor.sl, right: floor.sr, top: bottom - FRONT_HEIGHT, bottom };
  if (cells.length === 0) return null;
  let left = Infinity, right = -Infinity;
  for (const { row, col } of cells) {
    const { x } = geo.place(row, col);
    left = Math.min(left, x - CELL_W / 2);
    right = Math.max(right, x + CELL_W / 2);
  }
  if (stage !== 'rows') {
    left = Math.min(left, 0);
    right = Math.max(right, geo.cols * CELL_W);
  }
  return { left, right, top: bottom - FRONT_HEIGHT, bottom };
}

function frontCorners(rect) {
  return rect ? [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]] : [];
}

function drawFront(rect) {
  if (!rect) return;
  const band = document.createElement('div');
  band.className = 'front-stage';
  band.textContent = t('앞 (강단)');
  Object.assign(band.style, {
    left: rect.left + offsetX + 'px', top: rect.top + offsetY + 'px',
    width: rect.right - rect.left + 'px', height: rect.bottom - rect.top + 'px'
  });
  $('board').appendChild(band);
  if (!editing() || tool !== 'stage') return;
  band.classList.add('editable');
  for (const side of ['l', 'r']) {
    const handle = document.createElement('div');
    handle.className = 'stage-handle';
    handle.dataset.side = side;
    handle.style.left = (side === 'l' ? rect.left : rect.right) + offsetX + 'px';
    handle.style.top = (rect.top + rect.bottom) / 2 + offsetY + 'px';
    $('board').appendChild(handle);
  }
}

function editorFrontRect() {
  const geo = draft.geometry;
  const placed = placedSlots();
  return frontRect(geo, placed.length ? placed : allSlots(geo), draft.cur);
}

function redrawFront() {
  $('board').querySelectorAll('.front-stage, .stage-handle').forEach(node => node.remove());
  drawFront(editorFrontRect());
}

function setCustomStage(left, right) {
  draft.cur.stage = 'custom';
  draft.cur.sl = Math.round(left);
  draft.cur.sr = Math.round(right);
}

function stepStage(delta) {
  if (!draft || busy) return;
  const rect = editorFrontRect();
  if (!rect) return;
  const half = CELL_W / 2 * delta;
  if (rect.right - rect.left + half * 2 < STAGE_MIN) return;
  setCustomStage(rect.left - half, rect.right + half);
  render();
}

function layOut(geo, cells, extra = [], margin = 0) {
  const box = boundsOf(geo, cells, extra, margin);
  offsetX = -box.minX;
  offsetY = -box.minY;
  const board = $('board');
  board.style.width = Math.ceil(box.maxX - box.minX) + 'px';
  board.style.height = Math.ceil(box.maxY - box.minY) + 'px';

  if (geo.isArc) {
    const radius = stageRadius(geo);
    const stage = document.createElement('div');
    stage.className = 'stage' + (isHalfStage(geo) ? ' half' : '');
    stage.textContent = t('무대');
    Object.assign(stage.style, {
      width: radius * 2 + 'px', height: radius * 2 + 'px',
      left: offsetX - radius + 'px', top: offsetY - radius + 'px'
    });
    board.appendChild(stage);
  }
}

function addCell(geo, row, col, content) {
  const { x, y, rotation } = geo.place(row, col);
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.style.left = x + offsetX - CELL_W / 2 + 'px';
  cell.style.top = y + offsetY - CELL_H / 2 + 'px';
  if (rotation) cell.style.transform = `rotate(${rotation}deg)`;
  cell.appendChild(content);
  $('board').appendChild(cell);
  return { cell, rotation };
}

function shortLabel(label) {
  const space = label.indexOf(' ');
  return space > 0 && label.slice(0, space).endsWith('층') ? label.slice(space + 1) : label;
}

function buildBoard() {
  const board = $('board');
  board.classList.toggle('editing', editing());
  board.classList.toggle('pan', editing() && $('panToggle').checked);
  board.dataset.tool = editing() ? (tool === 'outline' ? 'outline' : tool === 'stage' ? 'stage' : isItemKind(tool) ? 'item' : 'paint') : '';

  if (editing()) buildEditor();
  else buildSeats();

  const hasAnything = editing() || seats.length > 0 || items.length > 0 || walls.size > 0;
  $('frontBand').hidden = true;
  $('emptyText').hidden = hasAnything;
  $('boardZoom').hidden = !hasAnything;
  updateZoom();
}

function buildSeats() {
  const cells = seats.filter(seat => seat.f === viewFloorId);
  const things = items.filter(item => item.f === viewFloorId);
  const outline = walls.get(viewFloorId) || null;

  if (cells.length === 0 && things.length === 0 && !outline) {
    clearBoard();
    return;
  }

  const floor = floors.find(item => item.f === viewFloorId) || { shape: 'grid', angle: 0, rows: 0, cols: 0 };
  const geo = new SeatGeometry(floor.shape, floor.angle, Math.max(floor.rows, cells.length ? Math.max(...cells.map(seat => seat.r)) + 1 : 1), Math.max(floor.cols, 1));
  const shapeKey = 'view:' + floor.f + ':' + geo.isArc + ':' + geo.angle + ':' + geo.cols + ':' + floor.stage + ':' + floor.sl + ':' + floor.sr + ':' +
    cells.map(seat => seat.id + '/' + seat.r + '/' + seat.c + '/' + seat.label + '/' + seat.kind + '/' + seat.bench).join('|') + '#' +
    JSON.stringify([things, outline]);

  if (shapeKey !== builtKey) {
    clearBoard();
    geometry = geo;
    builtKey = shapeKey;
    const seatSlots = cells.map(seat => ({ row: seat.r, col: seat.c }));
    const front = frontRect(geo, seatSlots, floor);
    layOut(geo, seatSlots, [...(outline || []), ...things.map(item => [item.x, item.y]), ...frontCorners(front)]);
    drawOutline(outline, false);
    drawFront(front);

    const benchCells = new Set(cells.filter(seat => seat.kind === 'pew' && seat.bench).map(seat => seat.r + ',' + seat.c + ',' + seat.bench));

    for (const seat of cells) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seat ' + seat.kind;
      if (seat.bench && benchCells.has(seat.r + ',' + (seat.c - 1) + ',' + seat.bench)) button.classList.add('jl');
      if (seat.bench && benchCells.has(seat.r + ',' + (seat.c + 1) + ',' + seat.bench)) button.classList.add('jr');
      button.dataset.id = seat.id;
      const txt = document.createElement('span');
      txt.className = 'txt';
      button.appendChild(txt);
      const { rotation } = addCell(geo, seat.r, seat.c, button);
      if (rotation) txt.style.transform = `rotate(${-rotation}deg)`;
      seatButtons.set(seat.id, button);
    }

    drawThings(things, outline, false);

    if (geo.isArc) {
      requestAnimationFrame(() => {
        const scroll = $('boardScroll');
        const spare = scroll.scrollWidth - scroll.clientWidth;
        if (spare > 0) scroll.scrollLeft = spare / 2;
      });
    }
  }

  for (const seat of cells) {
    const button = seatButtons.get(seat.id);
    if (!button) continue;
    const signature = seat.state + '|' + seat.name;
    if (button.dataset.sig === signature) continue;
    button.dataset.sig = signature;
    button.classList.toggle('mine', seat.state === 'mine');
    button.classList.toggle('taken', seat.state === 'taken');
    button.classList.toggle('blocked', seat.state === 'blocked');

    const txt = button.firstChild;
    txt.textContent = '';
    const lb = document.createElement('span');
    lb.className = 'lb';
    lb.textContent = seat.state === 'blocked' ? '×' : shortLabel(seat.label);
    txt.appendChild(lb);

    const sub = seat.state === 'mine' ? (seat.name || t('내 자리'))
      : seat.state === 'taken' ? (seat.name || t('찜함'))
        : seat.kind === 'extra' ? t('보조') : '';
    if (sub) {
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = sub;
      txt.appendChild(nm);
    }

    const stateText = { mine: t('내 자리'), taken: seat.name || t('찜함'), blocked: t('앉을 수 없는 자리'), free: t('빈자리') }[seat.state];
    const tip = `${t(kindName(seat.kind))} · ${seat.label} · ${stateText}`;
    button.title = tip;
    button.setAttribute('aria-label', tip);
  }
}

function buildEditor() {
  clearBoard();
  const geo = draft.geometry;
  geometry = geo;
  const all = allSlots(geo);
  const outline = draft.cur.outline;
  const front = frontRect(geo, placedSlots().length ? placedSlots() : all, draft.cur);
  layOut(geo, all, [...(outline || []), ...draft.cur.items.map(item => [item.x, item.y]), ...frontCorners(front)], EDIT_MARGIN);
  drawFront(front);

  const shortKind = { desk: t('책상'), pew: t('장'), extra: t('보조'), chair: t('의자') };

  for (const { row, col } of all) {
    const value = draft.get(row, col);
    const box = document.createElement('div');

    if (!value) {
      box.className = 'seat slot';
    } else {
      const left = draft.get(row, col - 1);
      const right = draft.get(row, col + 1);
      box.className = 'seat draft ' + value.kind + (value.blocked ? ' blocked' : '');
      if (value.kind === 'pew' && left && left.kind === 'pew' && left.bench === value.bench) box.classList.add('jl');
      if (value.kind === 'pew' && right && right.kind === 'pew' && right.bench === value.bench) box.classList.add('jr');
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = value.blocked ? '×' : shortKind[value.kind];
      box.appendChild(txt);
    }

    const { cell, rotation } = addCell(geo, row, col, box);
    if (rotation && box.firstChild) box.firstChild.style.transform = `rotate(${-rotation}deg)`;
    editorCells.set(row + ',' + col, cell);
  }

  drawFree();
}

// ───────────── 외벽 · 물건 ─────────────

let selectedItem = -1;
let selectedVertex = -1;
let freeDrag = null;
let lastVertexTap = null;

function drawFree() {
  $('board').querySelectorAll('.free').forEach(node => node.remove());
  drawOutline(draft.cur.outline, tool === 'outline');
  drawThings(draft.cur.items, draft.cur.outline, isItemKind(tool));
}

function drawOutline(points, editable) {
  if (!points || points.length < 3) return;
  const board = $('board');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'free outline' + (editable ? ' editable' : '') + (editing() ? ' over' : ''));
  svg.setAttribute('width', board.style.width);
  svg.setAttribute('height', board.style.height);
  const at = ([x, y]) => [x + offsetX, y + offsetY];

  const polygon = document.createElementNS(SVG_NS, 'polygon');
  polygon.setAttribute('class', 'wall-line');
  polygon.setAttribute('points', points.map(point => at(point).join(',')).join(' '));
  svg.appendChild(polygon);

  if (editable) {
    const radius = matchMedia('(pointer: coarse)').matches ? 13 : 9;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const [mx, my] = at([(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]);
      const mid = document.createElementNS(SVG_NS, 'circle');
      mid.setAttribute('class', 'mid');
      mid.setAttribute('cx', mx);
      mid.setAttribute('cy', my);
      mid.setAttribute('r', radius * 0.6);
      mid.dataset.mid = index;
      svg.appendChild(mid);
    });
    points.forEach((point, index) => {
      const [cx, cy] = at(point);
      const vertex = document.createElementNS(SVG_NS, 'circle');
      vertex.setAttribute('class', 'vertex' + (index === selectedVertex ? ' selected' : ''));
      vertex.setAttribute('cx', cx);
      vertex.setAttribute('cy', cy);
      vertex.setAttribute('r', radius);
      vertex.dataset.vertex = index;
      svg.appendChild(vertex);
    });
  }

  if (editing()) board.appendChild(svg);
  else board.insertBefore(svg, board.firstChild);
}

function uprightAngle(angle) {
  let a = ((angle % 360) + 360) % 360;
  if (a > 180) a -= 360;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawThings(things, outline, editable) {
  const board = $('board');
  things.forEach((item, index) => {
    const info = ITEMS[item.kind];
    if (!info) return;
    const angle = uprightAngle(item.a || 0);
    const radians = angle * Math.PI / 180;
    const left = item.x + offsetX;
    const top = item.y + offsetY;

    const thing = document.createElement('div');
    thing.className = 'free thing ' + item.kind + (editable ? ' editable' : '') + (editable && index === selectedItem ? ' selected' : '');
    thing.dataset.index = index;
    thing.title = t(info.name);
    thing.style.left = left + 'px';
    thing.style.top = top + 'px';
    thing.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    if (item.kind === 'speaker') thing.textContent = info.icon;
    if (item.kind === 'pulpit') thing.textContent = t(info.name);
    board.appendChild(thing);

    if (['pillar', 'door', 'window', 'pulpit'].includes(item.kind)) return;
    let nx = -Math.sin(radians);
    let ny = Math.cos(radians);
    if (outline && outline.length >= 3 && !insidePolygon(item.x + nx * 20, item.y + ny * 20, outline)) {
      nx = -nx;
      ny = -ny;
    }
    const gap = item.kind === 'speaker' ? 30 : 20;
    const label = document.createElement('div');
    label.className = 'free thing-label ' + item.kind;
    label.textContent = (item.kind === 'speaker' ? '' : info.icon ? info.icon + ' ' : '') + t(info.name);
    label.style.left = left + nx * gap + 'px';
    label.style.top = top + ny * gap + 'px';
    board.appendChild(label);
  });

  if (editable && things[selectedItem]) {
    const item = things[selectedItem];
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'free thing-del';
    remove.textContent = '×';
    remove.title = t('이 물건 지우기');
    remove.style.left = item.x + offsetX + 26 + 'px';
    remove.style.top = item.y + offsetY - 26 + 'px';
    board.appendChild(remove);
  }
}

function boardPoint(event) {
  const rect = $('board').getBoundingClientRect();
  return { x: (event.clientX - rect.left) / zoom - offsetX, y: (event.clientY - rect.top) / zoom - offsetY };
}

function snapToWall(kind, x, y, fallbackAngle) {
  const outline = draft.cur.outline;
  if (!SNAP_KINDS.includes(kind) || !outline || outline.length < 3) return { x, y, a: fallbackAngle };
  let best = null;
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length];
    const dx = next[0] - point[0];
    const dy = next[1] - point[1];
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) return;
    const t = clamp(((x - point[0]) * dx + (y - point[1]) * dy) / length2, 0, 1);
    const px = point[0] + t * dx;
    const py = point[1] + t * dy;
    const distance = Math.hypot(x - px, y - py);
    if (!best || distance < best.distance) best = { distance, x: px, y: py, a: Math.atan2(dy, dx) * 180 / Math.PI };
  });
  return best && best.distance <= SNAP_DISTANCE ? { x: best.x, y: best.y, a: uprightAngle(best.a) } : { x, y, a: fallbackAngle };
}

function onFreeDown(event) {
  const point = boardPoint(event);

  if (tool === 'outline') {
    const outline = draft.cur.outline;
    const target = event.target;
    if (!outline || !(target instanceof SVGElement)) return false;
    if (target.dataset.vertex !== undefined) {
      const index = Number(target.dataset.vertex);
      const now = Date.now();
      if (lastVertexTap && lastVertexTap.index === index && now - lastVertexTap.time < 450 && outline.length > 3) {
        lastVertexTap = null;
        selectedVertex = index;
        deleteSelected();
        return true;
      }
      lastVertexTap = { index, time: now };
      selectedVertex = index;
    } else if (target.dataset.mid !== undefined) {
      if (outline.length >= MAX_WALL_POINTS) {
        say(t('꼭짓점은 {n}개까지예요.', { n: MAX_WALL_POINTS }));
        return true;
      }
      lastVertexTap = null;
      selectedVertex = Number(target.dataset.mid) + 1;
      outline.splice(selectedVertex, 0, [Math.round(point.x), Math.round(point.y)]);
    } else {
      return false;
    }
    freeDrag = { type: 'vertex' };
    drawFree();
    syncEditorControls();
    return true;
  }

  if (!isItemKind(tool)) return false;
  const del = event.target.closest('.thing-del');
  if (del) {
    deleteSelected();
    return true;
  }

  const hit = event.target.closest('.thing.editable');
  if (hit) {
    selectedItem = Number(hit.dataset.index);
    const item = draft.cur.items[selectedItem];
    freeDrag = { type: 'item', dx: item.x - point.x, dy: item.y - point.y };
  } else {
    const placed = snapToWall(tool, point.x, point.y, 0);
    const error = draft.addItem(tool, placed.x, placed.y, placed.a);
    if (error) {
      say(error);
      return true;
    }
    selectedItem = draft.cur.items.length - 1;
    freeDrag = { type: 'item', dx: 0, dy: 0 };
  }
  drawFree();
  return true;
}

function onFreeMove(event) {
  const point = boardPoint(event);
  if (freeDrag.type === 'stage') {
    const x = Math.round(point.x / 5) * 5;
    if (freeDrag.side === 'l') draft.cur.sl = Math.min(x, draft.cur.sr - STAGE_MIN);
    else draft.cur.sr = Math.max(x, draft.cur.sl + STAGE_MIN);
    redrawFront();
    return;
  }
  if (freeDrag.type === 'vertex') {
    const outline = draft.cur.outline;
    if (!outline || !outline[selectedVertex]) return;
    lastVertexTap = null;
    outline[selectedVertex] = [Math.round(point.x / 5) * 5, Math.round(point.y / 5) * 5];
  } else {
    const item = draft.cur.items[selectedItem];
    if (!item) return;
    const placed = snapToWall(item.kind, point.x + freeDrag.dx, point.y + freeDrag.dy, SNAP_KINDS.includes(item.kind) ? 0 : item.a);
    draft.moveItem(selectedItem, placed.x, placed.y, placed.a);
  }
  drawFree();
}

function onFreeUp() {
  freeDrag = null;
  render();
}

function updateZoom() {
  const inner = $('boardInner');
  const zoomBox = $('boardZoom');
  inner.style.transform = '';
  const width = inner.offsetWidth;
  const height = inner.offsetHeight;
  const box = $('boardScroll');
  const availableWidth = box.clientWidth - 2;
  const availableHeight = box.clientHeight - 2;
  const wide = matchMedia('(min-width: 961px)').matches;
  const canFit = !editing() || !matchMedia('(pointer: coarse)').matches;
  let fit = width > 0 ? availableWidth / width : 1;
  if (wide && height > 0 && availableHeight > 0) fit = Math.min(fit, availableHeight / height);
  zoom = canFit && availableWidth > 0 ? clamp(fit, MIN_ZOOM, wide ? MAX_ZOOM : 1) : 1;
  inner.style.transform = zoom !== 1 ? `scale(${zoom})` : '';
  zoomBox.style.width = Math.ceil(width * zoom) + 'px';
  zoomBox.style.height = Math.ceil(height * zoom) + 'px';
}

// ───────────── 끌어서 칠하기 ─────────────

let dragStart = null;
let dragEnd = null;
let previewCells = new Set();

function cellAt(event, clampToBoard) {
  if (!draft || !geometry) return null;
  const rect = $('board').getBoundingClientRect();
  return geometry.hit((event.clientX - rect.left) / zoom - offsetX, (event.clientY - rect.top) / zoom - offsetY, clampToBoard);
}

function showPreview() {
  if (!geometry || !dragStart) return;
  const next = new Set(geometry.cellsBetween(dragStart.row, dragStart.col, dragEnd.row, dragEnd.col).map(c => c.row + ',' + c.col));
  for (const k of previewCells) {
    if (!next.has(k)) {
      const mark = editorCells.get(k)?.querySelector('.mark');
      if (mark) mark.remove();
    }
  }
  for (const k of next) {
    if (previewCells.has(k)) continue;
    const cell = editorCells.get(k);
    if (!cell) continue;
    const mark = document.createElement('div');
    mark.className = 'mark';
    cell.appendChild(mark);
  }
  previewCells = next;
}

function hidePreview() {
  for (const k of previewCells) {
    const mark = editorCells.get(k)?.querySelector('.mark');
    if (mark) mark.remove();
  }
  previewCells = new Set();
}

let activePointer = null;

function onPointerDown(event) {
  if (!editing() || busy || $('panToggle').checked || event.button !== 0) return;
  if (activePointer !== null) {
    if (event.pointerId !== activePointer) onPointerCancel();
    return;
  }
  if (tool === 'stage') {
    const handle = event.target.closest('.stage-handle');
    const rect = handle && editorFrontRect();
    if (rect) {
      setCustomStage(rect.left, rect.right);
      freeDrag = { type: 'stage', side: handle.dataset.side };
      activePointer = event.pointerId;
      $('board').setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    return;
  }
  if (tool === 'outline' || isItemKind(tool)) {
    if (onFreeDown(event)) {
      if (freeDrag) {
        activePointer = event.pointerId;
        $('board').setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    }
    return;
  }
  const cell = cellAt(event, false);
  if (!cell) return;
  dragStart = cell;
  dragEnd = cell;
  activePointer = event.pointerId;
  $('board').setPointerCapture(event.pointerId);
  event.preventDefault();
  showPreview();
}

function onPointerMove(event) {
  if (event.pointerId !== activePointer) return;
  if (freeDrag) {
    onFreeMove(event);
    return;
  }
  if (!dragStart) return;
  const cell = cellAt(event, true);
  if (cell && (cell.row !== dragEnd.row || cell.col !== dragEnd.col)) {
    dragEnd = cell;
    showPreview();
  }
}

function onPointerUp(event) {
  if (event && event.pointerId !== activePointer) return;
  activePointer = null;
  if (freeDrag) {
    onFreeUp();
    return;
  }
  if (!dragStart) return;
  const start = dragStart;
  dragStart = null;
  hidePreview();
  applyTool(start.row, start.col, dragEnd.row, dragEnd.col);
}

function onPointerCancel(event) {
  if (event && event.pointerId !== activePointer) return;
  activePointer = null;
  if (freeDrag) onFreeUp();
  dragStart = null;
  hidePreview();
}

// ───────────── 연결하기 ─────────────

function wire() {
  $('templateLink').href = TEMPLATE_COPY_URL;
  $('connectButton').addEventListener('click', connect);
  $('codeInput').addEventListener('input', updateCodeCheck);
  $('codeInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      connect();
    }
  });
  $('nameInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('codeInput').focus(); });
  $('nameInput').addEventListener('input', updateConnectButton);
  $('demoButton').addEventListener('click', () => {
    $('codeInput').value = 'demo';
    if (!$('nameInput').value.trim()) $('nameInput').value = t('체험자');
    connect();
  });

  $('refreshButton').addEventListener('click', () => refresh(false));
  $('disconnectButton').addEventListener('click', disconnect);
  $('myNameInput').addEventListener('blur', commitName);
  $('myNameInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    }
  });

  $('board').addEventListener('click', event => {
    const button = event.target.closest('button.seat');
    if (!button || editing()) return;
    const seat = seats.find(item => item.id === button.dataset.id);
    if (seat) tapSeat(seat);
  });
  $('board').addEventListener('pointerdown', onPointerDown);
  $('board').addEventListener('pointermove', onPointerMove);
  $('board').addEventListener('pointerup', onPointerUp);
  $('board').addEventListener('pointercancel', onPointerCancel);
  $('board').addEventListener('lostpointercapture', event => { if (dragStart || freeDrag) onPointerUp(event); });
  $('resetOutlineButton').addEventListener('click', resetOutline);
  $('deleteVertexButton').addEventListener('click', deleteSelected);
  $('clearOutlineButton').addEventListener('click', clearOutline);
  document.addEventListener('keydown', event => {
    if (!editing() || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
    if (event.target.closest && event.target.closest('input, textarea')) return;
    deleteSelected();
  });

  $('publishedToggle').addEventListener('change', event => saveSettings({ published: event.target.checked }));
  $('showNamesToggle').addEventListener('change', event => saveSettings({ showNames: event.target.checked }));
  $('maxMinus').addEventListener('click', () => changeMax(-1));
  $('maxPlus').addEventListener('click', () => changeMax(1));
  $('editLayoutButton').addEventListener('click', beginEdit);
  $('nextSessionButton').addEventListener('click', nextSession);
  $('inviteCopyButton').addEventListener('click', copyInvite);
  $('inviteQrButton').addEventListener('click', showQr);
  $('myLinkButton').addEventListener('click', copyMyLink);
  $('pinButton').addEventListener('click', () => openPinDialog('set'));
  $('reclaimButton').addEventListener('click', () => openPinDialog('reclaim'));
  $('gatePinButton').addEventListener('click', () => openPinDialog('set'));
  $('gateLinkButton').addEventListener('click', copyMyLink);
  $('gateReclaimButton').addEventListener('click', () => openPinDialog('reclaim'));
  $('pinForm').addEventListener('submit', submitPin);
  $('pinForm').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    $('pinOkButton').click();
  });

  $('editorPanel').addEventListener('click', event => {
    const pill = event.target.closest('.pill[data-tool]');
    if (!pill || busy) return;
    chooseTool(pill.dataset.tool);
  });
  $('shapePanel').addEventListener('click', event => {
    const pill = event.target.closest('[data-shape]');
    if (pill) setShapePreset(pill.dataset.shape);
  });
  $('stagePanel').addEventListener('click', event => {
    const pill = event.target.closest('[data-stage]');
    if (pill) setStageWidth(pill.dataset.stage);
  });
  $('stageToolPanel').addEventListener('click', event => {
    const step = event.target.closest('[data-stage-step]');
    if (step) stepStage(Number(step.dataset.stageStep));
  });
  $('editorPanel').addEventListener('click', event => {
    const angle = event.target.closest('[data-angle]');
    if (angle) changeAngle(Number(angle.dataset.angle));
    const button = event.target.closest('[data-resize]');
    if (!button) return;
    const action = button.dataset.resize;
    resizeDraft(action === 'row-' ? -1 : action === 'row+' ? 1 : 0, action === 'col-' ? -1 : action === 'col+' ? 1 : 0);
  });
  $('panToggle').addEventListener('change', () => $('board').classList.toggle('pan', $('panToggle').checked));
  $('saveLayoutButton').addEventListener('click', saveLayoutNow);
  $('cancelEditButton').addEventListener('click', cancelEdit);

  window.addEventListener('hashchange', readHash);
  new ResizeObserver(() => { if (isConnected()) updateZoom(); }).observe($('boardScroll'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  window.addEventListener('focus', () => { if (!refreshing) refresh(true); });
  window.addEventListener('beforeunload', event => {
    if (editing()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  $('themeButton').textContent = dark ? '☀️' : '🌙';
  $('themeButton').setAttribute('aria-label', dark ? t('밝은 화면으로') : t('어두운 화면으로'));
  $('themeButton').title = dark ? t('밝은 화면으로') : t('어두운 화면으로');
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('jjimkong.theme', next); } catch (e) { /* 개인 창 등 */ }
  applyTheme(next);
}

function fillLanguages() {
  const button = $('langButton');
  const list = $('langList');
  const current = LANGS.find(item => item.code === LANG) || LANGS[0];
  $('langFlag').className = 'fi fi-' + current.flag;
  $('langName').textContent = current.name;

  for (const item of LANGS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'lang-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(item.code === LANG));
    option.lang = item.code;
    const flag = document.createElement('span');
    flag.className = 'fi fi-' + item.flag;
    const name = document.createElement('span');
    name.className = 'lang-label';
    name.textContent = item.name;
    option.append(flag, name);
    if (item.code === LANG) {
      const check = document.createElement('span');
      check.className = 'lang-check';
      check.textContent = '✓';
      option.appendChild(check);
    }
    option.addEventListener('click', () => {
      if (item.code === LANG) closeLanguages(true);
      else setLang(item.code);
    });
    list.appendChild(option);
  }

  button.addEventListener('click', () => (list.hidden ? openLanguages() : closeLanguages(false)));
  document.addEventListener('pointerdown', event => {
    if (!list.hidden && !event.target.closest('.lang-menu')) closeLanguages(false);
  });
  list.addEventListener('keydown', event => {
    const options = [...list.querySelectorAll('.lang-option')];
    const at = options.indexOf(document.activeElement);
    const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
    const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) {
      event.preventDefault();
      options[Math.min(Math.max(at + step, 0), options.length - 1)].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1].focus();
    } else if (event.key === 'Escape') {
      closeLanguages(true);
    }
  });
}

function openLanguages() {
  const list = $('langList');
  list.hidden = false;
  $('langButton').setAttribute('aria-expanded', 'true');
  (list.querySelector('[aria-selected="true"]') || list.firstElementChild).focus();
}

function closeLanguages(focusButton) {
  $('langList').hidden = true;
  $('langButton').setAttribute('aria-expanded', 'false');
  if (focusButton) $('langButton').focus();
}

const PENDING_KEY = 'jjimkong.pending';

window.Jjim.beforeLangChange = () => {
  const code = $('codeInput').value.trim();
  if (store.conn || !code) return;
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ code, name: $('nameInput').value }));
};

function restorePending() {
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    sessionStorage.removeItem(PENDING_KEY);
  } catch (e) { pending = null; }
  if (store.conn || !pending || typeof pending.code !== 'string') return;
  $('codeInput').value = pending.code;
  if (typeof pending.name === 'string' && pending.name) $('nameInput').value = pending.name;
  updateCodeCheck();
}

async function start() {
  translatePage();
  fillLanguages();
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  $('themeButton').addEventListener('click', toggleTheme);
  wire();
  $('nameInput').value = store.name;
  restorePending();
  await onConnectionChanged();

  if (store.conn) {
    startTimer();
    await refresh(false);
  }
  await readHash();
}

start();
})();
