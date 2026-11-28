var SCHEMA_VERSION = 1;

var TAB_SETTINGS = '설정';
var TAB_SEATS = '좌석';
var TAB_RESERVATIONS = '예약';
var TAB_PAST = '지난 예약';
var TAB_LOG = '기록';

var HEADERS = {};
HEADERS[TAB_SETTINGS] = ['항목', '값', '설명'];
HEADERS[TAB_SEATS] = ['좌석ID', '줄', '칸', '이름표', '비워둠', '종류', '장의자', '층'];
HEADERS[TAB_RESERVATIONS] = ['좌석ID', '기기ID', '이름', '시각'];
HEADERS[TAB_PAST] = ['회차', '좌석ID', '이름', '시각', '넘긴 시각'];
HEADERS[TAB_LOG] = ['시각', '일', '좌석ID', '이름', '기기'];

var KEY_ROOM = '강의실';
var KEY_PUBLISHED = '공개';
var KEY_MAX_PER_PERSON = '1인 최대';
var KEY_SHOW_NAMES = '이름 보이기';
var KEY_OPENS_AT = '여는 시각';
var KEY_CLOSES_AT = '닫는 시각';
var KEY_SESSION = '회차';
var KEY_LAYOUT_VERSION = '배치판';
var KEY_FLOORS = '층 모양';
var KEY_ITEMS = '배치 물건';
var KEY_WALLS = '외벽';

var DEFAULT_SETTINGS = [
  [KEY_ROOM, '', '찜콩 위쪽에 보이는 이름'],
  [KEY_PUBLISHED, false, 'TRUE 면 유저에게 좌석표가 보이고 예약을 받는다'],
  [KEY_MAX_PER_PERSON, 1, '한 기기가 잡을 수 있는 자리 수(가족 몫까지 잡게 하려면 늘린다)'],
  [KEY_SHOW_NAMES, true, 'FALSE 면 유저에게는 "예약됨" 만 보인다(관리자는 늘 이름이 보인다)'],
  [KEY_OPENS_AT, '', '비워 두면 공개하자마자 예약. 예: 2026-12-01 21:00'],
  [KEY_CLOSES_AT, '', '비워 두면 닫지 않는다'],
  [KEY_SESSION, 1, '다음 회차로 넘길 때마다 1씩 오른다'],
  [KEY_LAYOUT_VERSION, 0, '배치도를 저장할 때마다 오른다(시트에서 바뀐 횟수를 보는 용도)'],
  [KEY_FLOORS, '', '층마다 모양(네모 · 부채꼴 · 원형). 찜콩 배치도 화면이 적는다 — 손대지 말 것'],
  [KEY_ITEMS, '', '출입문 · 에어컨 · TV 같은 물건 자리. 찜콩 배치도 화면이 적는다 — 손대지 말 것'],
  [KEY_WALLS, '', '층마다 외벽 꼭짓점. 찜콩 배치도 화면이 적는다 — 손대지 말 것']
];

var ITEM_KINDS = ['pulpit', 'door', 'window', 'ac', 'tv', 'speaker', 'pillar'];
var MAX_ITEMS = 300;
var MAX_WALL_POINTS = 64;

var SEAT_KINDS = ['chair', 'desk', 'pew', 'extra'];

var SEAT_SHAPES = ['grid', 'arc'];
var MAX_FLOORS = 9;

var MAX_NAME_LENGTH = 20;
var MAX_SEATS = 2000;
var LOG_KEEP_DAYS = 365;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('좌석 예약')
    .addItem('1. 처음 설정 시작', 'menuSetup')
    .addItem('2. 연결 QR 보기', 'menuShowQr')
    .addSeparator()
    .addItem('웹 앱 주소 다시 넣기', 'menuSetWebAppUrl')
    .addItem('관리자 키 새로 만들기', 'menuResetAdminKey')
    .addToUi();
}

function menuSetup() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('좌석 예약 처음 설정', '강의실 이름을 넣어 주세요. (예: 본당 2층 교육관)', ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  var roomName = String(response.getResponseText() || '').trim() || '강의실';

  ensureTabs();
  writeSetting(KEY_ROOM, roomName);

  var properties = PropertiesService.getScriptProperties();

  if (!properties.getProperty('ADMIN_KEY')) {
    properties.setProperty('ADMIN_KEY', newKey());
  }

  ui.alert(
    '설정이 끝났습니다',
    '이제 웹 앱으로 배포해 주세요.\n\n' +
      '[확장 프로그램] → [Apps Script] → [배포] → [새 배포] → 유형 [웹 앱]\n' +
      '  · 실행 계정: 나\n' +
      '  · 액세스 권한: 모든 사용자\n\n' +
      '마지막 [배포] 단추까지 누르면 "웹 앱 URL" 이 나옵니다. [복사] 해 두세요.\n\n' +
      '그다음 [좌석 예약] → [2. 연결 QR 보기] 를 누르고, 묻는 칸에 그 URL 을 붙여 넣으세요.',
    ui.ButtonSet.OK);
}

var WEBAPP_URL_PATTERN = /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.\-]+|macros)\/s\/[A-Za-z0-9_\-]{10,}\/exec$/;

function menuShowQr() {
  var ui = SpreadsheetApp.getUi();
  var properties = PropertiesService.getScriptProperties();
  var adminKey = properties.getProperty('ADMIN_KEY');

  if (!adminKey) {
    ui.alert('먼저 [1. 처음 설정 시작] 을 눌러 주세요.');
    return;
  }

  var url = properties.getProperty('WEBAPP_URL') || askWebAppUrl();

  if (!url) {
    return;
  }

  var template = HtmlService.createTemplate(QR_DIALOG_HTML);
  template.memberCode = jjimkongInvite(url);
  template.adminCode = url + '#admin=' + adminKey;
  template.roomName = readSettings()[KEY_ROOM] || '강의실';

  ui.showModalDialog(template.evaluate().setWidth(620).setHeight(560), '좌석 예약 연결 QR');
}

