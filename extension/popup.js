// Collects the assignment from the page you are on: a screenshot, the attached files and the
// teacher's instructions. Then asks the background script to open badgerbox with them.
const $ = (id) => document.getElementById(id);
const MAX_FILES = 3;            // badgerbox takes 3 files per run
const MAX_BYTES = 15 * 1024 * 1024;
const state = { shot: null, items: [], vids: [], busy: 0 };

// ---- runs inside the assignment page
function collect() {
  const out = { title: document.title || '', text: '', links: [], videos: [], au: null };
  const seen = {};
  const au = /\/u\/(\d+)\//.exec(location.pathname);
  out.au = au ? au[1] : null;
  const add = (kind, id, label, href) => {
    if (!id || seen[id]) return;
    seen[id] = 1;
    const a = /[?&]authuser=(\d+)/.exec(href || '');
    out.links.push({ kind: kind, id: id, au: a ? a[1] : null, label: String(label || '').replace(/^Attachment:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 80) });
  };
  const scan = (href, label) => {
    let m;
    if ((m = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(href))) add('doc', m[1], label, href);
    else if ((m = /docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(href))) add('slides', m[1], label, href);
    else if ((m = /docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(href))) add('sheet', m[1], label, href);
    else if ((m = /drive\.google\.com\/(?:u\/\d+\/)?file\/d\/([\w-]{20,})/.exec(href)) || (m = /drive\.google\.com\/(?:u\/\d+\/)?open\?(?:[^#]*&)?id=([\w-]{20,})/.exec(href))) add('file', m[1], label, href);
  };
  const vw = window.innerWidth, vh = window.innerHeight;
  // Classroom keeps old screens (the stream, other assignments) in the page: only count what is really showing
  const shown = (el) => {
    if (!el || el.closest('[aria-hidden="true"]')) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 && r.right > 0 && r.left < vw && r.bottom > -vh * 3 && r.top < vh * 6;
  };
  const onClassroom = /(^|\.)classroom\.google\.com$/.test(location.hostname);
  const onAssignment = /\/c\/[^/]+\/(a|m|sa|mc)\/[^/]+/.test(location.pathname);
  // YouTube videos: the page itself, links, and embedded players
  const vseen = {};
  const video = (href, label) => {
    const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(String(href || ''));
    if (!m || vseen[m[1]] || out.videos.length >= 4) return;
    vseen[m[1]] = 1;
    out.videos.push({ id: m[1], label: String(label || '').replace(/^Attachment:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 80) });
  };
  video(location.href, document.title);
  scan(location.href, document.title);
  if (!onClassroom || onAssignment) {
    document.querySelectorAll('a[href]').forEach((a) => { if (shown(a)) video(a.href, a.getAttribute('aria-label') || a.title || a.innerText); });
    document.querySelectorAll('iframe[src]').forEach((f) => { if (shown(f)) video(f.src, f.title); });
  }
  if (!onClassroom || onAssignment) document.querySelectorAll('a[href]').forEach((a) => { if (shown(a)) scan(a.href, a.getAttribute('aria-label') || a.title || a.innerText); });

  const picked = String(window.getSelection ? window.getSelection() : '').trim();
  if (picked.length > 20) { out.text = picked.slice(0, 4000); return out; }
  // only an opened Google Classroom assignment has instructions worth reading off the page
  if (!onClassroom) return out;
  if (!onAssignment) { out.note = 'open the assignment itself in Classroom (click it), then press the button again. on this page only the screenshot is taken.'; return out; }
  // Classroom keeps old screens (the stream, other tabs) in the page, so read only what is really showing,
  // and skip buttons, links, menus and icons.
  const skip = 'button,[role="button"],a,nav,header,[role="navigation"],[role="banner"],[role="menu"],[role="tablist"],[role="dialog"],[aria-hidden="true"],textarea,input,select,script,style,i,svg';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const lines = [];
  let lastBlock = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el || el.closest(skip)) continue;
    if (!shown(el)) continue;
    // text pieces in the same paragraph stay on one line
    const block = el.closest('p,li,div,h1,h2,h3,h4,td,section') || el;
    if (block === lastBlock && lines.length) lines[lines.length - 1] += ' ' + t; else lines.push(t);
    lastBlock = block;
  }
  const stop = lines.findIndex((l) => /^(class comments|\d+ class comments?|your work|private comments|add class comment|add a class comment|add or create|mark as done|turn in|hand in|student work|instructions$)/i.test(l) && !/^instructions$/i.test(l));
  out.text = (stop === -1 ? lines : lines.slice(0, stop)).filter((l) => !/^(instructions|student work|more options|edit|assigned|missing|turned in)$/i.test(l)).join('\n').slice(0, 4000);
  return out;
}

// ---- downloads
const KINDS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/plain': 'txt'
};
const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('could not read the file')); r.readAsDataURL(blob); });
const urlsFor = (l, au) => {
  const u = au ? '/u/' + au : '';
  const doc = 'https://docs.google.com/document' + u + '/d/' + l.id + '/export?format=docx';
  const slides = 'https://docs.google.com/presentation' + u + '/d/' + l.id + '/export/pptx';
  const sheet = 'https://docs.google.com/spreadsheets' + u + '/d/' + l.id + '/export?format=pdf';
  const file = 'https://drive.google.com/uc?export=download&id=' + l.id + (au ? '&authuser=' + au : '');
  const list = l.kind === 'doc' ? [doc] : l.kind === 'slides' ? [slides, slides.replace('/export/pptx', '/export?format=pptx')] : l.kind === 'sheet' ? [sheet] : [file, doc, slides];
  // if the numbered-account address fails, try again without the account number
  return au ? list.concat(urlsFor(l, null)) : list;
};
async function grab(l, pageAu) {
  let last = 'could not download it';
  for (const url of urlsFor(l, l.au || pageAu)) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!r.ok) { last = r.status === 403 || r.status === 401 ? 'no permission to download it' : 'could not download it (' + r.status + ')'; continue; }
      if (type === 'text/html') { last = 'Google asked to sign in, or the file is too big'; continue; }
      const ext = KINDS[type];
      if (!ext) { last = 'badgerbox can\'t read this kind of file'; continue; }
      const blob = await r.blob();
      if (blob.size > MAX_BYTES) { last = 'the file is bigger than 15 MB'; continue; }
      const cd = r.headers.get('content-disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
      let name = '';
      try { name = m ? decodeURIComponent(m[1]) : ''; } catch (err) { name = m ? m[1] : ''; }
      name = (name || l.label || 'assignment').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'assignment';
      if (!new RegExp('\\.' + ext + '$', 'i').test(name)) name = name.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + ext;
      const got = { name: name, type: type, url: await toDataUrl(blob) };
      // a PDF of the same Google file, so badgerbox can show the real slides or pages
      if ((ext === 'pptx' || ext === 'docx') && /^https:\/\/docs\.google\.com\//.test(url)) {
        try {
          const pdfUrl = ext === 'pptx' ? url.replace(/\/export(\/pptx|\?format=pptx)$/, '/export/pdf') : url.replace(/format=docx$/, 'format=pdf');
          const pr = await fetch(pdfUrl, { credentials: 'include' });
          const pb = pr.ok && /application\/pdf/i.test(pr.headers.get('content-type') || '') ? await pr.blob() : null;
          if (pb && pb.size <= MAX_BYTES) got.pdf = await toDataUrl(pb);
        } catch (err) { /* no preview pages; the file itself still goes */ }
      }
      return got;
    } catch (err) { last = 'could not reach Google'; }
  }
  throw new Error(last);
}

