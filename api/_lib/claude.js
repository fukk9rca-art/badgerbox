// Shared helpers for the badgerbox API routes: one place that talks to the model.
//
// Set ANTHROPIC_API_KEY to turn the real model on. Without it every route
// answers { source: 'mock' } and the site shows its built-in sample run.

export const MODEL = process.env.BADGERBOX_MODEL || 'claude-sonnet-5-5';

// BADGERBOX_FAKE=1 pretends a model is connected and returns canned answers.
// It exists only to test the live code path without a key or any cost.
const FAKE = process.env.BADGERBOX_FAKE === '1';

export function hasKey() {
  return FAKE || !!process.env.ANTHROPIC_API_KEY;
}

function fakeReply(system, content) {
  const asked = (content || []).map((b) => b.text || '').join(' ');
  if (/follow-up/.test(system) && /french revolution/i.test(asked)) return JSON.stringify({ kind: 'redirect', tab: 'social', answer: 'that is a history question. this chat is for the algebra assignment, so ask it in the social tab.' });
  if (/follow-up/.test(system) && /tell me a joke/i.test(asked)) return JSON.stringify({ kind: 'refuse', tab: null, answer: 'badgerbox only helps with the assignment in front of you.' });
  if (/worksheet placement/.test(system)) return JSON.stringify({ places: [{ i: 0, page: 1, x: 0.30, y: 0.20, w: 0.3 }, { i: 1, page: 1, x: 0.30, y: 0.45, w: 0.3 }, { i: 2, page: 2, x: 0.20, y: 0.30, w: 0.5 }, { i: 3, page: 9, x: 0.5, y: 0.5, w: 0.2 }] });
  if (/checker/.test(system)) {
    return JSON.stringify({ checks: [
      { number: 1, agree: true, check: 'substituted x = 5 back in: 3(5) + 7 = 22.', note: null },
      { number: 2, agree: false, check: 'graphing both sides gives x = 3.5, not 4.', note: 'step 2 divides only one side by 2.' },
      { number: 3, agree: true, check: 'checked two more points on the line: (1, 1) and (2, 3).', note: null },
      { number: 4, agree: true, check: 'recounted the bins from the sorted list.', note: null }
    ] });
  }
  if (/follow-up/.test(system)) return 'fake model: this is where the real follow-up answer goes.';
  if (/tl;dr/.test(system)) {
    return JSON.stringify({ topic: 'solving linear equations', nutshell: 'undo what was done to x, in reverse order, doing the same thing to both sides.',
      basis: 'worked out from the assignment (fake model).', sections: [
        { head: 'key ideas', items: ['an equation stays true if you do the same thing to both sides.', 'undo addition and subtraction first, then multiplication and division.'] },
        { head: 'how to do it', items: ['move the plain numbers away from x.', 'divide by the number in front of x.', 'put the answer back in to check.'] },
        { head: 'watch out for', items: ['dividing only one side.'] },
        { head: 'remember', items: ['always check by substituting.'] }] });
  }
  if (/ONE QUESTION IS BEING DONE AGAIN/.test(asked)) return JSON.stringify({ subject: 'algebra', level: 'easy', title: 'linear equations', questions: [
    { number: 2, text: 'Solve 2x - 1 = 9', answer: 'x = 5', unclear: null, steps: [{ text: 'add 1 to both sides', result: '2x = 10', why: 'undo the - 1.' }, { text: 'divide by 2', result: 'x = 5', why: 'undo the times 2.' }] }] });
  return JSON.stringify({ subject: 'algebra', level: 'easy', title: 'linear equations', questions: [
    { number: 1, text: 'Solve 3x + 7 = 22', answer: 'x = 5', unclear: null, anchor: { p: 2, slide: 1 }, place: { page: 1, x: 0.55, y: 0.1, w: 0.4 }, steps: [
      { text: 'take 7 from both sides', result: '3x = 15', why: 'undo the + 7 first so the x term is alone.' },
      { text: 'divide both sides by 3', result: 'x = 5', why: 'undo the times 3.' }] },
    { number: 2, text: 'Solve 2x - 1 = 6', answer: 'x = 4', unclear: null, anchor: { p: 3, slide: 2 }, place: { page: 1, x: 0.55, y: 0.4, w: 0.4 }, steps: [
      { text: 'add 1 to both sides', result: '2x = 7', why: 'undo the - 1.' },
      { text: 'divide by 2', result: 'x = 4', why: 'undo the times 2.' }] },
    { number: 3, text: 'Graph y = 2x - 1 and mark the intercepts', answer: 'a line through (0, -1) and (0.5, 0)', unclear: null, place: { page: 2, x: 0.1, y: 0.2, w: 0.8 },
      figure: { type: 'function', title: 'y = 2x - 1', expr: '2x - 1', domain: [-4, 4], points: [[0, -1], [0.5, 0]] }, steps: [
      { text: 'find the y-intercept', result: '(0, -1)', why: 'set x to 0.' },
      { text: 'find the x-intercept', result: '(0.5, 0)', why: 'set y to 0 and solve.' }] },
    { number: 4, text: 'Make a histogram of the quiz scores 62 70 71 74 75 78 80 81 83 85 88 90 94', answer: 'most scores fall between 70 and 90', unclear: null,
      figure: { type: 'histogram', title: 'quiz scores', xLabel: 'score', yLabel: 'count', values: [62, 70, 71, 74, 75, 78, 80, 81, 83, 85, 88, 90, 94] }, steps: [
      { text: 'pick equal bins', result: 'width 10', why: 'equal bins make the bars comparable.' },
      { text: 'count the scores in each bin', result: '1, 5, 5, 2', why: 'each score goes in exactly one bin.' }] }
  ] });
}

