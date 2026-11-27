const TZ = 'Asia/Seoul';
const KINDS = { user: '유저', sheet: '시트' };
const ID_PATTERN = /^[a-f0-9]{16,64}$/;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (KINDS[p.k]) return json(record(p.k, String(p.id || '')));
  return json(summary());
}

function record(kind, id) {
  if (!ID_PATTERN.test(id)) return { ok: false };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false };
  try {
    const sheet = sheetFor(kind);
    const last = sheet.getLastRow();
    const hit = last > 0 && sheet.getRange(1, 1, last, 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (!hit) {
      sheet.appendRow([id, Utilities.formatDate(new Date(), TZ, 'yyyy-MM')]);
      CacheService.getScriptCache().remove('summary');
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function summary() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('summary');
  if (cached) return JSON.parse(cached);

  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    months.push(Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - i, 15), TZ, 'yyyy-MM'));
  }
  const result = { ok: true, months: months };
  Object.keys(KINDS).forEach(kind => {
    const sheet = sheetFor(kind);
    const last = sheet.getLastRow();
    const counts = {};
    if (last > 0) {
      sheet.getRange(1, 2, last, 1).getDisplayValues().forEach(row => { counts[row[0]] = (counts[row[0]] || 0) + 1; });
    }
    result[kind] = months.map(m => counts[m] || 0);
    result[kind + 'Total'] = last;
  });
  cache.put('summary', JSON.stringify(result), 300);
  return result;
}

function sheetFor(kind) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const name = KINDS[kind];
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange('B:B').setNumberFormat('@');
  }
  return sheet;
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