// ---- YouTube transcripts
// Pulls a JSON object that a page assigns to a variable ("var name = {...};") out of the page's HTML.
function jsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const ch = html[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, k + 1)); } catch (err) { return null; } } }
  }
  return null;
}
const stamp = (ms) => { const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
// lines of { ms, text } -> readable text with a time mark about every 30 seconds
function joinLines(lines) {
  let out = '', last = -1e9;
  lines.forEach((l) => {
    const t = String(l.text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (l.ms - last >= 30000) { out += (out ? '\n' : '') + '[' + stamp(l.ms) + '] '; last = l.ms; }
    out += t + ' ';
  });
  return out.trim();
}
async function transcript(id) {
  const r = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en', { credentials: 'include' });
  if (!r.ok) throw new Error('could not open the video (' + r.status + ')');
  const html = await r.text();
  const player = jsonAfter(html, 'ytInitialPlayerResponse = ') || jsonAfter(html, 'ytInitialPlayerResponse=') || {};
  const det = player.videoDetails || {};
  const title = String(det.title || ((/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '').replace(/ - YouTube$/, '') || 'video').slice(0, 120);
  const meta = { title: title, channel: String(det.author || '').slice(0, 80), seconds: Number(det.lengthSeconds) || 0 };
  const tracks = (((player.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
  // captions people wrote beat automatic ones; English first, otherwise whatever there is
  const rank = (t) => (t.kind === 'asr' ? 2 : 0) + (String(t.languageCode || '').indexOf('en') === 0 ? 0 : 1);
  const order = tracks.slice().sort((a, b) => rank(a) - rank(b));
  for (const t of order.slice(0, 3)) {
    try {
      const c = await fetch(t.baseUrl + (/[?&]fmt=/.test(t.baseUrl) ? '' : '&fmt=json3'), { credentials: 'include' });
      const j = c.ok ? await c.json() : null;
      const lines = ((j && j.events) || []).filter((e) => e.segs).map((e) => ({ ms: Number(e.tStartMs) || 0, text: e.segs.map((s) => s.utf8 || '').join('') }));
      const text = joinLines(lines);
      if (text.length > 40) return Object.assign(meta, { text: text, lang: t.languageCode || '', auto: t.kind === 'asr' });
    } catch (err) { /* try the next way */ }
  }
  // second way: the same request YouTube's own "Show transcript" panel makes
  try {
    const key = (/"INNERTUBE_API_KEY":"([^"]+)"/.exec(html) || [])[1], ver = (/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html) || [])[1];
    if (key && ver) {
      const inner = [0x12, id.length].concat(Array.from(id).map((ch) => ch.charCodeAt(0)));
      const params = btoa(String.fromCharCode.apply(null, [0x0a, inner.length].concat(inner)));
      const p = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=' + encodeURIComponent(key) + '&prettyPrint=false', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en' } }, params: params })
      });
      const j = p.ok ? await p.json() : null;
      const lines = [];
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (o.transcriptSegmentRenderer) { const s = o.transcriptSegmentRenderer; lines.push({ ms: Number(s.startMs) || 0, text: (((s.snippet || {}).runs) || []).map((x) => x.text || '').join('') }); return; }
        Object.keys(o).forEach((k) => walk(o[k]));
      })(j);
      const text = joinLines(lines);
      if (text.length > 40) return Object.assign(meta, { text: text, lang: '', auto: false });
    }
  } catch (err) { /* fall through */ }
  throw new Error(tracks.length ? 'YouTube would not give the captions' : 'this video has no captions');
}
function payloadContext() {
  return state.vids.filter((v) => v.state === 'ok' && v.use).map((v) => ({
    name: 'video: ' + v.info.title,
    text: ('YouTube video "' + v.info.title + '"' + (v.info.channel ? ' by ' + v.info.channel : '') + (v.info.seconds ? ', ' + stamp(v.info.seconds * 1000) + ' long' : '') +
      ' (https://youtu.be/' + v.id + '). Transcript of what is said' + (v.info.auto ? ' (automatic captions, may have mistakes)' : '') + ', with time marks:\n' + v.info.text).slice(0, 30000)
  }));
}

