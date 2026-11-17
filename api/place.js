// POST /api/place: works out where each answer should be written on the worksheet.
// Body: { pages: [{ n, url }], items: [{ i, number, text, answer, page }] }
//   pages: the worksheet pictures with a ruler grid drawn over them (n = the picture's number)
// Reply: { source: 'model', places: [{ i, page, x, y, w }] } | { source: 'mock' } | { source: 'error', error }
import { useKey } from './_lib/keys.js';
import { hasKey, callJson, fileBlock, readBody } from './_lib/claude.js';

const SYSTEM = `You are doing worksheet placement for badgerbox. You get pictures of a student's worksheet and a
list of answers. Decide exactly where on the page a student would write each answer.

Each picture has a red ruler grid drawn over it: lines every tenth of the page, labelled 0.0 to 1.0 along
the top and bottom (x, left to right) and down both sides (y, top to bottom). Use the labels to read
positions. The grid is not part of the worksheet.

For each answer:
- Find its question on the page (match the number and the wording).
- Find the place meant for the answer: the blank line, the empty box, the gap in a sentence, the space after
  "=" or "Answer:", the table cell, or the empty space right under or beside the question.
- Give the top-left corner of where the writing should START, as x and y from 0 to 1, read off the grid to
  two decimals. Writing must start inside the blank space, a little in from its left edge, and sit ON the
  line, so put y slightly above a blank line (about 0.02 above it).
- Give w: how wide that space is, as a share of the page width.
- Never put an answer on top of printed text or a picture. Never give two answers the same spot.
- If the question is not on any of the pictures, leave that answer out.

Reply with JSON only: {"places": [{"i": 0, "page": 1, "x": 0.12, "y": 0.34, "w": 0.4}]}
"i" is the answer's index from the list, "page" is the picture's number as given.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ source: 'error', error: 'use POST' }); return; }
  if (!hasKey()) { res.status(200).json({ source: 'mock' }); return; }
  const gate = useKey(req, 'ask');
  if (!gate.ok) { res.status(200).json({ source: 'error', error: gate.error }); return; }
  const body = readBody(req);
  const pages = (Array.isArray(body.pages) ? body.pages : []).slice(0, 8);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 80);
  if (!pages.length || !items.length) { res.status(200).json({ source: 'model', places: [] }); return; }
  const content = [];
  pages.forEach((p) => { const b = fileBlock(p); if (b) { content.push({ type: 'text', text: 'Picture ' + Number(p.n) + ':' }); content.push(b); } });
  content.push({ type: 'text', text: 'The answers to place:\n' + items.map((it) =>
    'i=' + Number(it.i) + ' | question ' + String(it.number).slice(0, 10) + ': ' + String(it.text || '').slice(0, 300) + ' | answer: ' + String(it.answer || '').slice(0, 200) +
    (it.page ? ' | probably on picture ' + Number(it.page) : '')).join('\n') });
  try {
    const out = await callJson({ system: SYSTEM, content, maxTokens: 4000 });
    const nums = pages.map((p) => Number(p.n));
    const places = (Array.isArray(out.places) ? out.places : []).map((p) => ({
      i: Number(p.i), page: Number(p.page), x: Number(p.x), y: Number(p.y), w: Number(p.w)
    })).filter((p) => Number.isInteger(p.i) && p.i >= 0 && nums.includes(p.page) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
      .map((p) => ({ i: p.i, page: p.page, x: p.x, y: p.y, w: Math.min(1, Math.max(0.1, isFinite(p.w) ? p.w : 0.4)) }));
    res.status(200).json({ source: 'model', places });
  } catch (err) {
    res.status(200).json({ source: 'error', error: String(err && err.message || err) });
  }
}
