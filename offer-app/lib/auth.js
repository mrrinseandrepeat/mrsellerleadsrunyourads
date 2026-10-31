'use strict';

const crypto = require('crypto');

// ACCESS_PINS="Matt:482913,Mike:118822" -> one PIN per person, so the log shows who sent what.
function parsePins(raw) {
  const users = [];
  for (const entry of String(raw || '').split(',')) {
    const i = entry.lastIndexOf(':');
    if (i < 1) continue;
    const name = entry.slice(0, i).trim();
    const pin = entry.slice(i + 1).trim();
    if (name && pin) users.push({ name, pin });
  }
  return users;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

// Constant-time match so the PIN can't be guessed by timing.
function findUserByPin(users, pin) {
  const given = sha256(pin);
  let found = null;
  for (const u of users) {
    if (crypto.timingSafeEqual(given, sha256(u.pin)) && !found) found = u;
  }
  return found;
}

const SESSION_HOURS = 12;

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeSession(secret, name) {
  const payload = Buffer.from(JSON.stringify({ n: name, e: Date.now() + SESSION_HOURS * 3600 * 1000 })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

// Returns the user name, or null. A session also dies if that person's PIN is removed.
function readSession(secret, cookie, users) {
  if (!cookie || !cookie.includes('.')) return null;
  const [payload, mac] = cookie.split('.');
  const expected = sign(secret, payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const { n, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > e) return null;
    return users.some((u) => u.name === n) ? n : null;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Simple in-memory fixed-window limiter: at most `max` hits per key per `windowMs`.
class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  // Returns seconds to wait if over the limit, else 0 (and counts the hit).
  hit(key) {
    const now = Date.now();
    let h = this.hits.get(key);
    if (!h || now > h.reset) {
      h = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, h);
    }
    if (h.count >= this.max) return Math.ceil((h.reset - now) / 1000);
    h.count += 1;
    if (this.hits.size > 10000) this.prune(now);
    return 0;
  }

  // Seconds to wait if the key is already over the limit, without counting a hit.
  blocked(key) {
    const h = this.hits.get(key);
    const now = Date.now();
    if (!h || now > h.reset || h.count < this.max) return 0;
    return Math.ceil((h.reset - now) / 1000);
  }

  prune(now) {
    for (const [k, h] of this.hits) if (now > h.reset) this.hits.delete(k);
  }
}

module.exports = { parsePins, findUserByPin, makeSession, readSession, parseCookies, RateLimiter, SESSION_HOURS };