// ---- the popup
function render() {
  const rows = [];
  rows.push({ st: state.shot === null ? '[..]' : state.shot ? '[ok]' : '[no]', nm: 'screenshot of this page' + (state.shot === false ? ' (not allowed on this page)' : '') });
  state.items.forEach((it) => rows.push({ it: it.state === 'ok' ? it : null, st: it.state === 'busy' ? '[..]' : it.state === 'ok' ? (it.use ? '[x]' : '[ ]') : '[no]', nm: (it.file ? it.file.name : it.label || 'attached file') + (it.note ? ' : ' + it.note : '') }));
  if (!state.items.length && state.done) rows.push({ st: '', nm: 'no attached files found on this page', dim: true });
  state.vids.forEach((v) => rows.push({ it: v.state === 'ok' ? v : null, vid: true, st: v.state === 'busy' ? '[..]' : v.state === 'ok' ? (v.use ? '[x]' : '[ ]') : '[no]',
    nm: 'video: ' + (v.info ? v.info.title : v.label || 'YouTube video') + (v.state === 'ok' ? ' (transcript, ' + v.info.text.split(/\s+/).length + ' words)' : v.note ? ' : ' + v.note : '') }));
  const list = $('list');
  list.textContent = '';
  rows.forEach((r) => {
    const d = document.createElement(r.it ? 'button' : 'div');
    d.className = 'row' + (r.dim || (r.it && !r.it.use) ? ' dim' : '') + (r.it ? ' pick' : '');
    if (r.it) { d.type = 'button'; d.setAttribute('aria-pressed', r.it.use ? 'true' : 'false'); d.title = r.it.use ? 'click to leave this file out' : 'click to send this file'; d.addEventListener('click', () => (r.vid ? (r.it.use = !r.it.use, render()) : toggle(r.it))); }
    const a = document.createElement('span'); a.className = 'st'; a.textContent = r.st;
    const b = document.createElement('span'); b.className = 'nm'; b.textContent = r.nm;
    d.append(a, b); list.append(d);
  });
  $('send').disabled = state.busy > 0 || !state.done || !payloadFiles().length && !$('text').value.trim() && !payloadContext().length;
}
// the screenshot always goes first; attached files fill the rest, up to 3 files in all
function payloadFiles() {
  const ok = state.items.filter((it) => it.state === 'ok' && it.use);
  const files = [];
  if (state.shot) files.push({ name: 'assignment overview.png', type: 'image/png', url: state.shot, ref: ok.length > 0 });
  ok.slice(0, room()).forEach((it) => files.push({ name: it.file.name, type: it.file.type, url: it.file.url, pdf: it.file.pdf || null, ref: false }));
  return files;
}
const room = () => MAX_FILES - (state.shot ? 1 : 0);
function toggle(it) {
  if (!it.use && state.items.filter((x) => x.state === 'ok' && x.use).length >= room()) { say('badgerbox takes 3 files per run (the screenshot plus ' + room() + '). untick one first.'); return; }
  it.use = !it.use;
  say('');
  render();
}
const say = (t) => { $('msg').textContent = t; };