function menuSetWebAppUrl() {
  if (askWebAppUrl()) {
    SpreadsheetApp.getUi().alert('웹 앱 주소를 바꿨습니다. [2. 연결 QR 보기] 의 QR 을 다시 나눠 주세요.');
  }
}

function askWebAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    '웹 앱 주소 넣기',
    '[확장 프로그램] → [Apps Script] → 오른쪽 위 [배포] → [배포 관리] 에서\n' +
      '웹 앱 URL 을 [복사] 해 붙여 넣어 주세요.\n' +
      '(https://script.google.com/macros/s/…/exec 꼴. 아직 배포하지 않았다면 [배포] → [새 배포] → [웹 앱] 부터)',
    ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() !== ui.Button.OK) {
    return null;
  }

  var url = String(response.getResponseText() || '').trim().replace(/\?.*$/, '').replace(/\/+$/, '');

  if (!WEBAPP_URL_PATTERN.test(url)) {
    ui.alert('웹 앱 주소가 아닙니다. /exec 로 끝나는 주소를 [배포 관리] 에서 복사해 주세요.\n(/dev 로 끝나는 시험 주소는 유저가 쓸 수 없습니다.)');
    return null;
  }

  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
  return url;
}

function menuResetAdminKey() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    '관리자 키 새로 만들기',
    '지금까지 연결한 관리자 기기는 모두 관리자 기능을 잃습니다(유저 연결은 그대로).\n관리자 QR 을 잃어버렸거나 남에게 넘어갔을 때만 하세요. 계속할까요?',
    ui.ButtonSet.YES_NO);

  if (answer !== ui.Button.YES) {
    return;
  }

  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', newKey());
  ui.alert('새 관리자 키를 만들었습니다. [2. 연결 QR 보기] 에서 관리자 QR 을 다시 찍어 주세요.');
}

var QR_DIALOG_HTML =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
  '<style>body{font-family:sans-serif;margin:8px;color:#222}.row{display:flex;gap:24px}.box{flex:1}' +
  'h3{margin:4px 0 6px;font-size:15px}.qr{width:220px;height:220px;margin:6px 0}' +
  'textarea{width:100%;height:58px;font-size:11px}p{font-size:12px;color:#555;margin:4px 0}' +
  '.warn{color:#b00020}</style></head><body>' +
  '<p><b><?= roomName ?></b></p><div class="row">' +
  '<div class="box"><h3>유저용</h3><div id="m" class="qr"></div>' +
  '<p>휴대폰 카메라로 찍으면 찜콩이 열립니다. 인쇄하거나 단체방에 올리세요.</p>' +
  '<textarea readonly onclick="this.select()"><?= memberCode ?></textarea></div>' +
  '<div class="box"><h3>관리자용</h3><div id="a" class="qr"></div>' +
  '<p>찜콩을 열고 연결 칸에 아래 글을 붙여 넣으세요.</p>' +
  '<p class="warn">남에게 보여 주지 마세요. 이 글로 연결한 기기는 배치도 · 공개 · 강제 취소를 할 수 있습니다.</p>' +
  '<textarea readonly onclick="this.select()"><?= adminCode ?></textarea></div></div>' +
  '<script>new QRCode(document.getElementById("m"),{text:<?!= JSON.stringify(memberCode) ?>,width:220,height:220});' +
  'new QRCode(document.getElementById("a"),{text:<?!= JSON.stringify(adminCode) ?>,width:220,height:220});</script>' +
  '</body></html>';

var JJIMKONG_URL = 'https://antcraft159.github.io/Jjimkong/';
var WEBAPP_URL_PARTS = /^https:\/\/script\.google\.com\/(?:a\/macros\/([A-Za-z0-9.\-]+)|macros)\/s\/([A-Za-z0-9_\-]{10,})\/exec$/;

function jjimkongInvite(url) {
  var match = WEBAPP_URL_PARTS.exec(String(url || ''));
  return match ? JJIMKONG_URL + '#s=' + match[2] + (match[1] ? '&d=' + match[1] : '') : JJIMKONG_URL;
}

function doGet() {
  var link = jjimkongInvite(PropertiesService.getScriptProperties().getProperty('WEBAPP_URL'));
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font-family:sans-serif;padding:24px;line-height:1.6">' +
      '<h2>좌석 예약</h2><p>좌석 예약은 <b>찜콩</b>에서 해요.</p>' +
      '<p><a href="' + link + '" target="_top" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#16a34a;color:#fff;text-decoration:none;font-weight:bold">찜콩 열기</a></p></div>')
    .setTitle('좌석 예약');
}

function doPost(e) {
  var request;

  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseError) {
    return reply({ ok: false, error: 'bad-request', message: '요청을 읽지 못했습니다.' });
  }

  try {
    return reply(handle(request));
  } catch (error) {
    if (error && error.userFacing) {
      return reply({ ok: false, error: error.code, message: error.message });
    }

    console.error(error);
    return reply({ ok: false, error: 'server', message: '서버에서 문제가 생겼습니다. 잠시 뒤 다시 해 주세요.' });
  }
}

