(() => {
'use strict';
const { t, LANG, DEMO_URL } = window.Jjim;
const STATS_URL = 'https://script.google.com/macros/s/AKfycbxPjLY9YLtlFlJBE5Tbe_QlxKvpCsEYCnTjKVSRwzUb6cf4jGa9q4c4h7EcGiiY5XNe/exec';
const COUNTED_KEY = 'jjimkong.counted';

function readCounted() {
  try {
    const data = JSON.parse(localStorage.getItem(COUNTED_KEY) || '{}') || {};
    if (!Array.isArray(data.sheets)) data.sheets = [];
    return data;
  } catch (e) {
    return { sheets: [] };
  }
}

function writeCounted(data) {
  try { localStorage.setItem(COUNTED_KEY, JSON.stringify(data)); } catch (e) { /* 개인 창 등 */ }
}

function randomHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashHex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jjimkong:' + text));
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

function send(kind, id) {
  return fetch(STATS_URL + '?k=' + kind + '&id=' + id, { mode: 'no-cors', cache: 'no-store' });
}

async function countUse(url, admin) {
  if (!STATS_URL || !url || url === DEMO_URL) return;
  try {
    const counted = readCounted();
    if (admin) {
      const id = await hashHex(url);
      if (counted.sheets.includes(id)) return;
      await send('sheet', id);
      counted.sheets.push(id);
    } else {
      if (counted.user) return;
      await send('user', randomHex());
      counted.user = true;
    }
    writeCounted(counted);
  } catch (e) { /* 통계는 실패해도 그만 */ }
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  try { return new Intl.DateTimeFormat(LANG, { month: 'short' }).format(new Date(y, m - 1, 15)); }
  catch (e) { return String(m); }
}

function fullMonth(key) {
  const [y, m] = key.split('-').map(Number);
  try { return new Intl.DateTimeFormat(LANG, { year: 'numeric', month: 'long' }).format(new Date(y, m - 1, 15)); }
  catch (e) { return key; }
}

function drawChart(box, months, values, unit) {
  const max = Math.max(1, ...values);
  const chart = box.querySelector('.usage-bars');
  const tip = box.querySelector('.usage-tip');
  chart.textContent = '';
  months.forEach((key, i) => {
    const col = document.createElement('div');
    col.className = 'usage-col';
    const label = fullMonth(key) + ' · ' + unit(values[i]);
    col.setAttribute('aria-label', label);
    col.tabIndex = 0;
    const bar = document.createElement('div');
    bar.className = 'usage-bar' + (values[i] ? '' : ' zero');
    bar.style.height = (values[i] / max * 100) + '%';
    const tick = document.createElement('span');
    tick.className = 'usage-month';
    tick.textContent = monthLabel(key);
    col.append(bar, tick);
    const show = () => {
      tip.textContent = label;
      tip.hidden = false;
      const boxRect = box.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      const x = colRect.left + colRect.width / 2 - boxRect.left;
      tip.style.left = Math.min(Math.max(x, tip.offsetWidth / 2 + 4), boxRect.width - tip.offsetWidth / 2 - 4) + 'px';
      chart.querySelectorAll('.usage-col.on').forEach(c => c.classList.remove('on'));
      col.classList.add('on');
    };
    const hide = () => { tip.hidden = true; col.classList.remove('on'); };
    col.addEventListener('pointerenter', show);
    col.addEventListener('pointerleave', hide);
    col.addEventListener('focus', show);
    col.addEventListener('blur', hide);
    chart.append(col);
  });
}

function fillTable(months, data) {
  const body = document.querySelector('#usageTable tbody');
  body.textContent = '';
  months.forEach((key, i) => {
    const row = document.createElement('tr');
    [fullMonth(key), data.user[i], data.sheet[i]].forEach(v => {
      const cell = document.createElement('td');
      cell.textContent = v;
      row.append(cell);
    });
    body.append(row);
  });
}

async function loadStats() {
  const section = document.getElementById('usageStats');
  if (!STATS_URL || !section) return;
  try {
    const response = await fetch(STATS_URL, { cache: 'no-store' });
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.months) || !Array.isArray(data.user) || !Array.isArray(data.sheet)) return;
    const sum = list => list.reduce((a, b) => a + b, 0);
    const people = n => t('{n}명', { n: n.toLocaleString(LANG) });
    const sheets = n => t('{n}개', { n: n.toLocaleString(LANG) });
    document.getElementById('usageUserTotal').textContent = people(sum(data.user));
    document.getElementById('usageSheetTotal').textContent = sheets(sum(data.sheet));
    drawChart(document.getElementById('usageUserBox'), data.months, data.user, people);
    drawChart(document.getElementById('usageSheetBox'), data.months, data.sheet, sheets);
    fillTable(data.months, data);
    section.hidden = false;
  } catch (e) { /* 통계가 안 오면 감춘 채로 */ }
}

window.Jjim.countUse = countUse;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadStats);
else loadStats();
})();
