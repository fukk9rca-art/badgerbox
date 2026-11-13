// POST /api/solve
// Body: { tab, text, cls: { name, rules }, answers, outputs, picked: [numbers], files: [{ type, url }] }
// Reply: { source: 'model', subject, level, modelLabel, questions: [...] } | { source: 'mock' } | { source: 'error', error }
//
// Two passes: the first finds and works every question, the second solves each
// one again a different way and compares. Answers that don't match get flagged.
import { MODEL, hasKey, callModel, parseJson, fileBlock, classText, readBody } from './_lib/claude.js';

const SOLVE_SYSTEM = `You are badgerbox, a homework walkthrough tool for high school and college students.
You get an assignment as text, photos, a PDF, or any mix. Find every separate question in it, keep the
assignment's own numbering and order, and work each one fully, showing the method so the student can
follow it and do the next one themselves.

Rules:
- Work each question the way the student's class does it (given below). Follow their stated preferences
  for method, units, rounding and format.
- Steps: 2 to 6 per question. Each step has a short action ("turn the mass into moles"), a short result
  ("25.0 / 18.02 = 1.39 mol") and a "why" of 1 to 3 plain sentences.
- If part of a question can't be read or is ambiguous, still give your best answer but say exactly what is
  unclear in "unclear" (otherwise null). Never invent missing numbers silently.
- For writing tasks, the answer is the finished piece and the steps explain the plan and choices.
- Reply with JSON only, no prose, in exactly this shape:
{"subject": "short subject, e.g. chemistry", "level": "easy|medium|hard", "title": "short name for the assignment",
 "questions": [{"number": 1, "text": "the question as written", "answer": "the final answer",
   "steps": [{"text": "...", "result": "...", "why": "..."}], "unclear": null}]}`;

const CHECK_SYSTEM = `You are the checker for badgerbox. For each question, solve it yourself from scratch using a
different method or route than the obvious one (work backwards, substitute the answer in, estimate, use
another formula), then compare with the answer given. Reply with JSON only:
{"checks": [{"number": 1, "agree": true, "check": "one sentence: the second way and what it gave",
  "note": "if they disagree: which step looks wrong and why, else null"}]}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ source: 'error', error: 'use POST' }); return; }
  if (!hasKey()) { res.status(200).json({ source: 'mock' }); return; }

  const body = readBody(req);
  const blocks = (body.files || []).map(fileBlock).filter(Boolean).slice(0, 3);
  const text = String(body.text || '').slice(0, 20000);
  if (!blocks.length && !text.trim()) { res.status(400).json({ source: 'error', error: 'nothing to solve' }); return; }

  const answers = body.answers || {};
  const extra = Object.keys(answers)
    .filter((k) => answers[k] && k !== 'classSaved')
    .map((k) => k + ': ' + String(answers[k]).slice(0, 2000));
  const picked = Array.isArray(body.picked) && body.picked.length ? body.picked : null;

  const brief = [
    'Subject tab the student picked: ' + (body.tab || 'auto') + '.',
    classText(body.cls),
    picked ? 'Only do these question numbers: ' + picked.join(', ') + '.' : 'Do every question.',
    extra.length ? 'Extra context the student gave:\n' + extra.join('\n') : '',
    text ? 'The student typed:\n' + text : ''
  ].filter(Boolean).join('\n\n');

  try {
    const solved = parseJson(await callModel({
      system: SOLVE_SYSTEM,
      content: blocks.concat([{ type: 'text', text: brief }])
    }));
    const qs = Array.isArray(solved.questions) ? solved.questions : [];
    if (!qs.length) throw new Error('no questions found in the assignment');

    let checks = [];
    try {
      const list = qs.map((q) => '#' + q.number + ': ' + q.text + '\nanswer given: ' + q.answer).join('\n\n');
      const checked = parseJson(await callModel({
        system: CHECK_SYSTEM,
        content: [{ type: 'text', text: classText(body.cls) + '\n\n' + list }],
        maxTokens: 4000
      }));
      checks = Array.isArray(checked.checks) ? checked.checks : [];
    } catch (err) {
      checks = [];
    }

    const questions = qs.map((q, i) => {
      const c = checks.find((x) => String(x.number) === String(q.number)) || checks[i] || null;
      const agree = !!(c && c.agree);
      const flag = q.unclear || (c && !c.agree ? (c.note || 'the second way gave a different answer') : (!c ? 'the check pass did not finish, so this answer is unchecked' : null));
      return {
        number: q.number || i + 1,
        text: String(q.text || ''),
        ans: String(q.answer || ''),
        steps: (q.steps || []).slice(0, 6).map((s) => ({ text: String(s.text || ''), result: String(s.result || ''), why: String(s.why || '') })),
        check: c ? String(c.check || '') : '',
        sure: agree && !q.unclear,
        flag: flag ? String(flag) : null
      };
    });

    res.status(200).json({
      source: 'model',
      subject: solved.subject || body.tab || 'homework',
      level: solved.level || 'medium',
      title: solved.title || '',
      modelLabel: MODEL,
      questions
    });
  } catch (err) {
    res.status(200).json({ source: 'error', error: String(err && err.message || err) });
  }
}
