// Skills: one folder per kind of schoolwork under /skills, each with a SKILL.md (see skills/README.md).
// The matching skill is added to what the model is told, so a subject is done by that subject's rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRS = [path.join(process.cwd(), 'skills'), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')];
let cache = { stamp: '', list: [] };

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const head = {};
  (m ? m[1] : '').split(/\r?\n/).forEach((line) => { const k = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (k) head[k[1].toLowerCase()] = k[2].replace(/\s+\(.*\)\s*$/, '').trim(); });
  return {
    name: head.name || path.basename(path.dirname(file)),
    description: head.description || '',
    tabs: String(head.tabs || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    auto: /^(true|yes|1)$/i.test(head.auto || ''),
    body: (m ? m[2] : raw).trim().slice(0, 12000)
  };
}

export function loadSkills() {
  const dir = DIRS.find((d) => { try { return fs.statSync(d).isDirectory(); } catch (err) { return false; } });
  if (!dir) return [];
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name, 'SKILL.md')).filter((f) => fs.existsSync(f));
    const stamp = files.map((f) => f + ':' + fs.statSync(f).mtimeMs).join('|');
    if (stamp !== cache.stamp) cache = { stamp, list: files.map(parse) };
    return cache.list;
  } catch (err) { return []; }
}

// The skill text to add for this tab. A tab's own skill always applies; on the auto tab (and any tab with
// no skill of its own) the "auto" skills are offered and the model uses one only if the work matches.
export function skillText(tab) {
  const t = String(tab || 'auto').toLowerCase();
  const all = loadSkills();
  const own = all.filter((s) => s.tabs.includes(t));
  if (own.length) return '\n\n' + own.map((s) => 'SKILL FOR THIS ASSIGNMENT: ' + s.name + '\n' + s.body).join('\n\n');
  // offered only where the subject is open: math, science, language and code keep their own rules
  const maybe = ['auto', 'online', 'social', 'reading'].includes(t) ? all.filter((s) => s.auto) : [];
  if (!maybe.length) return '';
  return '\n\n' + maybe.map((s) => 'SKILL, USE ONLY IF THE ASSIGNMENT MATCHES: ' + s.name + ' (' + s.description + ')\n' + s.body).join('\n\n');
}

export function skillNames(tab) {
  const t = String(tab || 'auto').toLowerCase();
  return loadSkills().filter((s) => s.tabs.includes(t)).map((s) => s.name);
}
