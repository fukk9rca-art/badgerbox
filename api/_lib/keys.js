// Access keys and per-key daily limits.
//
// Keys come from keys.json in the project folder (copy keys.example.json), or from the
// BADGERBOX_KEYS environment variable holding the same JSON. Shape:
//   { "8008": { "name": "test key", "runsPerDay": 20 }, "another-key": { "name": "sam", "runsPerDay": 5 } }
// A "run" is about two pages of work (see costOf below), so a big pile costs more than a short worksheet.
// Follow-up questions and tl;dr summaries get ten times the run limit.
//
// Usage is counted in usage.json next to keys.json. On hosts with a read-only disk (Vercel)
// the count only lives in memory, so real limits there need a database. That is not built yet.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEYS_FILE = fileURLToPath(new URL('../../keys.json', import.meta.url));
const USAGE_FILE = fileURLToPath(new URL('../../usage.json', import.meta.url));
const DEFAULT_KEYS = { '8008': { name: 'test key', runsPerDay: 20 } };
let memory = null;

export function loadKeys() {
  try {
    if (process.env.BADGERBOX_KEYS) return JSON.parse(process.env.BADGERBOX_KEYS);
    if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch (err) {
    console.error('badgerbox: could not read the keys, using the test key only:', err.message);
  }
  return DEFAULT_KEYS;
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function readUsage() {
  if (memory) return memory;
  try { memory = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch (err) { memory = {}; }
  return memory;
}

function writeUsage(u) {
  memory = u;
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 1)); } catch (err) { /* read-only disk: keep it in memory */ }
}

// A request that came in through a share link (a tunnel adds these headers) rather than from this computer.
export function isRemote(req) {
  const h = (req && req.headers) || {};
  return !!(h['cf-connecting-ip'] || h['x-forwarded-for'] || h['cf-ray'] || h['x-real-ip']);
}
// The keys printed in this public repo (8008, change-me-...) only work on this computer, never through a share
// link. Anything shorter than 4 characters is refused there too.
export function weakKey(key) { const k = String(key); return k.length < 4 || k === '8008' || /^change-me/i.test(k); }

// Slow down guessing: after 15 wrong keys in 10 minutes, share-link visitors are locked out for 10 minutes.
// Counted per visitor, so one person guessing cannot lock everyone else out.
const bad = new Map();
export function visitor(req) { const h = (req && req.headers) || {}; return String(h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || 'remote').slice(0, 60); }
export function guessLocked(who) { const t = Date.now(); const list = (bad.get(who) || []).filter((x) => t - x < 600000); bad.set(who, list); return list.length >= 15; }
export function noteBad(who) { if (bad.size > 5000) bad.clear(); bad.set(who, (bad.get(who) || []).concat([Date.now()])); }

export function keyOf(req) {
  const h = req.headers || {};
  return String(h['x-bb-key'] || '').trim();
}

// What a key is allowed, and what it has used today. null if the key isn't valid.
export function keyInfo(key, req) {
  const remote = isRemote(req);
  const who = remote ? visitor(req) : '';
  if (remote && guessLocked(who)) return null;
  const entry = Object.prototype.hasOwnProperty.call(loadKeys(), key) ? loadKeys()[key] : null;
  if (!key || !entry || (remote && weakKey(key))) { if (remote && key) noteBad(who); return null; }
  const runsPerDay = Math.max(0, Number(entry.runsPerDay) || 0);
  const day = ((readUsage()[today()] || {})[key]) || {};
  return { name: entry.name || '', runsPerDay, asksPerDay: runsPerDay * 10, runs: day.runs || 0, asks: day.asks || 0 };
}

// Add n to today's count for this key (n can be negative to give some back). Returns the new count.
function bump(key, kind, n) {
  const u = readUsage();
  const day = today();
  // keep only today's counts
  const next = { [day]: Object.assign({}, u[day] || {}) };
  const mine = Object.assign({ runs: 0, asks: 0 }, next[day][key] || {});
  const field = kind === 'run' ? 'runs' : 'asks';
  mine[field] = Math.max(0, mine[field] + n);
  next[day][key] = mine;
  writeUsage(next);
  return mine[field];
}

// Check the key and its limit, and count n uses (a big assignment costs more than one run). kind: 'run' | 'ask'.
export function useKey(req, kind, n) {
  const cost = Math.max(1, Math.round(Number(n) || 1));
  const key = keyOf(req);
  const info = keyInfo(key, req);
  if (!info) return { ok: false, error: 'that access key is not valid. go back to the enter screen and type your key again.' };
  const used = kind === 'run' ? info.runs : info.asks;
  const limit = kind === 'run' ? info.runsPerDay : info.asksPerDay;
  if (used >= limit) {
    return { ok: false, out: true, error: 'that\'s all ' + limit + (kind === 'run' ? ' runs' : ' questions') + ' for today on this key. they come back at midnight.' };
  }
  if (used + cost > limit) {
    return { ok: false, error: 'this one needs ' + cost + ' runs and you have ' + (limit - used) + ' left today. split it into smaller parts, or wait until midnight.' };
  }
  const now = bump(key, kind, cost);
  return { ok: true, cost, limit: { used: now, limit, kind } };
}

// Give back runs that were charged for work that never came back (an error, or nothing to answer).
export function refund(req, kind, n) {
  const key = keyOf(req);
  if (!key || !(Number(n) > 0)) return;
  bump(key, kind, -Math.round(Number(n)));
}

// Charge more after the fact, when the work turned out bigger than the estimate. Never past the limit.
// Returns how many were actually added.
export function charge(req, kind, n) {
  const key = keyOf(req);
  const info = keyInfo(key, req);
  if (!info || !(Number(n) > 0)) return 0;
  const used = kind === 'run' ? info.runs : info.asks;
  const limit = kind === 'run' ? info.runsPerDay : info.asksPerDay;
  const add = Math.max(0, Math.min(Math.round(Number(n)), limit - used));
  if (add) bump(key, kind, add);
  return add;
}

// What a run will cost, from what was sent. About 2 pages make 1 run. Reference files and extra context count
// half, because the model still has to read them. js/bb-api.js has the same sum, so the button shows the price
// before anything is sent. Keep the two the same.
export const PAGES_PER_RUN = 2;
export function costOf(body) {
  let pages = 0;
  (Array.isArray(body && body.files) ? body.files : []).forEach((f) => {
    const url = String((f && f.url) || ''), share = f && f.ref ? 0.5 : 1;
    if (/^data:image\//.test(url)) pages += share;
    else if (/^data:application\/pdf/.test(url)) pages += share * Math.max(1, Math.round(url.length * 0.75 / 150000));
    else if (/^data:text\//.test(url)) pages += share * Math.max(1, Math.ceil(url.length * 0.75 / 2000));
  });
  pages += String((body && body.text) || '').length / 2000;
  pages += String((body && body.context) || '').length / 4000;
  return Math.max(1, Math.ceil(pages / PAGES_PER_RUN));
}
