(() => {
'use strict';
const DEMO_URL = 'demo://jjimkong';
const DEMO_ADMIN_KEY = 'demoAdminKey0000';
const MAX_CODE_LENGTH = 500;

const TEMPLATE_COPY_URL = 'https://docs.google.com/spreadsheets/d/1qVZ3K_eEbeQo93u29RSlG7cqdCcTn0BaObz9WkMTUT8/copy';

const DOMAIN = '[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?)*';
const URL_PATTERN = new RegExp('^https://script\\.google\\.com/(?:a/macros/' + DOMAIN + '|macros)/s/[A-Za-z0-9_\\-]{10,}/exec$');
const WEBAPP_PARTS = new RegExp('^https://script\\.google\\.com/(?:a/macros/(' + DOMAIN + ')|macros)/s/([A-Za-z0-9_\\-]{10,})/exec$');
const DOMAIN_PATTERN = new RegExp('^' + DOMAIN + '$');
const ID_PATTERN = /^[A-Za-z0-9_\-]{10,}$/;
const ADMIN_KEY_PATTERN = /^[A-Za-z0-9]{16,64}$/;

const INVITE_PAGES = [
  /^https:\/\/antcraft159\.github\.io\/jjimkong\/?(?:index\.html)?(?=[?#]|$)/i,
  /^https:\/\/antcraft159\.github\.io\/Hagah-Releases\/seat\.html(?=[?#]|$)/i,
  /^hagah:\/\/seat\/?(?=[?#]|$)/i
];

function pageUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function memberUrlFromParams(query, ignoreWhitespace = false) {
  let id = null;
  let domain = null;

  for (const pair of String(query || '').split('&')) {
    const equals = pair.indexOf('=');
    if (equals <= 0) continue;
    let value;
    try {
      value = decodeURIComponent(pair.slice(equals + 1));
    } catch (e) {
      continue; // 깨진 글자는 버린다(Hagah 초대 페이지와 같게).
    }
    if (ignoreWhitespace) value = value.replace(/\s+/g, '');
    const name = pair.slice(0, equals);
    if (name === 's') id = value;
    else if (name === 'd') domain = value;
  }

  if (!id || !ID_PATTERN.test(id)) return null;

  let url;
  if (domain === null) url = 'https://script.google.com/macros/s/' + id + '/exec';
  else if (DOMAIN_PATTERN.test(domain)) url = 'https://script.google.com/a/macros/' + domain + '/s/' + id + '/exec';
  else return null;

  return url.length <= MAX_CODE_LENGTH ? url : null;
}

function readInvite(text) {
  for (const page of INVITE_PAGES) {
    const match = page.exec(text);
    if (!match) continue;
    const rest = text.slice(match[0].length);
    const query = rest.startsWith('#') || rest.startsWith('?') ? rest.slice(1).replace(/^[^#]*#/, '') : '';
    return memberUrlFromParams(query, true);
  }
  return undefined;
}

function parseCode(code) {
  let text = String(code || '').replace(/\s+/g, '');
  if (text.length === 0 || text.length > MAX_CODE_LENGTH) return null;

  if (text === 'demo' || text === 'demo#admin') {
    return { url: DEMO_URL, adminKey: text === 'demo#admin' ? DEMO_ADMIN_KEY : null };
  }

  const invited = readInvite(text);
  if (invited !== undefined) {
    return invited && URL_PATTERN.test(invited) ? { url: invited, adminKey: null } : null;
  }

  let adminKey = null;
  const hash = text.indexOf('#');

  if (hash >= 0) {
    const fragment = text.slice(hash + 1);
    text = text.slice(0, hash);
    if (fragment.startsWith('admin=')) {
      const keyText = fragment.slice('admin='.length);
      if (!ADMIN_KEY_PATTERN.test(keyText)) return null;
      adminKey = keyText;
    }
  }

  const query = text.indexOf('?');
  if (query >= 0) text = text.slice(0, query);
  text = text.replace(/\/+$/, '');

  return URL_PATTERN.test(text) ? { url: text, adminKey } : null;
}

function buildInvite(memberUrl) {
  const match = WEBAPP_PARTS.exec(memberUrl || '');
  if (!match) return null;
  return pageUrl() + '#s=' + match[2] + (match[1] ? '&d=' + match[1] : '');
}

function buildShareText(link, room, fingerprint) {
  const title = String(room || '').replace(/\s+/g, ' ').trim();
  const name = title ? title + ' 좌석 예약' : '좌석 예약';
  const check = fingerprint ? `확인 번호: ${fingerprint} — 화면에 보이는 번호가 이것과 다르면 연결하지 마세요.\n` : '';
  return `[${name}]\n아래 링크를 눌러 이름을 적고 [연결] 을 누른 뒤, 빈자리를 찜하세요!\n${check}${link}`;
}

async function fingerprint(memberUrl) {
  if (!memberUrl || !(window.crypto && crypto.subtle)) return '';
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(memberUrl));
  const bytes = new Uint8Array(buffer);
  let bits = 0;
  for (let i = 0; i < 5; i++) bits = bits * 256 + bytes[i];
  let out = '';
  for (let j = 0; j < 8; j++) {
    out = ALPHABET[bits % 32] + out;
    bits = Math.floor(bits / 32);
  }
  return out;
}
Object.assign(window.Jjim = window.Jjim || {}, { DEMO_URL, DEMO_ADMIN_KEY, MAX_CODE_LENGTH, TEMPLATE_COPY_URL, pageUrl, memberUrlFromParams, parseCode, buildInvite, buildShareText, fingerprint });
})();