function reply(body) {
  body.schema = SCHEMA_VERSION;
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function handle(request) {
  var action = String(request.action || '');
  var device = cleanDevice(request.device);
  var isAdmin = checkAdmin(request.admin);

  if (isAdmin && action === 'state') {
    syncTimeZone(request.tz);
  }

  switch (action) {
    case 'state':
      return buildState(device, isAdmin, String(request.layoutKey || ''));
    case 'reserve':
      return withLock(function () { return reserve(device, request.name, String(request.seat || ''), isAdmin); });
    case 'move':
      return withLock(function () { return move(device, request.name, String(request.from || ''), String(request.seat || ''), isAdmin); });
    case 'cancel':
      return withLock(function () { return cancel(device, String(request.seat || '')); });
    case 'rename':
      return withLock(function () { return rename(device, request.name); });
    case 'setPin':
      return withLock(function () { return setPin(device, request.name, request.pin); });
    case 'reclaim':
      return withLock(function () { return reclaim(request.name, request.pin); });
  }

  if (!isAdmin) {
    throw userError('not-admin', '관리자만 할 수 있습니다. 관리자 QR 로 다시 연결해 주세요.');
  }

  switch (action) {
    case 'saveLayout':
      return withLock(function () { return saveLayout(request.seats, request.floors, request.items, request.walls); });
    case 'saveSettings':
      return withLock(function () { return saveSettings(request.settings || {}); });
    case 'forceCancel':
      return withLock(function () { return forceCancel(String(request.seat || ''), request.name); });
    case 'nextSession':
      return withLock(function () { return nextSession(); });
  }

  throw userError('bad-action', '모르는 요청입니다. 앱을 최신 판으로 올려 주세요.');
}

function buildState(device, isAdmin, knownLayoutKey) {
  var settings = readSettings();
  var published = settings[KEY_PUBLISHED] === true;
  var result = {
    ok: true,
    admin: isAdmin,
    room: String(settings[KEY_ROOM] || ''),
    published: published,
    maxPerPerson: readMaxPerPerson(settings),
    canUnlimit: true,
    showNames: settings[KEY_SHOW_NAMES] !== false,
    opensAt: formatTime(settings[KEY_OPENS_AT]),
    closesAt: formatTime(settings[KEY_CLOSES_AT]),
    isOpen: isWithinWindow(settings),
    session: toPositiveInt(settings[KEY_SESSION], 1),
    layoutVersion: toPositiveInt(settings[KEY_LAYOUT_VERSION], 0),
    seats: [],
    floors: [],
    items: [],
    walls: [],
    taken: []
  };

  if (!published && !isAdmin) {
    return result;
  }

  var seats = readSeats().map(function (seat) {
    return { id: seat.id, r: seat.row, c: seat.col, f: seat.floor, label: seat.label, blocked: seat.blocked, kind: seat.kind, bench: seat.bench };
  });
  var floors = readFloors(settings);
  var items = readItems(settings);
  var walls = readWalls(settings);
  result.layoutKey = layoutKey(result.layoutVersion, seats, floors, items, walls);

  if (knownLayoutKey !== '' && knownLayoutKey === result.layoutKey) {
    result.layoutSame = true;
  } else {
    result.seats = seats;
    result.floors = floors;
    result.items = items;
    result.walls = walls;
  }

  result.taken = readReservations().map(function (reservation) {
    var mine = device !== '' && reservation.device === device;
    var item = { seat: reservation.seat, mine: mine };

    if (mine || isAdmin || result.showNames) {
      item.name = reservation.name;
    }

    if (isAdmin) {
      item.at = formatTime(reservation.at);
    }

    return item;
  });

  return result;
}

function layoutKey(version, seats, floors, items, walls) {
  var extra = (items && items.length > 0) || (walls && walls.length > 0);
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    JSON.stringify(extra ? [seats, floors, items, walls] : [seats, floors]),
    Utilities.Charset.UTF_8);
  return version + '.' + Utilities.base64EncodeWebSafe(digest).substring(0, 16);
}

function reserve(device, rawName, seatId, isAdmin) {
  requireDevice(device);
  var settings = readSettings();

  requireOpen(settings, isAdmin);

  var seat = findSeat(seatId);
  var reservations = readReservations();
  var name = uniqueName(device, cleanName(rawName), reservations);
  var existing = findReservation(reservations, seatId);

  if (existing) {
    if (existing.device === device) {
      return { ok: true, seat: seat.id, name: name };
    }

    throw userError('taken', '그 사이 다른 분이 먼저 잡았어요. 다른 자리를 골라 주세요.');
  }

  var mineCount = reservations.filter(function (r) { return r.device === device; }).length;
  var max = readMaxPerPerson(settings);

  if (max > 0 && mineCount >= max) {
    throw userError('limit', max === 1
      ? '이미 자리를 잡으셨어요. 자리를 바꾸려면 내 자리를 먼저 누르세요.'
      : '한 사람이 ' + max + '자리까지 잡을 수 있어요.');
  }

  sheet(TAB_RESERVATIONS).appendRow([seat.id, device, safeCell(name), new Date()]);
  log('예약', seat.id, name, device);

  return { ok: true, seat: seat.id, name: name };
}

