(() => {
'use strict';
const { DEMO_ADMIN_KEY, t } = window.Jjim;
// 구글 없이 화면을 시험하는 가짜 좌석 예약 서버. 응답 · 오류 문구는 Hagah Tools/seat-reservation/Code.gs 와 같아야 한다.


const STORAGE_KEY = 'jjimkong.demo5';
const SCHEMA_VERSION = 1;
const SEAT_KINDS = ['chair', 'desk', 'pew', 'extra'];
const SEAT_SHAPES = ['grid', 'arc'];
const MAX_FLOORS = 9;
const MAX_NAME_LENGTH = 20;
const MAX_SEATS = 2000;
const ITEM_KINDS = ['pulpit', 'door', 'window', 'ac', 'tv', 'speaker', 'pillar'];
const MAX_ITEMS = 300;
const MAX_WALL_POINTS = 64;

let memory = null;

function userError(code, message) {
  const error = new Error(message);
  error.userFacing = true;
  error.code = code;
  return error;
}

function seed() {
  const rows = 8;
  const cols = 13;
  const aisle = 6;
  const blocked = { r3c3: true, r3c9: true };
  const seats = [];

  for (let r = 0; r < rows; r++) {
    const letter = String.fromCharCode(65 + r);
    let number = 0;

    for (let c = 0; c < cols; c++) {
      if (c === aisle) continue;
      const id = `r${r}c${c}`;
      let kind = 'chair';
      let bench = '';

      if (r === 0 && c >= 1 && c <= 11) {
        kind = 'pew';
        bench = c < aisle ? 'b0L' : 'b0R';
      } else if (r === 0) {
        continue;
      } else if (r === rows - 1 && (c === 0 || c === cols - 1)) {
        kind = 'extra';
      } else if (r >= rows - 2) {
        kind = 'desk';
      }

      number++;
      seats.push({ id, r, c, f: 0, label: letter + number, blocked: blocked[id] === true, kind, bench });
    }
  }

  const at = new Date().toISOString();

  return {
    settings: {
      room: t('찜콩 체험관 (demo)'),
      published: true,
      maxPerPerson: 1,
      showNames: true,
      session: 1,
      layoutVersion: 1,
      floors: [{ f: 0, shape: 'grid', angle: 0, rows: rows + 1, cols }]
    },
    seats,
    items: [
      { f: 0, kind: 'tv', x: 403, y: -100, a: 0 },
      { f: 0, kind: 'speaker', x: 110, y: -64, a: 0 },
      { f: 0, kind: 'speaker', x: 696, y: -64, a: 0 },
      { f: 0, kind: 'pillar', x: 403, y: 175, a: 0 },
      { f: 0, kind: 'ac', x: -16, y: 140, a: 90 },
      { f: 0, kind: 'window', x: -16, y: 270, a: 90 },
      { f: 0, kind: 'window', x: 822, y: 150, a: 90 },
      { f: 0, kind: 'window', x: 822, y: 300, a: 90 },
      { f: 0, kind: 'door', x: 37, y: 423, a: 39 },
      { f: 0, kind: 'door', x: 640, y: 466, a: 0 },
      { f: 0, kind: 'door', x: 740, y: 466, a: 0 }
    ],
    walls: [{ f: 0, points: [[-16, -100], [822, -100], [822, 466], [90, 466], [-16, 380]] }],
    reservations: [
      { seat: 'r0c2', device: 'demo-other-1', name: '김믿음', at },
      { seat: 'r2c8', device: 'demo-other-2', name: '이소망', at },
      { seat: 'r4c4', device: 'demo-other-3', name: '박사랑', at }
    ],
    past: []
  };
}

function load() {
  try {
    const text = globalThis.localStorage && globalThis.localStorage.getItem(STORAGE_KEY);
    if (text) {
      const parsed = JSON.parse(text);
      if (parsed && parsed.settings && Array.isArray(parsed.seats) && Array.isArray(parsed.reservations)) {
        if (!Array.isArray(parsed.past)) parsed.past = [];
        memory = parsed;
        return memory;
      }
    }
  } catch (e) {
  }
  if (!memory) {
    memory = seed();
    save(memory);
  }
  return memory;
}

function save(state) {
  memory = state;
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
  }
}

function formatTime(value) {
  const time = value ? new Date(value) : null;
  if (!time || isNaN(time.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const offset = -time.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function toInt(value, fallback) {
  const number = parseInt(value, 10);
  return isNaN(number) ? fallback : number;
}

function toPositiveInt(value, fallback) {
  const number = toInt(value, fallback);
  return number < 0 ? fallback : number;
}

function sliceChars(text, count) {
  return Array.from(String(text || '')).slice(0, count).join('');
}

function plainName(value) {
  return String(value || '').replace(/^'/, '').trim();
}

function cleanDevice(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(text) ? text : '';
}

function cleanName(value) {
  const text = sliceChars(String(value || '').replace(/[\r\n\t]/g, ' ').trim(), MAX_NAME_LENGTH).trim();
  if (!text) throw userError('no-name', '이름을 먼저 적어 주세요.');
  return text;
}

function readMaxPerPerson(settings) {
  return clampMaxPerPerson(settings.maxPerPerson);
}

function clampMaxPerPerson(value) {
  const number = toInt(value, 1);
  return number === 0 ? 0 : Math.min(Math.max(number, 1), 20);
}

function requireDevice(device) {
  if (!device) throw userError('bad-request', '기기 정보가 없습니다. 앱을 다시 켜 주세요.');
}

function requireOpen(settings, isAdmin) {
  if (isAdmin) return;
  if (settings.published !== true) throw userError('not-published', '아직 예약을 받지 않아요.');
}

function findSeat(state, seatId) {
  const seat = state.seats.find(s => s.id === seatId);
  if (!seat) throw userError('no-seat', '배치도가 바뀌었어요. 좌석표를 새로 불러올게요.');
  if (seat.blocked) throw userError('blocked', '비워 둔 자리라 예약할 수 없어요.');
  return seat;
}

function findReservation(state, seatId) {
  return state.reservations.find(r => r.seat === seatId) || null;
}

function cleanFloors(rawFloors) {
  if (!Array.isArray(rawFloors)) return [];
  if (rawFloors.length > MAX_FLOORS) throw userError('too-many', '층은 ' + MAX_FLOORS + '개까지 만들 수 있습니다.');

  const seen = {};
  return rawFloors.map(raw => {
    const id = toInt(raw && raw.f, -1);
    if (id < 0 || id > 99 || seen[id]) throw userError('bad-request', '층 모양을 읽지 못했습니다.');
    seen[id] = true;
    const shape = SEAT_SHAPES.indexOf(String(raw.shape || '')) >= 0 ? String(raw.shape) : 'grid';
    const floor = {
      f: id,
      shape,
      angle: shape === 'arc' ? Math.min(Math.max(toInt(raw.angle, 120), 30), 360) : 0,
      rows: Math.min(Math.max(toInt(raw.rows, 12), 1), 99),
      cols: Math.min(Math.max(toInt(raw.cols, 16), 1), 99)
    };
    if (shape === 'grid' && (raw.stage === 'rows' || raw.stage === 'none')) floor.stage = raw.stage;
    if (shape === 'grid' && raw.stage === 'custom') {
      const sl = Math.min(Math.max(toInt(raw.sl, 0), -20000), 20000);
      const sr = Math.min(Math.max(toInt(raw.sr, 0), -20000), 20000);
      if (sr - sl >= 20) Object.assign(floor, { stage: 'custom', sl, sr });
    }
    return floor;
  });
}

function buildState(state, device, isAdmin) {
  const settings = state.settings;
  const published = settings.published === true;
  const result = {
    ok: true,
    admin: isAdmin,
    room: String(settings.room || ''),
    published,
    maxPerPerson: readMaxPerPerson(settings),
    canUnlimit: true,
    showNames: settings.showNames !== false,
    opensAt: '',
    closesAt: '',
    isOpen: true,
    session: toPositiveInt(settings.session, 1),
    layoutVersion: toPositiveInt(settings.layoutVersion, 0),
    seats: [],
    floors: [],
    items: [],
    walls: [],
    taken: []
  };

  if (!published && !isAdmin) return result;

  result.seats = state.seats.map(s => ({ id: s.id, r: s.r, c: s.c, f: s.f, label: s.label, blocked: s.blocked, kind: s.kind, bench: s.bench }));
  result.floors = Array.isArray(settings.floors) ? settings.floors.map(f => ({ ...f })) : [];
  result.items = Array.isArray(state.items) ? state.items.map(item => ({ ...item })) : [];
  result.walls = Array.isArray(state.walls) ? state.walls.map(wall => ({ f: wall.f, points: wall.points.map(p => p.slice()) })) : [];
  result.taken = state.reservations.map(r => {
    const mine = device !== '' && r.device === device;
    const item = { seat: r.seat, mine };
    if (mine || isAdmin || result.showNames) item.name = r.name;
    if (isAdmin) item.at = formatTime(r.at);
    return item;
  });

  return result;
}

function reserve(state, device, rawName, seatId, isAdmin) {
  requireDevice(device);
  const name = uniqueName(state, device, cleanName(rawName));
  requireOpen(state.settings, isAdmin);

  const seat = findSeat(state, seatId);
  const existing = findReservation(state, seatId);

  if (existing) {
    if (existing.device === device) return { ok: true, seat: seat.id, name };
    throw userError('taken', '그 사이 다른 분이 먼저 잡았어요. 다른 자리를 골라 주세요.');
  }

  const mineCount = state.reservations.filter(r => r.device === device).length;
  const max = readMaxPerPerson(state.settings);

  if (max > 0 && mineCount >= max) {
    throw userError('limit', max === 1
      ? '이미 자리를 잡으셨어요. 자리를 바꾸려면 내 자리를 먼저 누르세요.'
      : '한 사람이 ' + max + '자리까지 잡을 수 있어요.');
  }

  state.reservations.push({ seat: seat.id, device, name, at: new Date().toISOString() });
  save(state);
  return { ok: true, seat: seat.id, name };
}

function move(state, device, rawName, fromSeatId, toSeatId, isAdmin) {
  requireDevice(device);
  const name = uniqueName(state, device, cleanName(rawName));
  requireOpen(state.settings, isAdmin);

  const seat = findSeat(state, toSeatId);
  const mine = findReservation(state, fromSeatId);

  if (!mine || mine.device !== device) throw userError('not-mine', '내 자리만 바꿀 수 있어요. 좌석표를 새로 불러올게요.');
  if (fromSeatId === toSeatId) return { ok: true, seat: seat.id, name };

  const target = findReservation(state, toSeatId);
  if (target) {
    throw target.device === device
      ? userError('already-mine', '이미 잡으신 자리예요. 좌석표를 새로 불러올게요.')
      : userError('taken', '그 사이 다른 분이 먼저 잡았어요. 다른 자리를 골라 주세요.');
  }

  mine.seat = seat.id;
  mine.name = name;
  mine.at = new Date().toISOString();
  save(state);
  return { ok: true, seat: seat.id, name };
}

function cancel(state, device, seatId) {
  requireDevice(device);
  const reservation = findReservation(state, seatId);
  if (!reservation) return { ok: true };
  if (reservation.device !== device) throw userError('not-mine', '내 자리만 취소할 수 있어요.');

  state.reservations = state.reservations.filter(r => r !== reservation);
  save(state);
  return { ok: true };
}

function rename(state, device, rawName) {
  requireDevice(device);
  const name = uniqueName(state, device, cleanName(rawName));
  state.reservations.forEach(r => { if (r.device === device) r.name = name; });
  const pinNames = state.pinNames || {};
  const oldKey = Object.keys(pinNames).find(key => pinNames[key] === device);
  const pinCleared = !!oldKey && oldKey !== nameKey(name);
  if (pinCleared) {
    delete pinNames[oldKey];
    for (const other of Object.keys(state.pins || {})) if (state.pins[other] === device) delete state.pins[other];
  }
  save(state);
  return pinCleared ? { ok: true, name, pinCleared } : { ok: true, name };
}

function requirePin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw userError('bad-pin', '비밀번호는 숫자 4자리로 적어 주세요.');
}

const NAME_LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';

function nameKey(name) {
  return plainName(name).replace(/\s+/g, '').toLowerCase();
}

function uniqueName(state, device, name) {
  const taken = {};
  state.reservations.forEach(r => { if (r.device !== device) taken[nameKey(r.name)] = true; });
  const owners = state.pinNames || {};
  const used = candidate => taken[nameKey(candidate)] || (!!owners[nameKey(candidate)] && owners[nameKey(candidate)] !== device);
  if (!used(name)) return name;
  for (const letter of NAME_LETTERS) {
    const candidate = sliceChars(name, MAX_NAME_LENGTH - 1).trim() + letter;
    if (!used(candidate)) return candidate;
  }
  throw userError('name-full', '같은 이름이 너무 많아요. 이름을 조금 다르게 적어 주세요.');
}

function pinKey(name, pin) {
  return plainName(name).replace(/\s+/g, '').toLowerCase() + '|' + pin;
}

function setPin(state, device, rawName, pin) {
  requireDevice(device);
  const name = uniqueName(state, device, cleanName(rawName));
  requirePin(pin);
  state.pins = state.pins || {};
  const key = pinKey(name, pin);
  if (state.pins[key] && state.pins[key] !== device) throw userError('pin-used', '같은 이름에 같은 비밀번호를 쓰는 분이 있어요. 다른 번호를 골라 주세요.');
  for (const other of Object.keys(state.pins)) if (state.pins[other] === device) delete state.pins[other];
  state.pins[key] = device;
  state.pinNames = state.pinNames || {};
  for (const other of Object.keys(state.pinNames)) if (state.pinNames[other] === device) delete state.pinNames[other];
  state.pinNames[nameKey(name)] = device;
  save(state);
  return { ok: true, name };
}

function reclaim(state, rawName, pin) {
  const name = cleanName(rawName);
  requirePin(pin);
  const device = (state.pins || {})[pinKey(name, pin)];
  if (!device) throw userError('pin-wrong', '이름이나 비밀번호가 맞지 않아요. 비밀번호를 정할 때 쓴 이름 그대로 적어 주세요.');
  return { ok: true, device };
}

function cleanItems(rawItems, floors) {
  if (rawItems.length > MAX_ITEMS) throw userError('too-many', '물건은 ' + MAX_ITEMS + '개까지 그릴 수 있습니다.');
  const floorIds = {};
  floors.forEach(floor => { floorIds[floor.f] = true; });
  return rawItems.map(raw => {
    const item = { f: toInt(raw && raw.f, -1), kind: String((raw && raw.kind) || ''), x: Number(raw && raw.x), y: Number(raw && raw.y), a: Number((raw && raw.a) || 0) };
    if (item.f < 0 || item.f > 99 || ITEM_KINDS.indexOf(item.kind) < 0 || (floors.length > 0 && !floorIds[item.f]) ||
      !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.a) || Math.abs(item.x) > 20000 || Math.abs(item.y) > 20000) {
      throw userError('bad-request', '배치도의 물건을 읽지 못했습니다.');
    }
    return { f: item.f, kind: item.kind, x: Math.round(item.x), y: Math.round(item.y), a: Math.round(item.a) % 360 };
  });
}

function cleanWalls(rawWalls, floors) {
  const floorIds = {};
  floors.forEach(floor => { floorIds[floor.f] = true; });
  const seen = {};
  return rawWalls.map(raw => {
    const f = toInt(raw && raw.f, -1);
    const points = Array.isArray(raw && raw.points) ? raw.points.map(p => {
      const x = Number(Array.isArray(p) ? p[0] : NaN);
      const y = Number(Array.isArray(p) ? p[1] : NaN);
      return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 20000 && Math.abs(y) <= 20000 ? [Math.round(x), Math.round(y)] : null;
    }) : [];
    if (f < 0 || f > 99 || seen[f] || (floors.length > 0 && !floorIds[f]) || points.length < 3 || points.length > MAX_WALL_POINTS || points.includes(null)) {
      throw userError('bad-request', '외벽을 읽지 못했습니다.');
    }
    seen[f] = true;
    return { f, points };
  });
}

function saveLayout(state, rawSeats, rawFloors, rawItems, rawWalls) {
  if (!Array.isArray(rawSeats)) throw userError('bad-request', '배치도를 읽지 못했습니다.');
  if (rawSeats.length > MAX_SEATS) throw userError('too-many', '좌석은 ' + MAX_SEATS + '개까지 만들 수 있습니다.');

  const floors = cleanFloors(rawFloors);
  const floorIds = {};
  floors.forEach(floor => { floorIds[floor.f] = true; });

  const seen = {};
  const seats = rawSeats.map(raw => {
    const id = String(raw.id || '').trim();
    const r = toInt(raw.r, -1);
    const c = toInt(raw.c, -1);
    const f = toInt(raw.f, 0);

    if (!/^[A-Za-z0-9_-]{1,16}$/.test(id) || r < 0 || c < 0 || r > 99 || c > 99 || f < 0 || f > 99) {
      throw userError('bad-request', '배치도에 잘못된 자리가 있습니다: ' + id);
    }
    if (seen[id]) throw userError('bad-request', '같은 좌석ID 가 두 번 있습니다: ' + id);

    seen[id] = true;
    const kind = SEAT_KINDS.indexOf(String(raw.kind || '')) >= 0 ? String(raw.kind) : 'chair';
    const bench = kind === 'pew' && /^[A-Za-z0-9_-]{1,16}$/.test(String(raw.bench || '')) ? String(raw.bench) : '';

    if (floors.length > 0 && !floorIds[f]) throw userError('bad-request', '없는 층의 자리가 있습니다: ' + id);

    return { id, r, c, f, label: sliceChars(String(raw.label || id), 8), blocked: raw.blocked === true, kind, bench };
  });

  const blocked = {};
  seats.forEach(s => { if (s.blocked) blocked[s.id] = true; });

  state.seats = seats;
  state.reservations = state.reservations.filter(r => seen[r.seat] && !blocked[r.seat]);
  state.settings.floors = floors;
  if (Array.isArray(rawItems)) state.items = cleanItems(rawItems, floors);
  if (Array.isArray(rawWalls)) state.walls = cleanWalls(rawWalls, floors);
  state.settings.layoutVersion = toPositiveInt(state.settings.layoutVersion, 0) + 1;
  save(state);
  return { ok: true, count: seats.length };
}

function saveSettings(state, settings) {
  const target = state.settings;
  if (settings.published !== undefined) target.published = settings.published === true;
  if (settings.maxPerPerson !== undefined) target.maxPerPerson = clampMaxPerPerson(settings.maxPerPerson);
  if (settings.showNames !== undefined) target.showNames = settings.showNames === true;
  if (settings.room !== undefined) target.room = String(settings.room).trim().slice(0, 40);
  save(state);
  return { ok: true };
}

function forceCancel(state, seatId, expectedName) {
  const reservation = findReservation(state, seatId);

  if (reservation && expectedName !== undefined && expectedName !== null
      && plainName(reservation.name) !== plainName(expectedName)) {
    throw userError('changed', '그 사이 예약한 분이 바뀌었어요. 좌석표를 새로 불러올게요.');
  }

  if (reservation) {
    state.reservations = state.reservations.filter(r => r !== reservation);
    save(state);
  }
  return { ok: true };
}

function nextSession(state) {
  const session = toPositiveInt(state.settings.session, 1);
  const moved = state.reservations.length;
  const now = new Date().toISOString();

  state.reservations.forEach(r => state.past.push({ session, seat: r.seat, name: r.name, at: r.at, movedAt: now }));
  state.reservations = [];
  state.settings.session = session + 1;
  save(state);
  return { ok: true, session: session + 1, moved };
}

function handle(request) {
  const state = load();
  const action = String(request.action || '');
  const device = cleanDevice(request.device);
  const isAdmin = typeof request.admin === 'string' && request.admin === DEMO_ADMIN_KEY;

  switch (action) {
    case 'state': return buildState(state, device, isAdmin);
    case 'reserve': return reserve(state, device, request.name, String(request.seat || ''), isAdmin);
    case 'move': return move(state, device, request.name, String(request.from || ''), String(request.seat || ''), isAdmin);
    case 'cancel': return cancel(state, device, String(request.seat || ''));
    case 'rename': return rename(state, device, request.name);
    case 'setPin': return setPin(state, device, request.name, request.pin);
    case 'reclaim': return reclaim(state, request.name, request.pin);
  }

  if (!isAdmin) throw userError('not-admin', '관리자만 할 수 있습니다. 관리자 QR 로 다시 연결해 주세요.');

  switch (action) {
    case 'saveLayout': return saveLayout(state, request.seats, request.floors, request.items, request.walls);
    case 'saveSettings': return saveSettings(state, request.settings || {});
    case 'forceCancel': return forceCancel(state, String(request.seat || ''), request.name);
    case 'nextSession': return nextSession(state);
  }

  throw userError('bad-action', '모르는 요청입니다. 앱을 최신 판으로 올려 주세요.');
}

function handleDemo(body) {
  let result;
  try {
    result = handle(body && typeof body === 'object' ? body : {});
  } catch (error) {
    result = error && error.userFacing
      ? { ok: false, error: error.code, message: error.message }
      : { ok: false, error: 'server', message: '서버에서 문제가 생겼습니다. 잠시 뒤 다시 해 주세요.' };
  }
  result.schema = SCHEMA_VERSION;
  return result;
}
Object.assign(window.Jjim = window.Jjim || {}, { handleDemo });
})();
