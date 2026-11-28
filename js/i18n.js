(() => {
'use strict';
const LANGS = [
  { code: 'ko', flag: 'kr', name: '한국어', locale: 'ko-KR' },
  { code: 'en', flag: 'us', name: 'English', locale: 'en-US' },
  { code: 'es', flag: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'ru', flag: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'mn', flag: 'mn', name: 'Монгол', locale: 'mn-MN' },
  { code: 'fr', flag: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'de', flag: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'ja', flag: 'jp', name: '日本語', locale: 'ja-JP' },
  { code: 'zh-CN', flag: 'cn', name: '简体中文', locale: 'zh-CN' },
  { code: 'zh-TW', flag: 'tw', name: '繁體中文', locale: 'zh-TW' },
  { code: 'tl', flag: 'ph', name: 'Tagalog', locale: 'fil-PH' },
  { code: 'ceb', flag: 'ph', name: 'Cebuano', locale: 'en-PH' },
  { code: 'it', flag: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'th', flag: 'th', name: 'ไทย', locale: 'th-TH' },
  { code: 'ne', flag: 'np', name: 'नेपाली', locale: 'ne-NP' },
  { code: 'id', flag: 'id', name: 'Bahasa Indonesia', locale: 'id-ID' },
  { code: 'pt', flag: 'br', name: 'Português', locale: 'pt-BR' },
  { code: 'ky', flag: 'kg', name: 'Кыргызча', locale: 'ky-KG' },
  { code: 'km', flag: 'kh', name: 'ខ្មែរ', locale: 'km-KH' },
  { code: 'vi', flag: 'vn', name: 'Tiếng Việt', locale: 'vi-VN' }
];

const LANG = LANGS.some(item => item.code === window.JJIM_LANG) ? window.JJIM_LANG : 'ko';
const DICT = LANG === 'ko' ? {} : (window.JJIM_DICT || {});
const LOCALE = (LANGS.find(item => item.code === LANG) || LANGS[0]).locale;

const norm = text => String(text).replace(/\s+/g, ' ').trim();
const fill = (text, vars) => vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text;

function t(key, vars) {
  const found = DICT[key];
  return fill(typeof found === 'string' && found ? found : key, vars);
}

let patterns = null;

function patternList() {
  if (patterns) return patterns;
  patterns = [];
  for (const key of Object.keys(DICT)) {
    if (!/\{\w+\}/.test(key)) continue;
    const names = [];
    const source = key.split(/(\{\w+\})/).map(part => {
      const name = /^\{(\w+)\}$/.exec(part);
      if (name) {
        names.push(name[1]);
        return '(.+?)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    patterns.push({ key, names, regex: new RegExp('^' + source + '$') });
  }
  return patterns;
}

// 서버(구글 시트) · 체험 서버가 보낸 한국어 문구를 고른 언어로 바꾼다. 숫자 · 좌석 이름이 낀 문구는 틀({n})로 맞춘다.
function tm(message) {
  if (!message || LANG === 'ko') return message;
  if (DICT[message]) return DICT[message];
  for (const item of patternList()) {
    const match = item.regex.exec(message);
    if (!match) continue;
    const vars = {};
    item.names.forEach((name, index) => { vars[name] = match[index + 1]; });
    return t(item.key, vars);
  }
  return message;
}

const SKIP = 'script, style, [data-i18n], [data-i18n-skip]';

const LANG_IN_URL = /[?&]lang=/.test(location.search);

function withLang(href) {
  if (!LANG_IN_URL || /[?&]lang=/.test(href)) return href;
  const at = href.indexOf('#');
  const path = at < 0 ? href : href.slice(0, at);
  const hash = at < 0 ? '' : href.slice(at);
  return path + (path.includes('?') ? '&' : '?') + 'lang=' + LANG + hash;
}

function translatePage(root) {
  const base = root || document.body;
  base.querySelectorAll('a[href^="guide.html"], a[href^="./"]').forEach(link => {
    link.setAttribute('href', withLang(link.getAttribute('href')));
  });
  if (LANG === 'ko') return;

  base.querySelectorAll('[data-i18n]').forEach(element => {
    const found = DICT[norm(element.innerHTML)];
    if (found) element.innerHTML = found;
  });

  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const key = norm(node.nodeValue);
    if (!key || !DICT[key] || (node.parentElement && node.parentElement.closest(SKIP))) continue;
    const lead = /^\s*/.exec(node.nodeValue)[0];
    const tail = /\s*$/.exec(node.nodeValue)[0];
    node.nodeValue = lead + DICT[key] + tail;
  }

  base.querySelectorAll('[placeholder], [title], [aria-label]').forEach(element => {
    for (const name of ['placeholder', 'title', 'aria-label']) {
      const value = element.getAttribute(name);
      if (value && DICT[norm(value)]) element.setAttribute(name, DICT[norm(value)]);
    }
  });

  if (DICT[norm(document.title)]) document.title = DICT[norm(document.title)];
}

function setLang(code) {
  try { localStorage.setItem('jjimkong.lang', code); } catch (e) { /* 개인 창 등 */ }
  try { if (window.Jjim.beforeLangChange) window.Jjim.beforeLangChange(); } catch (e) { /* 저장 못 해도 언어는 바꿈 */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', code);
  const hash = url.hash.replace(/(^#|&)lang=[^&]*/, '$1').replace(/^#&/, '#').replace(/&$/, '');
  url.hash = hash === '#' ? '' : hash;
  if (!url.hash) url.href = url.href.replace(/#$/, '');
  location.replace(url.toString());
}

function formatDate(date) {
  try {
    return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch (e) {
    return date.toLocaleString();
  }
}

Object.assign(window.Jjim = window.Jjim || {}, { LANGS, LANG, LOCALE, t, tm, translatePage, setLang, formatDate, withLang });
})();
