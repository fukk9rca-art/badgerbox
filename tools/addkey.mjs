// Makes an access key for a friend and saves it in keys.json.
//   node tools/addkey.mjs "sam" 5        -> name, worksheets per day
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'keys.json');
const name = String(process.argv[2] || '').trim().slice(0, 40) || 'friend';
const runs = Math.min(200, Math.max(1, Math.round(Number(process.argv[3]) || 5)));

let keys = {};
try { keys = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (err) { if (fs.existsSync(FILE)) { console.log('\n  keys.json could not be read (' + err.message + '). fix or delete it, then try again.'); process.exit(1); } }

// no look-alike letters, so it is easy to read out or type
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const rand = (n) => Array.from(crypto.randomBytes(n), (b) => ABC[b % ABC.length]).join('');
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'friend';
let key;
do { key = slug + '-' + rand(4) + '-' + rand(4); } while (keys[key]);

keys[key] = { name: name, runsPerDay: runs };
fs.writeFileSync(FILE, JSON.stringify(keys, null, 2) + '\n');
console.log('\n  key for ' + name + ':   ' + key);
console.log('  limit:         ' + runs + ' worksheets per day (' + runs * 10 + ' chat questions)');
console.log('\n  send ' + name + ' this key and your share link. it works right away.');
console.log('  to take it back, delete its line in keys.json.');
