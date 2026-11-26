(() => {
'use strict';
const { SeatGeometry, LayoutDraft, CELL_W, CELL_H, FAN_ANGLE, ROUND_ANGLE, MIN_ANGLE, MAX_ANGLE, MAX_ROWS, MAX_COLS, floorName, normalizeKind, normalizeShape, kindName, parseCode, memberUrlFromParams, buildInvite, buildShareText, fingerprint, TEMPLATE_COPY_URL, DEMO_URL, post, getState, saveLayout: postLayout, forgetLayout } = window.Jjim;
const REFRESH_MS = 20000;
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
  try { data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { data = {}; }
  if (typeof data.personId !== 'string' || !PERSON_PATTERN.test(data.personId)) data.personId = randomId();
  if (typeof data.name !== 'string') data.name = '';
  if (!data.pins || typeof data.pins !== 'object') data.pins = {};
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
const isAdmin = () => !!(store.conn && store.conn.adminKey && lastState && lastState.admin);
const editing = () => draft !== null;

function setBusy(value) {
  busy = value;
  if (value) refreshSeq++;
  document.body.classList.toggle('busy', value);
  ['connectButton', 'refreshButton', 'editLayoutButton', 'nextSessionButton', 'saveLayoutButton', 'cancelEditButton',
    'publishedToggle', 'showNamesToggle', 'maxMinus', 'maxPlus'].forEach(id => { $(id).disabled = value; });
  $('editorPanel').querySelectorAll('button').forEach(b => { b.disabled = value; });
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
  const link = parseCode($('codeInput').value);

  if (!link) {
    say('연결 코드를 읽지 못했어요. 관리자가 준 링크나 https://script.google.com/… 주소를 그대로 붙여 넣어 주세요.');
    return;
  }

  const own = readOwnKey($('codeInput').value.replace(/\s+/g, ''));
  if (own.key) store.personId = own.key;
  if (own.name && !$('nameInput').value.trim()) $('nameInput').value = own.name;
  store.name = $('nameInput').value.trim();
  saveStore();

  const candidate = { url: link.url, adminKey: link.adminKey, room: '' };
  setBusy(true);
  say('연결하는 중…');
  const state = await getState(candidate, store.personId);
  setBusy(false);

  if (!state.ok) {
    say(state.message || '연결하지 못했어요.');
    return;
  }

  if (link.adminKey && !state.admin) {
    say('관리자 키가 맞지 않아요. 시트에서 관리자 QR 을 다시 열어 주세요(키를 새로 만들었을 수 있어요).');
    return;
  }

  candidate.room = state.room || '';
  store.conn = candidate;
  saveStore();
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
    ? '연결을 끊어도 찜해 둔 자리는 그대로 남아요. 이 브라우저에서 같은 코드로 다시 연결하면 내 자리로 보여요. 끊을까요?'
    : '좌석 예약 연결을 끊을까요? 같은 코드로 언제든 다시 연결할 수 있어요.';
  if (!await confirmBox('연결 끊기', text)) return;
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
  viewFloorChosen = false;
  setBusy(false);
  stopTimer();
  $('toast').hidden = true;
  await onConnectionChanged();
}

async function onConnectionChanged() {
  connFingerprint = store.conn && store.conn.url !== DEMO_URL ? await fingerprint(store.conn.url) : '';
  render();
}

function acceptInvite(memberUrl) {
  if (!store.conn) {
    $('codeInput').value = memberUrl;
    updateCodeCheck();
    say('초대 링크로 들어왔어요. 이름을 적고 [연결] 을 눌러 주세요.');
    if (!$('nameInput').value) $('nameInput').focus();
    return;
  }

  if (store.conn.url === memberUrl) {
    say('이미 이 좌석 예약에 연결돼 있어요.');
    return;
  }

  say('다른 좌석 예약에 연결돼 있어요. 초대받은 곳으로 바꾸려면 [연결 끊기] 를 누른 뒤 연결해 주세요(코드는 넣어 둘게요).');
  $('codeInput').value = memberUrl;
}

function readHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return;

  if (/(^|&)s=/.test(hash)) {
    const url = memberUrlFromParams(hash);
    const own = readOwnKey('#' + hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!url) say('초대 링크를 읽지 못했어요. 링크가 잘렸을 수 있어요. 관리자에게 다시 받아 주세요.');
    else if (own.key) acceptMyLink(url, own.key, own.name);
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

const OWN_LINK_DONE = '내 자리 링크로 들어왔어요. 찜해 둔 자리가 내 자리로 보여요.';

async function acceptMyLink(url, key, name) {
  if (store.conn && store.conn.url !== url) {
    if (!await confirmBox('내 자리 링크', '지금 다른 좌석 예약에 연결돼 있어요. 링크의 좌석 예약으로 바꿀까요?')) return;
    await dropConnection();
  }

  if (store.conn) {
    await adoptPerson(key, name, OWN_LINK_DONE);
    return;
  }

  store.personId = key;
  if (name) store.name = name;
  saveStore();
  $('nameInput').value = store.name;
  $('codeInput').value = url;
  await connect();
  if (isConnected()) say(OWN_LINK_DONE);
}

async function adoptPerson(personId, name, doneText) {
  if (personId !== store.personId) {
    const hasMine = seats.some(seat => seat.state === 'mine');
    if (hasMine && !await confirmBox('내 자리 되찾기',
      '이 브라우저에서 새로 찜한 자리는 더 이상 내 자리로 보이지 않아요(남아 있으면 관리자가 취소할 수 있어요). 바꿀까요?')) return;
    store.personId = personId;
  }
  if (name) store.name = name;
  saveStore();
  await refresh(false);
  say(doneText);
}

async function updateCodeCheck() {
  const link = parseCode($('codeInput').value);
  const code = link && link.url !== DEMO_URL ? await fingerprint(link.url) : '';
  $('codeFingerprint').textContent = code;
  $('codeCheck').hidden = !code;
}

// ───────────── 불러오기 ─────────────

let timer = 0;

function startTimer() {
  stopTimer();
  timer = setInterval(() => { if (!document.hidden) refresh(true); }, REFRESH_MS);
}

function stopTimer() {
  clearInterval(timer);
  timer = 0;
}

async function refresh(quiet) {
  if (!store.conn || busy || editing()) return;
  if (!quiet) setBusy(true);
  const sequence = ++refreshSeq;
  const conn = store.conn;
  const state = await getState(conn, store.personId);
  if (!quiet) setBusy(false);

  if (sequence !== refreshSeq || conn !== store.conn || editing()) return;

  if (!state.ok) {
    say(state.message || '', true);
    return;
  }

  if (messageFromRefresh) say('');
  applyState(state);
}

function applyState(state) {
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
    if (seat.blocked) stateName = 'blocked';
    else if (reservation) {
      stateName = reservation.mine ? 'mine' : 'taken';
      name = reservation.name || '';
    }
    return {
      id: seat.id, r: seat.r | 0, c: seat.c | 0, f: seat.f | 0, label: String(seat.label || seat.id),
      kind: normalizeKind(seat.kind), bench: seat.bench || '', state: stateName, name
    };
  });

  const known = new Map();
  for (const floor of state.floors) {
    const id = floor.f | 0;
    if (id >= 0 && !known.has(id)) known.set(id, { f: id, shape: normalizeShape(floor.shape), angle: floor.angle | 0, rows: floor.rows | 0, cols: floor.cols | 0 });
  }
  for (const id of [...new Set(seats.map(seat => seat.f))].sort((a, b) => a - b)) {
    if (!known.has(id)) known.set(id, { f: id, shape: 'grid', angle: 0, rows: 0, cols: 0 });
  }
  floors = [...known.values()];
  if (floors.length === 0) floors.push({ f: 0, shape: 'grid', angle: 0, rows: 0, cols: 0 });

  if (!viewFloorChosen && seats.length > 0) {
    viewFloorChosen = true;
    const mine = seats.find(seat => seat.state === 'mine');
    viewFloorId = mine ? mine.f : floors[0].f;
  }
  if (!floors.some(floor => floor.f === viewFloorId)) viewFloorId = floors[0].f;

  render();
}

function statusText(state) {
  if (!state.published) {
    return state.admin
      ? '공개 전이에요. 성도에게는 아직 좌석표가 보이지 않아요.'
      : '아직 예약을 받지 않아요. 관리자가 좌석표를 열면 여기에 보여요.';
  }

  if (!state.isOpen) {
    const opens = formatTime(state.opensAt);
    const closes = formatTime(state.closesAt);
    if (opens && closes) return `지금은 예약 시간이 아니에요(${opens} ~ ${closes}).`;
    return opens ? `${opens}부터 예약할 수 있어요.` : '예약이 마감됐어요.';
  }

  return state.maxPerPerson > 1
    ? `빈자리를 누르면 찜! 한 사람이 ${state.maxPerPerson}자리까지 잡을 수 있어요.`
    : '빈자리를 누르면 찜! 다른 빈자리를 누르면 그리로 옮겨요.';
}

function formatTime(iso) {
  if (!iso) return '';
  const time = new Date(iso);
  if (isNaN(time.getTime())) return '';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = n => String(n).padStart(2, '0');
  return `${time.getMonth() + 1}월 ${time.getDate()}일 (${days[time.getDay()]}) ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

// ───────────── 이름 ─────────────

async function commitName() {
  const conn = store.conn;
  if (!conn) return true;
  const name = $('myNameInput').value.trim();
  if (name === store.name) return true;

  if (name && seats.some(seat => seat.state === 'mine')) {
    const response = await post(conn, store.personId, 'rename', { name });
    if (conn !== store.conn) return false;
    if (!response.ok) {
      say('이름을 바꾸지 못했어요. ' + (response.message || ''));
      return false;
    }
    store.name = name;
    saveStore();
    say('이름을 바꿨어요.');
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
    say('앉을 수 없는 자리예요.');
    return;
  }

  if (seat.state === 'mine') {
    await cancelMine(seat);
    return;
  }

  if (seat.state === 'taken') {
    if (isAdmin()) await forceCancel(seat);
    else say(seat.name ? `${seat.label} 은(는) ${seat.name} 님 자리예요.` : `${seat.label} 은(는) 이미 찜한 자리예요.`);
    return;
  }

  await reserveOrMove(seat);
}

async function reserveOrMove(seat) {
  const conn = store.conn;

  if (!$('myNameInput').value.trim()) {
    say('위의 이름 칸에 이름을 먼저 적어 주세요.');
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

  say(isMove ? `${mine[0].label} → ${seat.label} 로 옮기는 중…` : `${seat.label} 찜하는 중…`);

  const response = isMove
    ? await post(conn, store.personId, 'move', { name: store.name, from: mine[0].id, seat: seat.id })
    : await post(conn, store.personId, 'reserve', { name: store.name, seat: seat.id });

  setBusy(false);
  if (conn !== store.conn) return;

  say(response.ok ? (isMove ? `${seat.label} 로 옮겼어요.` : `${seat.label} 찜콩! 자리를 잡았어요.`) : response.message || '');
  await refresh(true);
}

async function cancelMine(seat) {
  if (!await confirmBox('찜 취소', `${seat.label} 예약을 취소할까요?`)) return;
  const conn = store.conn;
  setBusy(true);
  const response = await post(conn, store.personId, 'cancel', { seat: seat.id });
  setBusy(false);
  if (conn !== store.conn) return;
  say(response.ok ? `${seat.label} 예약을 취소했어요.` : response.message || '');
  await refresh(true);
}

async function forceCancel(seat) {
  const who = seat.name ? seat.name + ' 님의 ' : '';
  if (!await confirmBox('관리자 취소', `${who}${seat.label} 예약을 관리자 권한으로 취소할까요?`)) return;
  const conn = store.conn;
  setBusy(true);
  const extra = { seat: seat.id };
  if (seat.name) extra.name = seat.name;
  const response = await post(conn, store.personId, 'forceCancel', extra);
  setBusy(false);
  if (conn !== store.conn) return;
  say(response.ok ? `${seat.label} 예약을 취소했어요.` : response.message || '');
  await refresh(true);
}

// ───────────── 관리자: 설정 ─────────────

async function saveSettings(settings) {
  if (!store.conn || !isAdmin()) return;

  if (settings.published === true && seats.length === 0) {
    $('publishedToggle').checked = false;
    say('배치도를 먼저 만들어 저장해 주세요.');
    return;
  }

  const response = await post(store.conn, store.personId, 'saveSettings', { settings });

  if (!response.ok) {
    say(response.message || '');
  } else if (settings.published !== undefined) {
    say(settings.published ? '공개했어요. 이제 성도가 찜할 수 있어요.' : '공개를 멈췄어요.');
    if (lastState) {
      lastState.published = settings.published;
      $('statusText').textContent = statusText(lastState);
    }
  }

  await refresh(true);
}

async function changeMax(delta) {
  if (!lastState) return;
  const next = clamp(lastState.maxPerPerson + delta, 1, 20);
  if (next === lastState.maxPerPerson) return;
  lastState.maxPerPerson = next;
  $('maxValue').textContent = next;
  await saveSettings({ maxPerPerson: next });
}

async function nextSession() {
  if (!store.conn || !isAdmin()) return;
  const count = seats.filter(seat => seat.state === 'taken' || seat.state === 'mine').length;
  if (!await confirmBox('다음 회차로', `지금 예약 ${count}자리를 '지난 예약' 탭으로 옮기고 좌석표를 비워요. 배치도와 공개 상태는 그대로예요. 할까요?`)) return;
  setBusy(true);
  const response = await post(store.conn, store.personId, 'nextSession');
  setBusy(false);
  say(response.ok ? '다음 회차로 넘겼어요.' : response.message || '');
  await refresh(true);
}

function inviteLink() {
  return store.conn ? buildInvite(store.conn.url) : null;
}

async function copyInvite() {
  const link = inviteLink();
  if (!link) {
    say(store.conn && store.conn.url === DEMO_URL ? '체험 모드에서는 초대 링크를 만들 수 없어요.' : '이 연결 주소로는 초대 링크를 만들 수 없어요.');
    return;
  }

  await copyText(buildShareText(link, lastState ? lastState.room : '', connFingerprint), '초대 글을 복사했어요. 카톡 단체방에 붙여 넣으세요.');
}

async function copyText(text, doneText) {
  try {
    await navigator.clipboard.writeText(text);
    say(doneText);
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    say(ok ? doneText : '복사하지 못했어요. 다시 눌러 주세요.');
  }
}

// ───────────── 내 자리 지키기 ─────────────

function myLink() {
  const invite = inviteLink();
  if (!invite) return null;
  return invite + '&k=' + store.personId + (store.name ? '&n=' + encodeURIComponent(store.name) : '');
}

async function copyMyLink() {
  const link = myLink();
  if (!link) {
    say(store.conn && store.conn.url === DEMO_URL ? '체험 모드에서는 내 자리 링크를 만들 수 없어요.' : '이 연결 주소로는 내 자리 링크를 만들 수 없어요.');
    return;
  }
  const room = String(lastState ? lastState.room : '').trim();
  const text = `[${room ? room + ' ' : ''}내 자리 링크]\n나만 갖고 계세요. 이 링크를 누르면 어느 기기에서든 내가 찜한 자리로 들어가요.\n${link}`;
  await copyText(text, "내 자리 링크를 복사했어요. 카톡 '나와의 채팅'이나 메모에 붙여 두세요.");
}

let pinMode = 'set';

function openPinDialog(mode) {
  pinMode = mode;
  const setting = mode === 'set';
  $('pinTitle').textContent = setting ? (hasPin() ? '비밀번호 바꾸기' : '비밀번호 정하기') : '내 자리 되찾기';
  $('pinText').textContent = setting
    ? '기록을 지우거나 기기를 바꿨을 때 이 이름과 비밀번호로 내 자리를 되찾아요. 생일처럼 남이 짐작하기 쉬운 번호는 피해 주세요.'
    : '비밀번호를 정할 때 쓴 이름과 비밀번호를 넣으세요. 그때 찜한 자리가 다시 내 자리로 보여요.';
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
  if (!name) return showPinMessage('이름을 적어 주세요.');
  if (!/^\d{4}$/.test(pin)) return showPinMessage('비밀번호는 숫자 4자리로 적어 주세요.');

  const conn = store.conn;
  $('pinOkButton').disabled = true;
  showPinMessage('보내는 중…');
  const response = await post(conn, store.personId, pinMode === 'set' ? 'setPin' : 'reclaim', { name, pin });
  $('pinOkButton').disabled = false;

  if (!response.ok) {
    showPinMessage(response.error === 'bad-action'
      ? '이 좌석 예약 시트가 아직 옛 판이라 비밀번호를 쓸 수 없어요. 관리자에게 시트를 새 판으로 배포해 달라고 해 주세요.'
      : response.message || '되지 않았어요. 다시 해 주세요.');
    return;
  }
  if (pinMode === 'reclaim' && !PERSON_PATTERN.test(String(response.device || ''))) {
    showPinMessage('답을 읽지 못했어요. 다시 해 주세요.');
    return;
  }

  $('pinDialog').close();

  if (pinMode === 'set') {
    store.pins[conn.url] = true;
    saveStore();
    render();
    say('비밀번호를 정했어요. 이름과 함께 꼭 기억해 두세요.');
    return;
  }

  await adoptPerson(response.device, name, '내 자리를 되찾았어요.');
  if (store.personId === response.device && store.conn === conn) {
    store.pins[conn.url] = true;
    saveStore();
    render();
  }
}

function showQr() {
  const link = inviteLink();
  if (!link) {
    say(store.conn && store.conn.url === DEMO_URL ? '체험 모드에서는 초대 QR 을 만들 수 없어요.' : '이 연결 주소로는 초대 QR 을 만들 수 없어요.');
    return;
  }
  if (typeof window.QRCode !== 'function') {
    say('QR 그리기를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
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
  draft = LayoutDraft.fromSeats(lastState.seats, lastState.floors);
  const position = draft.toFloors().findIndex(floor => floor.f === viewFloorId);
  draft.selectFloor(Math.max(position, 0));
  tool = 'chair';
  $('panToggle').checked = false;
  say(draft.seatCount === 0
    ? '도구를 고르고 칸을 누르거나 끌어서 의자를 그리세요. 장의자는 한 줄로 끌면 한 덩어리가 돼요.'
    : '도구를 고르고 칸을 누르거나 끌어서 고치세요. 다 되면 [저장].');
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
  if (lost > 0 && !await confirmBox('판 줄이기', `판 밖으로 나가는 의자 ${lost}개가 지워져요. 줄일까요?`)) return;
  draft.resize(rows, cols);
  render();
}

function shapePreset(shape, angle) {
  return normalizeShape(shape) === 'grid' ? 'grid' : angle >= 300 ? 'round' : 'fan';
}

async function changeShape(shape, angle) {
  const lost = draft.countLostByShape(shape, angle);
  if (lost > 0 && !await confirmBox('모양 바꾸기', `새 모양에 들어가지 않는 의자 ${lost}개가 지워져요. 바꿀까요?`)) {
    render();
    return;
  }
  draft.setShape(shape, angle);
  render();
}

async function setShapePreset(preset) {
  if (!draft || busy) return;
  const [shape, angle] = preset === 'fan' ? ['arc', FAN_ANGLE] : preset === 'round' ? ['arc', ROUND_ANGLE] : ['grid', 0];
  if (shapePreset(draft.shape, draft.angle) === preset) return;
  await changeShape(shape, angle);
}

async function changeAngle(delta) {
  if (!draft || busy || draft.shape !== 'arc') return;
  const angle = clamp(draft.angle + delta, MIN_ANGLE, MAX_ANGLE);
  if (angle !== draft.angle) await changeShape('arc', angle);
}

function addFloor() {
  if (!draft || busy) return;
  const error = draft.addFloor();
  say(error || `${floorName(draft.current)}을 더했어요. 모양을 고르고 의자를 그리세요.`);
  render();
}

async function removeFloor() {
  if (!draft || busy || draft.floorCount <= 1) return;
  const name = floorName(draft.current);
  if (draft.currentFloorSeatCount > 0 && !await confirmBox('층 지우기', `${name}의 의자 ${draft.currentFloorSeatCount}개가 함께 지워져요. 지울까요?`)) return;
  draft.removeCurrentFloor();
  say(`${name}을 지웠어요. [저장] 해야 반영돼요.`);
  render();
}

async function saveLayoutNow() {
  if (!store.conn || !isAdmin() || !draft || busy) return;
  const newSeats = draft.toSeats();

  if (newSeats.length === 0) {
    say('의자를 하나 이상 그려 주세요.');
    return;
  }

  const taken = lastState ? lastState.taken : [];
  if (taken.length > 0) {
    const kept = new Set(newSeats.filter(seat => !seat.blocked).map(seat => seat.id));
    const lost = taken.filter(item => !kept.has(item.seat)).length;
    if (lost > 0 && !await confirmBox('배치도 저장', `지우거나 비워 두는 자리에 예약이 ${lost}개 있어요. 저장하면 그 예약은 취소돼요(기록 탭에 남아요). 저장할까요?`)) return;
  }

  setBusy(true);
  say('배치도 저장하는 중…');
  const newFloors = draft.toFloors();
  const response = await postLayout(store.conn, store.personId, newSeats, newFloors);
  setBusy(false);

  if (!response.ok) {
    say(response.message || '');
    return;
  }

  viewFloorId = newFloors[clamp(draft.current, 0, newFloors.length - 1)].f;
  viewFloorChosen = true;
  draft = null;
  say(lastState && lastState.published ? '배치도를 저장했어요.' : '배치도를 저장했어요. 다 됐으면 [공개] 를 켜 주세요.');
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
  $('roomName').textContent = (state && state.room) || store.conn.room || '좌석 예약';
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
  $('reservedCount').textContent = open ? `${percent}% 찼어요` : '';

  const phase = !state ? 'loading' : !state.published ? 'off' : state.isOpen ? 'on' : 'closed';
  $('statusChip').textContent = { loading: '불러오는 중', off: '공개 전', on: '예약 중', closed: '예약 시간 아님' }[phase];
  $('statusChip').className = 'chip ' + phase;

  let mineText = '';
  if (state) {
    const shown = new Set(seats.map(seat => seat.id));
    const ghosts = state.taken.filter(item => item.mine && !shown.has(item.seat)).length;
    if (ghosts > 0) {
      const ghostText = `배치도에 없는 자리의 내 예약 ${ghosts}개 — 관리자가 배치도를 한 번 저장하면 정리돼요`;
      mineText = mineText ? mineText + ' · ' + ghostText : ghostText;
    }
  }
  $('mySeats').textContent = mineText;

  $('statusText').textContent = state ? statusText(state) : '불러오는 중…';
  $('statusText').hidden = editing();

  $('adminPanel').hidden = !admin;
  if (admin && state) {
    $('publishedToggle').checked = !!state.published;
    $('showNamesToggle').checked = state.showNames !== false;
    $('maxValue').textContent = state.maxPerPerson;
    $('sessionText').textContent = `${state.session || 1}회차`;
  }
  $('adminControls').hidden = editing();
  $('adminActions').hidden = editing();
  $('editorPanel').hidden = !editing();
  $('guideLink').href = admin ? 'guide.html#admin' : 'guide.html#member';
  $('pinButton').textContent = hasPin() ? '비밀번호 바꾸기' : '비밀번호 정하기';
  $('pinState').textContent = hasPin() ? '이 기기에서 비밀번호를 정해 뒀어요.' : '';
  $('pinState').hidden = !hasPin();

  if (editing()) syncEditorControls();
  buildFloorPanel();
  buildBoard();
}

function syncEditorControls() {
  $('toolPanel').querySelectorAll('.pill').forEach(pill => pill.setAttribute('aria-checked', String(pill.dataset.tool === tool)));
  const preset = shapePreset(draft.shape, draft.angle);
  $('shapePanel').querySelectorAll('.pill').forEach(pill => pill.setAttribute('aria-checked', String(pill.dataset.shape === preset)));
  const isArc = draft.shape === 'arc';
  $('anglePanel').hidden = !isArc;
  $('angleValue').textContent = draft.angle + '°';
  $('colsLabel').textContent = isArc ? '첫 줄 자리' : '칸';
  const floor = draft.floorCount > 1 ? floorName(draft.current) + ' · ' : '';
  $('draftSize').textContent = isArc
    ? `${floor}${draft.rows}줄 · 첫 줄 ${draft.cols}자리 · ${draft.angle}° · 의자 ${draft.seatCount}개`
    : `${floor}판 ${draft.rows}줄 × ${draft.cols}칸 · 의자 ${draft.seatCount}개`;
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
      addPill(floorName(position), position === draft.current, () => {
        if (busy || position === draft.current) return;
        draft.selectFloor(position);
        render();
      });
    }
    const add = addPill('+ 층', false, addFloor);
    add.classList.add('ghosty');
    if (draft.floorCount > 1) addPill(floorName(draft.current) + ' 지우기', false, removeFloor);
    panel.hidden = false;
    return;
  }

  if (floors.length <= 1 || seats.length === 0) {
    panel.hidden = true;
    return;
  }

  floors.forEach((floor, position) => {
    const mine = seats.some(seat => seat.f === floor.f && seat.state === 'mine');
    addPill(floorName(position) + (mine ? ' · 내 자리' : ''), floor.f === viewFloorId, () => {
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

function layOut(geo, cells) {
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

  if (minX > maxX) minX = maxX = minY = maxY = 0;

  offsetX = -minX;
  offsetY = -minY;
  const board = $('board');
  board.style.width = Math.ceil(maxX - minX) + 'px';
  board.style.height = Math.ceil(maxY - minY) + 'px';

  if (geo.isArc) {
    const radius = stageRadius(geo);
    const stage = document.createElement('div');
    stage.className = 'stage' + (isHalfStage(geo) ? ' half' : '');
    stage.textContent = '무대';
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

  if (editing()) buildEditor();
  else buildSeats();

  const hasAnything = editing() || seats.length > 0;
  $('frontBand').hidden = !hasAnything || !geometry || geometry.isArc;
  $('emptyText').hidden = hasAnything;
  $('boardZoom').hidden = !hasAnything;
  updateZoom();
}

function buildSeats() {
  const cells = seats.filter(seat => seat.f === viewFloorId);

  if (cells.length === 0) {
    clearBoard();
    return;
  }

  const floor = floors.find(item => item.f === viewFloorId) || { shape: 'grid', angle: 0, rows: 0, cols: 0 };
  const geo = new SeatGeometry(floor.shape, floor.angle, Math.max(floor.rows, Math.max(...cells.map(seat => seat.r)) + 1), Math.max(floor.cols, 1));
  const shapeKey = 'view:' + floor.f + ':' + geo.isArc + ':' + geo.angle + ':' + geo.cols + ':' +
    cells.map(seat => seat.id + '/' + seat.r + '/' + seat.c + '/' + seat.label + '/' + seat.kind + '/' + seat.bench).join('|');

  if (shapeKey !== builtKey) {
    clearBoard();
    geometry = geo;
    builtKey = shapeKey;
    layOut(geo, cells.map(seat => ({ row: seat.r, col: seat.c })));

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

    const sub = seat.state === 'mine' ? (seat.name || '내 자리')
      : seat.state === 'taken' ? (seat.name || '찜함')
        : seat.kind === 'extra' ? '보조' : '';
    if (sub) {
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = sub;
      txt.appendChild(nm);
    }

    const stateText = { mine: '내 자리', taken: seat.name || '찜함', blocked: '앉을 수 없는 자리', free: '빈자리' }[seat.state];
    const tip = `${kindName(seat.kind)} · ${seat.label} · ${stateText}`;
    button.title = tip;
    button.setAttribute('aria-label', tip);
  }
}

function buildEditor() {
  clearBoard();
  const geo = draft.geometry;
  geometry = geo;
  const all = [];
  for (let row = 0; row < geo.rows; row++) {
    for (let col = 0; col < geo.capacity(row); col++) all.push({ row, col });
  }
  layOut(geo, all);

  const shortKind = { desk: '책상', pew: '장', extra: '보조', chair: '의자' };

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

function onPointerDown(event) {
  if (!editing() || busy || $('panToggle').checked || event.button !== 0) return;
  const cell = cellAt(event, false);
  if (!cell) return;
  dragStart = cell;
  dragEnd = cell;
  $('board').setPointerCapture(event.pointerId);
  event.preventDefault();
  showPreview();
}

function onPointerMove(event) {
  if (!dragStart) return;
  const cell = cellAt(event, true);
  if (cell && (cell.row !== dragEnd.row || cell.col !== dragEnd.col)) {
    dragEnd = cell;
    showPreview();
  }
}

function onPointerUp() {
  if (!dragStart) return;
  const start = dragStart;
  dragStart = null;
  hidePreview();
  applyTool(start.row, start.col, dragEnd.row, dragEnd.col);
}

function onPointerCancel() {
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
  $('demoButton').addEventListener('click', () => {
    $('codeInput').value = 'demo';
    if (!$('nameInput').value.trim()) $('nameInput').value = '체험자';
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
  $('board').addEventListener('lostpointercapture', () => { if (dragStart) onPointerUp(); });

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
  $('pinForm').addEventListener('submit', submitPin);

  $('toolPanel').addEventListener('click', event => {
    const pill = event.target.closest('.pill');
    if (!pill || busy) return;
    tool = pill.dataset.tool;
    syncEditorControls();
  });
  $('shapePanel').addEventListener('click', event => {
    const pill = event.target.closest('[data-shape]');
    if (pill) setShapePreset(pill.dataset.shape);
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
  window.addEventListener('beforeunload', event => {
    if (editing()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

async function start() {
  wire();
  $('nameInput').value = store.name;
  await onConnectionChanged();
  readHash();

  if (store.conn) {
    startTimer();
    await refresh(false);
  }
}

start();
})();
