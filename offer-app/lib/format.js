'use strict';

// A blank box is always a single space. SignNow keeps " " on a deal document;
// an empty string or "-" must never be sent.
const BLANK = ' ';

// Parse money typed on a phone: "150000", "$150,000", "150,000.5".
// Returns integer cents, or null when the input is empty / "none" / zero.
function parseMoney(input) {
  if (input === undefined || input === null) return null;
  const s = String(input).trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'n/a' || s === 'na') return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error('must be a dollar amount like 150000 or 150,000.00');
  }
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error('is too large');
  return cents === 0 ? null : cents;
}

// 15000000 -> "$150,000.00"
function formatMoney(cents) {
  const dollars = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${dollars}.${String(cents % 100).padStart(2, '0')}`;
}

// Today's date in US Central time as MM/DD/YYYY.
function todayCentral(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('month')}/${get('day')}/${get('year')}`;
}

// Optional text -> trimmed value, or a single space when empty.
function textOrBlank(value) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  return s === '' ? BLANK : s;
}

// "Mary Ann Smith" -> { first: "Mary Ann", last: "Smith" }
function splitName(fullName) {
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

module.exports = { BLANK, parseMoney, formatMoney, todayCentral, textOrBlank, splitName };
