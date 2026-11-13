// POST /api/ask: follow-up questions from the walkthrough's chat box.
// Body: { question, context: { text, answer, steps }, cls }
// Reply: { source: 'model', answer } | { source: 'mock' } | { source: 'error', error }
import { useKey } from './_lib/keys.js';
import { hasKey, callModel, classText, readBody } from './_lib/claude.js';

const SYSTEM = `You are badgerbox, answering a student's follow-up question about one worked homework problem.
Answer in plain lowercase-friendly language, 1 to 5 short sentences, or a short worked example if they ask
for one. Refer to steps by number. If they paste their own answer to check, say which step it went off at.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ source: 'error', error: 'use POST' }); return; }
  if (!hasKey()) { res.status(200).json({ source: 'mock' }); return; }
  const gate = useKey(req, 'ask');
  if (!gate.ok) { res.status(200).json({ source: 'error', error: gate.error }); return; }
  const body = readBody(req);
  const ctx = body.context || {};
  const steps = (ctx.steps || []).map((s, i) => 'step ' + (i + 1) + ': ' + s.text + ' -> ' + s.result).join('\n');
  const prompt = [
    classText(body.cls),
    'The problem: ' + String(ctx.text || ''),
    'The worked answer: ' + String(ctx.answer || ''),
    steps ? 'The steps:\n' + steps : '',
    'The student asks: ' + String(body.question || '').slice(0, 4000)
  ].filter(Boolean).join('\n\n');
  try {
    const answer = await callModel({ system: SYSTEM, content: [{ type: 'text', text: prompt }], maxTokens: 1200 });
    res.status(200).json({ source: 'model', answer: answer.trim() });
  } catch (err) {
    res.status(200).json({ source: 'error', error: String(err && err.message || err) });
  }
}
