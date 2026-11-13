// POST /api/tldr: the whole assignment in a nutshell, built when the student clicks tl;dr.
// Body: { title, subject, cls: { name, rules }, hint, questions: [{ text, answer }] }
// Reply: { source: 'model', tldr: { topic, nutshell, basis, sections: [{ head, items }] } } | { source: 'mock' } | { source: 'error', error }
import { hasKey, callModel, parseJson, classText, readBody } from './_lib/claude.js';

const SYSTEM = `You write the tl;dr for badgerbox: a short study summary of what one homework assignment is teaching.
Work out what the student is learning from the assignment itself and their class. Do not ask them: most students
can't name the unit. Assume from context (the material, the class, the kind of questions). If the student gave a
hint about what they are learning, build around it. For literature or history, tie it to the themes and skills a
class at that level is practising with that text or period; for math and science, to the principle and method.

Reply with JSON only:
{"topic": "a few words: what they're learning", "nutshell": "one or two plain sentences: the whole thing in a nutshell",
 "basis": "one short sentence saying what you based this on (their class, the assignment, their hint)",
 "sections": [
   {"head": "key ideas", "items": ["3 to 5 things to understand"]},
   {"head": "how to do it", "items": ["the general method for this kind of work, step by step, the way their class does it"]},
   {"head": "watch out for", "items": ["2 to 4 common mistakes"]},
   {"head": "remember", "items": ["2 to 4 things to take away for class or a test"]}]}
Write in plain lowercase-friendly language. Each item is one sentence. Teach the material, don't restate the answers.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ source: 'error', error: 'use POST' }); return; }
  if (!hasKey()) { res.status(200).json({ source: 'mock' }); return; }
  const body = readBody(req);
  const qs = (body.questions || []).slice(0, 40).map((q, i) => (i + 1) + '. ' + String(q.text || '').slice(0, 1500) + '\n   answer: ' + String(q.answer || '').slice(0, 1500)).join('\n');
  const prompt = [
    classText(body.cls),
    body.subject ? 'Subject: ' + body.subject + '.' : '',
    body.title ? 'Assignment: ' + body.title + '.' : '',
    body.hint ? 'The student says they are learning: ' + String(body.hint).slice(0, 500) : '',
    'The assignment and its worked answers:\n' + qs
  ].filter(Boolean).join('\n\n');
  try {
    const out = parseJson(await callModel({ system: SYSTEM, content: [{ type: 'text', text: prompt }], maxTokens: 2500 }));
    const sections = (Array.isArray(out.sections) ? out.sections : []).slice(0, 6)
      .map((s) => ({ head: String(s.head || ''), items: (Array.isArray(s.items) ? s.items : []).slice(0, 6).map(String) }))
      .filter((s) => s.head && s.items.length);
    res.status(200).json({ source: 'model', tldr: { topic: String(out.topic || ''), nutshell: String(out.nutshell || ''), basis: String(out.basis || ''), sections } });
  } catch (err) {
    res.status(200).json({ source: 'error', error: String(err && err.message || err) });
  }
}
