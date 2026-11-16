// Starts badgerbox on this computer and opens a private link to it for friends.
// The link is made by cloudflared (a free Cloudflare tool). The code, the API key and
// keys.json stay on this computer: friends only reach the pages and the answers.
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 3000);
await import('./serve.mjs');
await new Promise((r) => setTimeout(r, 700));

console.log('\nopening a share link (this takes a few seconds)...');
const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', 'http://localhost:' + PORT], { stdio: ['ignore', 'pipe', 'pipe'] });
let shown = false, tail = '';
const read = (buf) => {
  tail = (tail + String(buf)).slice(-4000);
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(tail);
  if (m && !shown) {
    shown = true;
    const line = '='.repeat(Math.max(40, m[0].length + 6));
    console.log('\n' + line + '\n   ' + m[0] + '\n' + line);
    console.log('\nsend that link to your friends, with the access key you made for each one.');
    console.log('- it works only while this window is open and this computer is on.');
    console.log('- the link is new every time you start sharing.');
    console.log('- the key 8008 does not work through the link, only on this computer.');
    console.log('- close this window to stop sharing.\n');
  }
};
cf.stdout.on('data', read);
cf.stderr.on('data', read);
cf.on('error', () => { console.log('\ncould not start cloudflared. run share-badgerbox.bat again and let it install it.'); process.exit(1); });
cf.on('exit', (code) => { console.log(shown ? '\nthe share link has closed.' : '\nthe share link did not open. check your internet and try again.\n' + tail.slice(-600)); process.exit(code || 0); });
const stop = () => { try { cf.kill(); } catch (err) {} process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
