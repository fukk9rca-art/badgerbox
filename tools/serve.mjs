// Local dev server: serves the pages and runs the api/ routes the same way Vercel does.
//
//   node tools/serve.mjs            -> http://localhost:3000
//   ANTHROPIC_API_KEY=... node tools/serve.mjs   (real model)
import http from 'node:http';
import { exec } from 'node:child_process';
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!name || !fs.existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch (err) { req.body = {}; }
    const mod = await import(pathToFileURL(file).href);
    try { await mod.default(req, shim(res)); } catch (err) { shim(res).status(500).json({ source: 'error', error: String(err) }); }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  // never hand out settings, keys or server code
  if (/(^|\/)\./.test(p) || /^\/(api|tools|node_modules)\//.test(p) || /^\/(keys|usage|package|vercel)[^/]*\.json$/.test(p)) { res.statusCode = 404; res.end('not found'); return; }
  if (!path.extname(p) && fs.existsSync(path.join(ROOT, p + '.html'))) p += '.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log('badgerbox is already running (port ' + PORT + ' is in use). open http://localhost:' + PORT + ' or close the other badgerbox window first.');
  else console.log('could not start: ' + err.message);
});
server.listen(PORT, () => {
  console.log('badgerbox is running: http://localhost:' + PORT);
  console.log(process.env.ANTHROPIC_API_KEY ? 'model: connected (real answers)' : 'model: not connected (sample answers). add your key to the .env file to turn it on.');
  console.log('leave this window open while you use badgerbox. close it to stop.');
  if (process.env.BADGERBOX_OPEN === '1') {
    const url = 'http://localhost:' + PORT + '/';
    exec(process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"', () => {});
  }
});