function move(device, rawName, fromSeatId, toSeatId, isAdmin) {
  requireDevice(device);
  var settings = readSettings();

  requireOpen(settings, isAdmin);

  var seat = findSeat(toSeatId);
  var reservations = readReservations();
  var name = uniqueName(device, cleanName(rawName), reservations);
  var mine = findReservation(reservations, fromSeatId);

  if (!mine || mine.device !== device) {
    throw userError('not-mine', '내 자리만 바꿀 수 있어요. 좌석표를 새로 불러올게요.');
  }

  if (fromSeatId === toSeatId) {
    return { ok: true, seat: seat.id, name: name };
  }

  var target = findReservation(reservations, toSeatId);

  if (target) {
    throw target.device === device
      ? userError('already-mine', '이미 잡으신 자리예요. 좌석표를 새로 불러올게요.')
      : userError('taken', '그 사이 다른 분이 먼저 잡았어요. 다른 자리를 골라 주세요.');
  }

  var tab = sheet(TAB_RESERVATIONS);
  tab.getRange(mine.rowNumber, 1, 1, 4).setValues([[seat.id, device, safeCell(name), new Date()]]);
  log('바꿈 ' + fromSeatId + '→', seat.id, name, device);

  return { ok: true, seat: seat.id, name: name };
}

function cancel(device, seatId) {
  requireDevice(device);

  var reservation = findReservation(readReservations(), seatId);

  if (!reservation) {
    return { ok: true };
  }

  if (reservation.device !== device) {
    throw userError('not-mine', '내 자리만 취소할 수 있어요.');
  }

  removeRow(sheet(TAB_RESERVATIONS), reservation.rowNumber);
  log('취소', seatId, reservation.name, device);

  return { ok: true };
}

function rename(device, rawName) {
  requireDevice(device);
  var reservations = readReservations();
  var name = uniqueName(device, cleanName(rawName), reservations);
  var tab = sheet(TAB_RESERVATIONS);

  reservations.forEach(function (reservation) {
    if (reservation.device === device) {
      tab.getRange(reservation.rowNumber, 3).setValue(safeCell(name));
    }
  });

  var properties = PropertiesService.getScriptProperties();
  var oldNameKey = properties.getProperty('PINDEVNAME_' + device);

  if (oldNameKey && oldNameKey !== pinNameKey(name)) {
    clearDevicePin(properties, device, null);
    return { ok: true, name: name, pinCleared: true };
  }

  return { ok: true, name: name };
}

var PIN_PATTERN = /^\d{4}$/;
var PIN_FAIL_PER_NAME = 5;
var PIN_FAIL_TOTAL = 60;
var PIN_FAIL_SECONDS = 600;
var PIN_DEVICE_LIMIT = 1000;
var PIN_PRUNE_EXTRA = 100;

function setPin(device, rawName, pin) {
  requireDevice(device);
  var name = uniqueName(device, cleanName(rawName));
  requirePin(pin);

  var guard = pinGuard(name, false);
  var properties = PropertiesService.getScriptProperties();
  var key = pinKey(name, pin, true);
  var owner = properties.getProperty(key);

  if (owner && owner !== device) {
    guard.fail();
    throw userError('pin-used', '같은 이름에 같은 비밀번호를 쓰는 분이 있어요. 다른 번호를 골라 주세요.');
  }

  var previous = String(properties.getProperty('PINDEV_' + device) || '').split('|')[0];

  if (previous && previous !== key) {
    properties.deleteProperty(previous);
  }

  var nameKey = pinNameKey(name);
  var previousName = properties.getProperty('PINDEVNAME_' + device);

  if (previousName && previousName !== nameKey && properties.getProperty(previousName) === device) {
    properties.deleteProperty(previousName);
  }

  var values = {};
  values[key] = device;
  values['PINDEV_' + device] = key + '|' + Date.now();
  values[nameKey] = device;
  values['PINDEVNAME_' + device] = nameKey;
  properties.setProperties(values);
  prunePins(properties);
  log('비밀번호', '', name, device);

  return { ok: true, name: name };
}

function reclaim(rawName, pin) {
  var name = cleanName(rawName);
  requirePin(pin);

  var guard = pinGuard(name, true);
  var key = pinKey(name, pin, false);
  var device = key ? PropertiesService.getScriptProperties().getProperty(key) : null;

  if (!device) {
    guard.fail();
    throw userError('pin-wrong', '이름이나 비밀번호가 맞지 않아요. 비밀번호를 정할 때 쓴 이름 그대로 적어 주세요.');
  }

  guard.clear();
  log('되찾기', '', name, device);

  return { ok: true, device: device };
}

function pinGuard(name, countTotal) {
  var cache = CacheService.getScriptCache();
  var nameTag = 'PINFAIL_' + hashText(pinName(name));
  var nameFails = toInt(cache.get(nameTag), 0);
  var totalFails = countTotal ? toInt(cache.get('PINFAIL_ALL'), 0) : 0;

  if (nameFails >= PIN_FAIL_PER_NAME || totalFails >= PIN_FAIL_TOTAL) {
    throw userError('pin-locked', '틀린 횟수가 많아요. 10분 뒤에 다시 해 주세요.');
  }

  return {
    fail: function () {
      cache.put(nameTag, String(nameFails + 1), PIN_FAIL_SECONDS);

      if (countTotal) {
        cache.put('PINFAIL_ALL', String(totalFails + 1), PIN_FAIL_SECONDS);
      }
    },
    clear: function () {
      cache.remove(nameTag);
    }
  };
}

function clearDevicePin(properties, device, all) {
  var get = function (key) { return all ? all[key] : properties.getProperty(key); };
  var pinKeyValue = String(get('PINDEV_' + device) || '').split('|')[0];
  var nameKey = get('PINDEVNAME_' + device);

  if (pinKeyValue && get(pinKeyValue) === device) {
    properties.deleteProperty(pinKeyValue);
  }

  if (nameKey && get(nameKey) === device) {
    properties.deleteProperty(nameKey);
  }

  properties.deleteProperty('PINDEV_' + device);
  properties.deleteProperty('PINDEVNAME_' + device);
}

