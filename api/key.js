// POST /api/key: is this access key valid, and how much of today's limit is left?
// Body: { key }   Reply: { ok, name, runsPerDay, runsToday }
import { keyInfo } from './_lib/keys.js';
import { readBody } from './_lib/claude.js';

export default function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'use POST' }); return; }
  const info = keyInfo(String(readBody(req).key || '').trim());
  if (!info) { res.status(200).json({ ok: false }); return; }
  res.status(200).json({ ok: true, name: info.name, runsPerDay: info.runsPerDay, runsToday: info.runs });
}