async function start() {
  const store = await chrome.storage.local.get({ home: 'http://localhost:3000' });
  $('homeIn').value = store.home;
  const q = new URLSearchParams(location.search);
  let tab;
  if (q.get('tab')) tab = await chrome.tabs.get(Number(q.get('tab')));         // used by the tests
  else tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !/^https?:/.test(tab.url || '')) { state.shot = false; state.done = true; render(); say('open your assignment page first, then press the badgerbox button.'); return; }
  try { $('where').textContent = new URL(tab.url).hostname; } catch (err) {}
  render();

  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).then((url) => { state.shot = url || false; if (url) { $('shot').src = url; $('shot').hidden = false; } render(); }, (err) => { state.shot = false; console.warn('badgerbox: no screenshot: ' + (err && err.message)); render(); });

  let info = { text: '', links: [], au: null };
  try { const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collect }); if (res && res[0] && res[0].result) info = res[0].result; }
  catch (err) { say('badgerbox can\'t read this page, so only the screenshot is sent.'); }
  $('text').value = info.text || '';
  $('useText').checked = !!info.text;
  if (info.note) say(info.note);

  state.items = info.links.slice(0, 6).map((l) => ({ label: l.label, state: 'busy', link: l }));
  state.vids = (info.videos || []).slice(0, 4).map((v) => ({ id: v.id, label: v.label, state: 'busy', use: true }));
  state.done = true;
  state.busy = state.items.length + state.vids.length;
  render();
  state.vids.forEach((v) => transcript(v.id).then((t) => { v.info = t; v.state = 'ok'; }, (err) => { v.state = 'no'; v.note = err.message; }).then(() => { state.busy--; render(); }));
  await Promise.all(state.items.map((it) => grab(it.link, info.au).then((f) => { it.file = f; it.state = 'ok'; }, (err) => { it.state = 'no'; it.note = err.message; }).then(() => { state.busy--; render(); })));
  const ok = state.items.filter((it) => it.state === 'ok');
  ok.forEach((it, i) => { it.use = i < room(); });
  render();
  if (ok.length > room()) say('more files than badgerbox takes at once. click a file to tick or untick it.');
  else if (state.items.some((it) => it.state === 'no')) say('some files could not be downloaded. open the file and press the button there, or screenshot it.');
}

$('send').addEventListener('click', async () => {
  const home = $('homeIn').value.trim().replace(/\/+$/, '') || 'http://localhost:3000';
  if (!/^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/[a-z0-9-]+\.trycloudflare\.com)$/i.test(home)) { $('home').hidden = false; say('that address is not a badgerbox address. use http://localhost:3000 or your share link.'); return; }
  await chrome.storage.local.set({ home: home });
  $('send').disabled = true;
  say('opening badgerbox...');
  const res = await chrome.runtime.sendMessage({ bbSend: { home: home, files: payloadFiles(), context: payloadContext(), text: $('useText').checked ? $('text').value.trim().slice(0, 6000) : '' } });
  if (res && res.ok) window.close();
  else { say('could not send: ' + ((res && res.error) || 'no reply') + '. start badgerbox first.'); $('send').disabled = false; }
});
$('set').addEventListener('click', () => { $('home').hidden = !$('home').hidden; });
$('text').addEventListener('input', () => { $('useText').checked = !!$('text').value.trim(); render(); });
start();