function prunePins(properties) {
  var all = properties.getProperties();
  var devices = Object.keys(all)
    .filter(function (key) { return key.indexOf('PINDEV_') === 0; })
    .map(function (key) { return { device: key.slice(7), time: toInt(String(all[key]).split('|')[1], 0) }; });

  if (devices.length <= PIN_DEVICE_LIMIT) {
    return;
  }

  devices
    .sort(function (a, b) { return a.time - b.time; })
    .slice(0, devices.length - PIN_DEVICE_LIMIT + PIN_PRUNE_EXTRA)
    .forEach(function (entry) { clearDevicePin(properties, entry.device, all); });
}

function requirePin(pin) {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    throw userError('bad-pin', '비밀번호는 숫자 4자리로 적어 주세요.');
  }
}

var NAME_LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';

function uniqueName(device, name, reservations) {
  var taken = {};

  (reservations || readReservations()).forEach(function (reservation) {
    if (reservation.device !== device) {
      taken[pinName(reservation.name)] = true;
    }
  });

  var properties = PropertiesService.getScriptProperties();
  var used = function (candidate) {
    if (taken[pinName(candidate)]) return true;
    var owner = properties.getProperty(pinNameKey(candidate));
    return !!owner && owner !== device;
  };

  if (!used(name)) {
    return name;
  }

  for (var i = 0; i < NAME_LETTERS.length; i++) {
    var candidate = sliceChars(name, MAX_NAME_LENGTH - 1).trim() + NAME_LETTERS.charAt(i);

    if (!used(candidate)) {
      return candidate;
    }
  }

  throw userError('name-full', '같은 이름이 너무 많아요. 이름을 조금 다르게 적어 주세요.');
}

function pinNameKey(name) {
  return 'PINNAME_' + hashText(pinName(name));
}

function pinName(name) {
  return plainName(name).replace(/\s+/g, '').toLowerCase();
}

function pinKey(name, pin, create) {
  var properties = PropertiesService.getScriptProperties();
  var salt = properties.getProperty('PIN_SALT');

  if (!salt) {
    if (!create) { return null; }
    salt = newKey();
    properties.setProperty('PIN_SALT', salt);
  }

  return 'PIN_' + hashText(salt + '|' + pinName(name) + '|' + pin);
}

