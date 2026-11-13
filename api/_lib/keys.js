// Access keys and per-key daily limits.
//
// Keys come from keys.json in the project folder (copy keys.example.json), or from the
// BADGERBOX_KEYS environment variable holding the same JSON. Shape:
//   { "8008": { "name": "test key", "runsPerDay": 20 }, "another-key": { "name": "sam", "runsPerDay": 5 } }
// A "run" is one worksheet solved (or one question re-run). Follow-up questions and tl;dr
// summaries get ten times the run limit.
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

export function keyOf(req) {
  const h = req.headers || {};
  return String(h['x-bb-key'] || '').trim();
}

// What a key is allowed, and what it has used today. null if the key isn't valid.
export function keyInfo(key) {
  const entry = loadKeys()[key];
  if (!key || !entry) return null;
  const runsPerDay = Math.max(0, Number(entry.runsPerDay) || 0);
  const day = ((readUsage()[today()] || {})[key]) || {};
  return { name: entry.name || '', runsPerDay, asksPerDay: runsPerDay * 10, runs: day.runs || 0, asks: day.asks || 0 };
}

// Check the key and its limit, and count one use. kind: 'run' | 'ask'.
export function useKey(req, kind) {
  const key = keyOf(req);
  const info = keyInfo(key);
  if (!info) return { ok: false, error: 'that access key is not valid. go back to the enter screen and type your key again.' };
  const used = kind === 'run' ? info.runs : info.asks;
  const limit = kind === 'run' ? info.runsPerDay : info.asksPerDay;
  if (used >= limit) {
    return { ok: false, error: 'daily limit reached: ' + limit + (kind === 'run' ? ' runs' : ' questions') + ' per day on this key. it resets at midnight.' };
  }
  const u = readUsage();
  const day = today();
  // keep only today's counts
  const next = { [day]: Object.assign({}, u[day] || {}) };
  const mine = Object.assign({ runs: 0, asks: 0 }, next[day][key] || {});
  if (kind === 'run') mine.runs += 1; else mine.asks += 1;
  next[day][key] = mine;
  writeUsage(next);
  return { ok: true, limit: { used: kind === 'run' ? mine.runs : mine.asks, limit, kind } };
}