// Returns the reply text. With full: true, returns { text, cut } where cut means the reply hit the length limit.
export async function callModel({ system, content, maxTokens = 8000, full = false }) {
  if (FAKE) {
    await new Promise((r) => setTimeout(r, Number(process.env.BADGERBOX_FAKE_DELAY) || 0));
    let t = fakeReply(system, content);
    // test hooks: a reply with a stray quote in it, or one cut off part way
    const broke = process.env.BADGERBOX_FAKE_BREAK || '';
    if (broke && !/fix broken JSON/.test(system) && !/checker/.test(system) && !globalThis.bbBrokeOnce) {
      globalThis.bbBrokeOnce = true;
      if (broke === 'quote') t = t.replace('"take 7 from both sides"', '"take 7 from "both" sides"');
      if (broke === 'cut') return full ? { text: t.slice(0, 400), cut: true } : t.slice(0, 400);
    }
    if (/fix broken JSON/.test(system)) t = (content[0].text || '').replace('from "both" sides', 'from both sides');
    return full ? { text: t, cut: false } : t;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('model request failed (' + res.status + ')');
    throw new Error(msg);
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return full ? { text, cut: data.stop_reason === 'max_tokens' } : text;
}

// Small repairs that need no second model call: math written with single backslashes ("\frac"), and
// trailing commas. Returns the parsed object or null.
function repairLocally(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const body = text.slice(start, end + 1)
    .replace(/\\(?!["\\/nrtu]|[bf](?![a-zA-Z]))/g, '\\\\')
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(body); } catch (err) { return null; }
}

// Ask the model for JSON and make sure JSON comes back. If the reply is broken it is repaired here when
// possible, otherwise the model is asked once more: to carry on shorter if it ran out of room, or to fix
// the broken reply if a quote or bracket was off.
export async function callJson({ system, content, maxTokens = 8000 }) {
  const first = await callModel({ system, content, maxTokens, full: true });
  try { return parseJson(first.text); } catch (err) { /* fall through to repairs */ }
  const local = repairLocally(first.text);
  if (local) return local;
  if (first.cut) {
    const again = await callModel({
      system,
      content: content.concat([{ type: 'text', text: 'Your last reply was too long and got cut off. Answer again, complete this time: keep every question, but at most 3 steps each, and one short sentence for each "why".' }]),
      maxTokens: Math.min(32000, maxTokens * 2), full: true
    });
    try { return parseJson(again.text); } catch (err) { const l2 = repairLocally(again.text); if (l2) return l2; }
    throw new Error('this assignment is too long to do in one go. run it in two parts (half the pages each).');
  }
  const fixed = await callModel({
    system: 'You fix broken JSON. Reply with the corrected JSON only and change nothing else: same keys, same text. Escape double quotes inside strings as \\" and backslashes as \\\\, and remove raw line breaks inside strings.',
    content: [{ type: 'text', text: first.text.slice(0, 120000) }],
    maxTokens: Math.min(32000, maxTokens + 2000)
  });
  try { return parseJson(fixed); } catch (err) { const l3 = repairLocally(fixed); if (l3) return l3; }
  throw new Error('the answer came back garbled twice. press run again.');
}

// Pull the first JSON object out of a model reply (it may wrap it in prose or a code fence).
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('the model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

// data: URL from the browser -> a content block the model can read.
export function fileBlock(file) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec((file && file.url) || '');
  if (!m) return null;
  const mediaType = m[1];
  const data = m[2];
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: mediaType, data } };
  }
  if (/^image\/(png|jpeg|gif|webp)$/.test(mediaType)) {
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  }
  if (mediaType === 'text/plain') {
    return { type: 'text', text: Buffer.from(data, 'base64').toString('utf8').slice(0, 40000) };
  }
  return null;
}

export function classText(cls) {
  if (!cls || !cls.name) return 'No class was given. Use the standard method for the level the work looks like.';
  const rules = (cls.rules || []).filter(Boolean);
  return 'The student\'s class: ' + cls.name + '.' +
    (rules.length ? ' How they want the work done: ' + rules.map((r, i) => (i + 1) + ') ' + r).join(' ') + '.' : '');
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (err) { return {}; }
}