function hashText(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function saveLayout(rawSeats, rawFloors, rawItems, rawWalls) {
  ensureTabs();

  if (!Array.isArray(rawSeats)) {
    throw userError('bad-request', '배치도를 읽지 못했습니다.');
  }

  if (rawSeats.length > MAX_SEATS) {
    throw userError('too-many', '좌석은 ' + MAX_SEATS + '개까지 만들 수 있습니다.');
  }

  var floors = cleanFloors(rawFloors);
  var floorIds = {};
  floors.forEach(function (floor) { floorIds[floor.f] = true; });

  var seen = {};
  var rows = [];

  rawSeats.forEach(function (raw) {
    var id = String(raw.id || '').trim();
    var row = toInt(raw.r, -1);
    var col = toInt(raw.c, -1);
    var floor = toInt(raw.f, 0);

    if (!/^[A-Za-z0-9_-]{1,16}$/.test(id) || row < 0 || col < 0 || row > 99 || col > 99 || floor < 0 || floor > 99) {
      throw userError('bad-request', '배치도에 잘못된 자리가 있습니다: ' + id);
    }

    if (seen[id]) {
      throw userError('bad-request', '같은 좌석ID 가 두 번 있습니다: ' + id);
    }

    seen[id] = true;
    var kind = SEAT_KINDS.indexOf(String(raw.kind || '')) >= 0 ? String(raw.kind) : 'chair';
    var bench = kind === 'pew' && /^[A-Za-z0-9_-]{1,16}$/.test(String(raw.bench || '')) ? String(raw.bench) : '';

    if (floors.length > 0 && !floorIds[floor]) {
      throw userError('bad-request', '없는 층의 자리가 있습니다: ' + id);
    }

    rows.push([id, row, col, safeCell(sliceChars(String(raw.label || id), 8)), raw.blocked === true, kind, bench, floor]);
  });

  var items = Array.isArray(rawItems) ? cleanItems(rawItems, floors, true) : null;
  var walls = Array.isArray(rawWalls) ? cleanWalls(rawWalls, floors, true) : null;

  var seatTab = sheet(TAB_SEATS);
  clearBody(seatTab);
  writeBody(seatTab, rows);

  var blocked = {};
  rows.forEach(function (row) { if (row[4]) { blocked[row[0]] = true; } });

  var reservations = readReservations();
  var dropped = reservations.filter(function (r) { return !seen[r.seat] || blocked[r.seat]; });

  if (dropped.length > 0) {
    var reservationTab = sheet(TAB_RESERVATIONS);
    var kept = reservations
      .filter(function (r) { return seen[r.seat] && !blocked[r.seat]; })
      .map(function (r) { return [r.seat, r.device, safeCell(r.name), r.at]; });
    clearBody(reservationTab);
    writeBody(reservationTab, kept);
    logMany(dropped.map(function (r) { return ['배치 변경으로 취소', r.seat, r.name, r.device]; }));
  }

  var settings = readSettings();
  writeSetting(KEY_FLOORS, floors.length > 0 ? JSON.stringify(floors) : '');

  if (items) {
    writeSetting(KEY_ITEMS, items.length > 0
      ? JSON.stringify(items.map(function (item) { return [item.f, item.kind, item.x, item.y, item.a]; }))
      : '');
  }

  if (walls) {
    writeSetting(KEY_WALLS, walls.length > 0
      ? JSON.stringify(walls.map(function (wall) { return [wall.f, wall.points]; }))
      : '');
  }
  writeSetting(KEY_LAYOUT_VERSION, toPositiveInt(settings[KEY_LAYOUT_VERSION], 0) + 1);

  return { ok: true, count: rows.length };
}

function saveSettings(settings) {
  if (settings.published !== undefined) {
    writeSetting(KEY_PUBLISHED, settings.published === true);
  }

  if (settings.maxPerPerson !== undefined) {
    writeSetting(KEY_MAX_PER_PERSON, clampMaxPerPerson(settings.maxPerPerson));
  }

  if (settings.showNames !== undefined) {
    writeSetting(KEY_SHOW_NAMES, settings.showNames === true);
  }

  if (settings.room !== undefined) {
    writeSetting(KEY_ROOM, safeCell(String(settings.room).trim().slice(0, 40)));
  }

  return { ok: true };
}

function forceCancel(seatId, expectedName) {
  var reservation = findReservation(readReservations(), seatId);

  if (reservation && expectedName !== undefined && expectedName !== null
      && plainName(reservation.name) !== plainName(expectedName)) {
    throw userError('changed', '그 사이 예약한 분이 바뀌었어요. 좌석표를 새로 불러올게요.');
  }

  if (reservation) {
    removeRow(sheet(TAB_RESERVATIONS), reservation.rowNumber);
    log('관리자 취소', seatId, reservation.name, reservation.device);
  }

  return { ok: true };
}

function nextSession() {
  var settings = readSettings();
  var session = toPositiveInt(settings[KEY_SESSION], 1);
  var reservations = readReservations();
  var now = new Date();

  if (reservations.length > 0) {
    var pastRows = reservations.map(function (r) { return [session, r.seat, safeCell(r.name), r.at, now]; });
    var pastTab = sheet(TAB_PAST);
    var start = pastTab.getLastRow() + 1;
    ensureRows(pastTab, start + pastRows.length - 1);
    pastTab.getRange(start, 1, pastRows.length, pastRows[0].length).setValues(pastRows);
  }

  clearBody(sheet(TAB_RESERVATIONS));
  writeSetting(KEY_SESSION, session + 1);
  log('다음 회차로 (' + reservations.length + '자리)', '', '', '');

  return { ok: true, session: session + 1, moved: reservations.length };
}

function ensureTabs() {
  var book = SpreadsheetApp.getActiveSpreadsheet();

  [TAB_SETTINGS, TAB_SEATS, TAB_RESERVATIONS, TAB_PAST, TAB_LOG].forEach(function (name) {
    var tab = book.getSheetByName(name);

    if (!tab) {
      tab = book.insertSheet(name);
    }

    if (tab.getLastRow() === 0) {
      tab.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      tab.setFrozenRows(1);

      if (name === TAB_SETTINGS) {
        tab.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
      }

      var textColumns = {};
      textColumns[TAB_RESERVATIONS] = 'A:C';
      textColumns[TAB_PAST] = 'B:C';
      textColumns[TAB_LOG] = 'C:E';

      if (textColumns[name]) {
        tab.getRange(textColumns[name]).setNumberFormat('@');
      }
    } else if (tab.getLastColumn() < HEADERS[name].length) {
      tab.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
    }
  });
}

function sheet(name) {
  var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);

  if (!tab) {
    ensureTabs();
    tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  }

  return tab;
}

function bodyValues(tab, width) {
  var last = tab.getLastRow();
  return last < 2 ? [] : tab.getRange(2, 1, last - 1, width).getValues();
}

function clearBody(tab) {
  var last = tab.getLastRow();

  if (last >= 2) {
    tab.getRange(2, 1, last - 1, tab.getMaxColumns()).clearContent();
  }
}

function ensureRows(tab, lastRow) {
  var max = tab.getMaxRows();

  if (max < lastRow) {
    tab.insertRowsAfter(max, lastRow - max);
  }
}

function writeBody(tab, rows) {
  if (rows.length === 0) {
    return;
  }

  ensureRows(tab, rows.length + 1);
  tab.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function removeRow(tab, rowNumber) {
  if (tab.getMaxRows() - tab.getFrozenRows() <= 1) {
    tab.getRange(rowNumber, 1, 1, tab.getMaxColumns()).clearContent();
    return;
  }

  tab.deleteRow(rowNumber);
}

function readSettings() {
  var result = {};

  bodyValues(sheet(TAB_SETTINGS), 2).forEach(function (row) {
    var key = String(row[0] || '').trim();
    var value = row[1];

    if (value === 'TRUE' || value === 'true') { value = true; }
    if (value === 'FALSE' || value === 'false') { value = false; }

    if (key) { result[key] = value; }
  });

  return result;
}

function writeSetting(key, value) {
  var tab = sheet(TAB_SETTINGS);
  var rows = bodyValues(tab, 1);
  var rowNumber = 0;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      rowNumber = i + 2;
      break;
    }
  }

  if (!rowNumber) {
    rowNumber = tab.getLastRow() + 1;
    ensureRows(tab, rowNumber);
    tab.getRange(rowNumber, 1).setValue(key);
  }

  var cell = tab.getRange(rowNumber, 2);

  if (typeof value === 'string') {
    cell.setNumberFormat('@');
  }

  cell.setValue(value);
}

