// POST /api/place: works out where each answer should be written on the worksheet.
// Body: { pages: [{ n, url }], items: [{ i, number, text, answer, page }] }
//   pages: the worksheet pictures with a ruler grid drawn over them (n = the picture's number)
// Reply: { source: 'model', places: [{ i, page, x, y, w }] } | { source: 'mock' } | { source: 'error', error }
import { useKey } from './_lib/keys.js';
import { hasKey, callJson, fileBlock, readBody } from './_lib/claude.js';

const SYSTEM = `You are doing worksheet placement for badgerbox. You get pictures of a student's worksheet and a
list of answers. Decide where on the page a student would write each answer.

The pictures have been marked up for you:
- Every blank that was found on the page (an answer line, an empty table cell, an empty box) is tinted
  blue and has a label in its bottom-left corner: B1, B2, B3 and so on. Labels restart on each picture.
- A red ruler grid is drawn over the page, labelled 0.0 to 1.0 along the top and bottom (x, left to right)
  and down the sides (y, top to bottom).
Neither the blue blanks nor the grid are part of the worksheet.

For each answer:
1. Find its question on the page (match the number and the wording).
2. Find the blank meant for that answer and give its label as "tag". Look carefully at how the page is laid
   out. The blank may be right after the question, at the end of its line, in a numbered answer column at
   the side or bottom of the page (then the blank next to the same number), or a cell in a table (then the
   cell in the right row and column). A sentence with a gap takes the blank that is in the gap.
3. One answer per blank. If a question has several blanks, the answer list has one entry for each, in order.
4. Only if there is no blank for it at all: give "x", "y" and "w" read off the ruler grid to two decimals
   instead of "tag". x and y are the top-left corner of where the writing starts, in empty space next to or
   under the question, never on top of printed text. w is how wide that space is.
5. Never use a blank that is for something else (name, date, score). If the question is not on any
   picture, leave the answer out.

Reply with JSON only:
{"places": [{"i": 0, "page": 1, "tag": "B4"}, {"i": 1, "page": 1, "x": 0.12, "y": 0.34, "w": 0.4}]}
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
  pages.forEach((p) => { const b = fileBlock(p); if (b) { content.push({ type: 'text', text: 'Picture ' + Number(p.n) + ' (' + (Number(p.blanks) || 0) + ' blanks labelled):' }); content.push(b); } });
  content.push({ type: 'text', text: 'The answers to place:\n' + items.map((it) =>
    'i=' + Number(it.i) + ' | question ' + String(it.number).slice(0, 10) + ': ' + String(it.text || '').slice(0, 300) + ' | answer: ' + String(it.answer || '').slice(0, 200) +
    (it.page ? ' | probably on picture ' + Number(it.page) : '')).join('\n') });
  try {
    const out = await callJson({ system: SYSTEM, content, maxTokens: 4000 });
    const nums = pages.map((p) => Number(p.n));
    const places = (Array.isArray(out.places) ? out.places : []).map((p) => {
      const base = { i: Number(p.i), page: Number(p.page) };
      if (!Number.isInteger(base.i) || base.i < 0 || !nums.includes(base.page)) return null;
      const tag = /^B\d{1,3}$/.test(String(p.tag || '').trim().toUpperCase()) ? String(p.tag).trim().toUpperCase() : null;
      if (tag) return Object.assign(base, { tag });
      const x = Number(p.x), y = Number(p.y), w = Number(p.w);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
      return Object.assign(base, { x, y, w: Math.min(1, Math.max(0.1, isFinite(w) ? w : 0.4)) });
    }).filter(Boolean);
    res.status(200).json({ source: 'model', places });
  } catch (err) {
    res.status(200).json({ source: 'error', error: String(err && err.message || err) });
  }
}
