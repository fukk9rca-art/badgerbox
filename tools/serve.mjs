// Local dev server: serves the pages and runs the api/ routes the same way Vercel does.
//
//   node tools/serve.mjs            -> http://localhost:3000
//   ANTHROPIC_API_KEY=... node tools/serve.mjs   (real model)
import http from 'node:http';
import { exec, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Settings live in a .env file in the project folder (never uploaded to GitHub):
//   ANTHROPIC_API_KEY=sk-ant-...
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (err) { /* no .env file: runs with the sample answers */ }
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png'
};

function shim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

// Only these may be handed out, and only by their real names: the pages at the top level, and the scripts
// and styles in css/, js/ and vendor/. Everything else (settings, keys, server code, skills) is refused.
// The check runs on the file's real path, so Windows short names (KEYS~1.JSO), alternate data streams
// (name::$DATA), trailing dots, links and ".." cannot reach anything that is not on the list.
const REAL_ROOT = fs.realpathSync.native(ROOT);
const MAY_SERVE = { '': /^[a-z0-9-]+\.html$|^favicon\.svg$/, css: /^[\w.-]+\.css$/, js: /^[\w.-]+\.js$/, vendor: /^[\w.-]+\.(js|mjs)$/ };
function safeFile(p) {
  if (/[:~*?"<>|\0]/.test(p) || /[. ]([\\/]|$)/.test(p)) return null;
  let real;
  try { real = fs.realpathSync.native(path.join(ROOT, p)); } catch (err) { return null; }
  const rel = path.relative(REAL_ROOT, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(/[\\/]+/).map((x) => x.toLowerCase());
  if (parts.some((x) => x.startsWith('.'))) return null;
  const rule = MAY_SERVE[parts.length === 1 ? '' : parts[0]];
  if (!rule || !rule.test(parts[parts.length - 1])) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch (err) { return null; }
  return real;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!name || !fs.existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
    let raw = '';
    let tooBig = false;
    for await (const chunk of req) { if (raw.length > 60e6) { tooBig = true; break; } raw += chunk; }
    if (tooBig) { shim(res).status(413).json({ source: 'error', error: 'that is too much to send at once' }); return; }
    try { req.body = raw ? JSON.parse(raw) : {}; } catch (err) { req.body = {}; }
    const mod = await import(pathToFileURL(file).href);
    busyApi++;
    try { await mod.default(req, shim(res)); } catch (err) { shim(res).status(500).json({ source: 'error', error: String(err) }); } finally { busyApi--; }
    return;
  }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (err) { res.statusCode = 400; res.end('bad request'); return; }
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p) && /^\/[a-z0-9-]+$/i.test(p)) p += '.html';
  const file = safeFile(p);
  if (!file) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('cache-control', 'no-cache, no-store');   // always the newest pages and scripts after an update
  fs.createReadStream(file).pipe(res);
});

// When the server code (api/ or this file) is updated on disk, start a fresh copy so the update takes
// effect without anyone closing this window. Pages and scripts are always read fresh, so they never need this.
const codeStamp = () => {
  let newest = 0;
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.m?js$/.test(e.name)) newest = Math.max(newest, fs.statSync(f).mtimeMs); } };
  try { walk(path.join(ROOT, 'api')); newest = Math.max(newest, fs.statSync(path.join(ROOT, 'tools', 'serve.mjs')).mtimeMs); } catch (err) {}
  return newest;
};
const startStamp = codeStamp();
let busyApi = 0, swapping = false;
const watcher = setInterval(() => {
  if (swapping || busyApi > 0 || codeStamp() === startStamp) return;
  swapping = true;
  clearInterval(watcher);
  console.log('badgerbox was updated. loading the new version...');
  if (six) { try { six.close(); if (six.closeAllConnections) six.closeAllConnections(); } catch (err) {} }
  server.close(() => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs')], { stdio: 'inherit', env: Object.assign({}, process.env, { BADGERBOX_OPEN: '0' }) });
    child.on('exit', (code) => process.exit(code || 0));
  });
  if (server.closeAllConnections) server.closeAllConnections();
}, 3000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log('badgerbox is already running (port ' + PORT + ' is in use). open http://localhost:' + PORT + ' or close the other badgerbox window first.');
  else console.log('could not start: ' + err.message);
});
// Listen on this computer only. Other devices on the same Wi-Fi cannot connect; friends come in through the
// share link, which reaches badgerbox from this computer. Set BADGERBOX_HOST=0.0.0.0 to open it to the network.
const HOST = process.env.BADGERBOX_HOST || '127.0.0.1';
const six = HOST === '127.0.0.1' ? http.createServer(server.listeners('request')[0]) : null;
if (six) { six.on('error', () => {}); six.listen(PORT, '::1'); }
server.listen(PORT, HOST, () => {
  console.log('badgerbox is running: http://localhost:' + PORT);
  console.log(process.env.ANTHROPIC_API_KEY ? 'model: connected (real answers)' : 'model: not connected (sample answers). add your key to the .env file to turn it on.');
  console.log('leave this window open while you use badgerbox. close it to stop.');
  if (process.env.BADGERBOX_OPEN === '1') {
    const url = 'http://localhost:' + PORT + '/';
    exec(process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"', () => {});
  }
});