function cleanFloors(rawFloors) {
  if (!Array.isArray(rawFloors)) {
    return [];
  }

  if (rawFloors.length > MAX_FLOORS) {
    throw userError('too-many', '층은 ' + MAX_FLOORS + '개까지 만들 수 있습니다.');
  }

  var seen = {};

  return rawFloors.map(function (raw) {
    var id = toInt(raw && raw.f, -1);

    if (id < 0 || id > 99 || seen[id]) {
      throw userError('bad-request', '층 모양을 읽지 못했습니다.');
    }

    seen[id] = true;
    var shape = SEAT_SHAPES.indexOf(String(raw.shape || '')) >= 0 ? String(raw.shape) : 'grid';

    var floor = {
      f: id,
      shape: shape,
      angle: shape === 'arc' ? Math.min(Math.max(toInt(raw.angle, 120), 30), 360) : 0,
      rows: Math.min(Math.max(toInt(raw.rows, 12), 1), 99),
      cols: Math.min(Math.max(toInt(raw.cols, 16), 1), 99)
    };

    if (shape === 'grid' && (raw.stage === 'rows' || raw.stage === 'none')) {
      floor.stage = raw.stage;
    }

    if (shape === 'grid' && raw.stage === 'custom') {
      var sl = Math.min(Math.max(toInt(raw.sl, 0), -20000), 20000);
      var sr = Math.min(Math.max(toInt(raw.sr, 0), -20000), 20000);

      if (sr - sl >= 20) {
        floor.stage = 'custom';
        floor.sl = sl;
        floor.sr = sr;
      }
    }

    return floor;
  });
}

function cleanItems(rawItems, floors, strict) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  if (rawItems.length > MAX_ITEMS) {
    throw userError('too-many', '물건은 ' + MAX_ITEMS + '개까지 그릴 수 있습니다.');
  }

  var floorIds = {};
  floors.forEach(function (floor) { floorIds[floor.f] = true; });
  var items = [];

  rawItems.forEach(function (raw) {
    var item = Array.isArray(raw)
      ? { f: toInt(raw[0], -1), kind: String(raw[1] || ''), x: Number(raw[2]), y: Number(raw[3]), a: Number(raw[4] || 0) }
      : { f: toInt(raw && raw.f, -1), kind: String((raw && raw.kind) || ''), x: Number(raw && raw.x), y: Number(raw && raw.y), a: Number((raw && raw.a) || 0) };
    var bad = item.f < 0 || item.f > 99 || ITEM_KINDS.indexOf(item.kind) < 0 || (floors.length > 0 && !floorIds[item.f]) ||
      !isFinite(item.x) || !isFinite(item.y) || !isFinite(item.a) || Math.abs(item.x) > 20000 || Math.abs(item.y) > 20000;

    if (bad) {
      if (strict) { throw userError('bad-request', '배치도의 물건을 읽지 못했습니다.'); }
      return;
    }

    items.push({ f: item.f, kind: item.kind, x: Math.round(item.x), y: Math.round(item.y), a: Math.round(item.a) % 360 });
  });

  return items;
}

function cleanWalls(rawWalls, floors, strict) {
  if (!Array.isArray(rawWalls)) {
    return [];
  }

  var floorIds = {};
  floors.forEach(function (floor) { floorIds[floor.f] = true; });
  var seen = {};
  var walls = [];

  rawWalls.forEach(function (raw) {
    var f = toInt(Array.isArray(raw) ? raw[0] : raw && raw.f, -1);
    var rawPoints = Array.isArray(raw) ? raw[1] : raw && raw.points;
    var points = Array.isArray(rawPoints) ? rawPoints.map(function (point) {
      var x = Number(Array.isArray(point) ? point[0] : NaN);
      var y = Number(Array.isArray(point) ? point[1] : NaN);
      return isFinite(x) && isFinite(y) && Math.abs(x) <= 20000 && Math.abs(y) <= 20000 ? [Math.round(x), Math.round(y)] : null;
    }) : [];
    var bad = f < 0 || f > 99 || seen[f] || (floors.length > 0 && !floorIds[f]) ||
      points.length < 3 || points.length > MAX_WALL_POINTS || points.some(function (point) { return point === null; });

    if (bad) {
      if (strict) { throw userError('bad-request', '외벽을 읽지 못했습니다.'); }
      return;
    }

    seen[f] = true;
    walls.push({ f: f, points: points });
  });

  return walls;
}

function readWalls(settings) {
  var text = String(settings[KEY_WALLS] || '').trim();

  if (text === '') {
    return [];
  }

  try {
    return cleanWalls(JSON.parse(text), readFloors(settings), false);
  } catch (error) {
    return [];
  }
}

function readItems(settings) {
  var text = String(settings[KEY_ITEMS] || '').trim();

  if (text === '') {
    return [];
  }

  try {
    return cleanItems(JSON.parse(text), readFloors(settings), false);
  } catch (error) {
    return [];
  }
}

function readFloors(settings) {
  var text = String(settings[KEY_FLOORS] || '').trim();

  if (text === '') {
    return [];
  }

  try {
    return cleanFloors(JSON.parse(text));
  } catch (error) {
    return [];
  }
}

function readSeats() {
  var tab = sheet(TAB_SEATS);
  var width = Math.min(Math.max(tab.getLastColumn(), 7), 8);

  return bodyValues(tab, width)
    .filter(function (row) { return String(row[0] || '').trim() !== ''; })
    .map(function (row) {
      return {
        id: String(row[0]).trim(),
        row: toInt(row[1], 0),
        col: toInt(row[2], 0),
        label: String(row[3] || row[0]),
        blocked: row[4] === true || row[4] === 'TRUE',
        kind: SEAT_KINDS.indexOf(String(row[5] || '')) >= 0 ? String(row[5]) : 'chair',
        bench: String(row[6] || ''),
        floor: row.length > 7 ? toInt(row[7], 0) : 0
      };
    });
}

function readReservations() {
  return bodyValues(sheet(TAB_RESERVATIONS), 4)
    .map(function (row, index) {
      return {
        rowNumber: index + 2,
        seat: String(row[0] || '').trim(),
        device: String(row[1] || '').trim(),
        name: String(row[2] || ''),
        at: row[3]
      };
    })
    .filter(function (r) { return r.seat !== ''; });
}

function findSeat(seatId) {
  var seats = readSeats();

  for (var i = 0; i < seats.length; i++) {
    if (seats[i].id === seatId) {
      if (seats[i].blocked) {
        throw userError('blocked', '비워 둔 자리라 예약할 수 없어요.');
      }

      return seats[i];
    }
  }

  throw userError('no-seat', '배치도가 바뀌었어요. 좌석표를 새로 불러올게요.');
}

function findReservation(reservations, seatId) {
  for (var i = 0; i < reservations.length; i++) {
    if (reservations[i].seat === seatId) {
      return reservations[i];
    }
  }

  return null;
}

function log(what, seatId, name, device) {
  var tab = sheet(TAB_LOG);
  tab.appendRow([new Date(), what, seatId, safeCell(name || ''), String(device || '').slice(0, 6)]);

  if (Math.random() < 0.02) {
    var cutoff = new Date(Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000);
    var times = bodyValues(tab, 1);
    var old = 0;

    while (old < times.length && times[old][0] instanceof Date && times[old][0] < cutoff) {
      old++;
    }

    if (old > 0) {
      tab.deleteRows(2, old);
    }
  }
}

function logMany(entries) {
  if (entries.length === 0) {
    return;
  }

  var tab = sheet(TAB_LOG);
  var now = new Date();
  var rows = entries.map(function (entry) {
    return [now, entry[0], entry[1], safeCell(entry[2] || ''), String(entry[3] || '').slice(0, 6)];
  });
  var start = tab.getLastRow() + 1;
  ensureRows(tab, start + rows.length - 1);
  tab.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function withLock(work) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(20000)) {
    throw userError('busy', '사람이 많아 잠시 밀렸어요. 조금 뒤 다시 눌러 주세요.');
  }

  try {
    return work();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function requireOpen(settings, isAdmin) {
  if (isAdmin) {
    return;
  }

  if (settings[KEY_PUBLISHED] !== true) {
    throw userError('not-published', '아직 예약을 받지 않아요.');
  }

  if (!isWithinWindow(settings)) {
    throw userError('closed', '지금은 예약 시간이 아니에요.');
  }
}

function isWithinWindow(settings) {
  var now = new Date();
  var opens = parseTime(settings[KEY_OPENS_AT]);
  var closes = parseTime(settings[KEY_CLOSES_AT]);

  return (!opens || now >= opens) && (!closes || now < closes);
}

function parseTime(value) {
  if (value instanceof Date) { return value; }

  var text = String(value || '').trim();

  if (!text) { return null; }

  var local = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);

  if (local) {
    var pad = function (part) { return ('0' + Number(part || 0)).slice(-2); };
    return Utilities.parseDate(local[1] + '-' + pad(local[2]) + '-' + pad(local[3]) + ' ' + pad(local[4]) + ':' + pad(local[5]) + ':' + pad(local[6]),
      sheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }

  var parsed = new Date(text.replace(' ', 'T'));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(value) {
  var time = parseTime(value);
  return time ? Utilities.formatDate(time, sheetTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX") : '';
}

function sheetTimeZone() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

function syncTimeZone(zone) {
  if (typeof zone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+){0,2}$/.test(zone)) {
    return;
  }

  try {
    var book = SpreadsheetApp.getActiveSpreadsheet();

    if (book.getSpreadsheetTimeZone() !== zone) {
      book.setSpreadsheetTimeZone(zone);
    }
  } catch (error) {
    return;
  }
}

function checkAdmin(key) {
  if (typeof key !== 'string' || key.length === 0) {
    return false;
  }

  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!expected && key === expected;
}

function requireDevice(device) {
  if (!device) {
    throw userError('bad-request', '기기 정보가 없습니다. 앱을 다시 켜 주세요.');
  }
}

function cleanDevice(value) {
  var text = String(value || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(text) ? text : '';
}

function cleanName(value) {
  var text = sliceChars(String(value || '').replace(/[\r\n\t]/g, ' ').trim(), MAX_NAME_LENGTH).trim();

  if (!text) {
    throw userError('no-name', '이름을 먼저 적어 주세요.');
  }

  return text;
}

function sliceChars(text, count) {
  return Array.from(String(text || '')).slice(0, count).join('');
}

function plainName(value) {
  return String(value || '').replace(/^'/, '').trim();
}

function readMaxPerPerson(settings) {
  return clampMaxPerPerson(settings[KEY_MAX_PER_PERSON]);
}

function clampMaxPerPerson(value) {
  var number = toInt(value, 1);
  return number === 0 ? 0 : Math.min(Math.max(number, 1), 20);
}

function safeCell(text) {
  var value = String(text || '');
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function newKey() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function toInt(value, fallback) {
  var number = parseInt(value, 10);
  return isNaN(number) ? fallback : number;
}

function toPositiveInt(value, fallback) {
  var number = toInt(value, fallback);
  return number < 0 ? fallback : number;
}

function userError(code, message) {
  var error = new Error(message);
  error.userFacing = true;
  error.code = code;
  return error;
}
