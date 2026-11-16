// Collects the assignment from the page you are on: a screenshot, the attached files and the
// teacher's instructions. Then asks the background script to open badgerbox with them.
const $ = (id) => document.getElementById(id);
const MAX_FILES = 3;            // badgerbox takes 3 files per run
const MAX_BYTES = 15 * 1024 * 1024;
const state = { shot: null, items: [], busy: 0 };

// ---- runs inside the assignment page
function collect() {
  const out = { title: document.title || '', text: '', links: [], au: null };
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
  scan(location.href, document.title);
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
      return { name: name, type: type, url: await toDataUrl(blob) };
    } catch (err) { last = 'could not reach Google'; }
  }
  throw new Error(last);
}

// ---- the popup
function render() {
  const rows = [];
  rows.push({ st: state.shot === null ? '[..]' : state.shot ? '[ok]' : '[no]', nm: 'screenshot of this page' + (state.shot === false ? ' (not allowed on this page)' : '') });
  state.items.forEach((it) => rows.push({ it: it.state === 'ok' ? it : null, st: it.state === 'busy' ? '[..]' : it.state === 'ok' ? (it.use ? '[x]' : '[ ]') : '[no]', nm: (it.file ? it.file.name : it.label || 'attached file') + (it.note ? ' : ' + it.note : '') }));
  if (!state.items.length && state.done) rows.push({ st: '', nm: 'no attached files found on this page', dim: true });
  const list = $('list');
  list.textContent = '';
  rows.forEach((r) => {
    const d = document.createElement(r.it ? 'button' : 'div');
    d.className = 'row' + (r.dim || (r.it && !r.it.use) ? ' dim' : '') + (r.it ? ' pick' : '');
    if (r.it) { d.type = 'button'; d.setAttribute('aria-pressed', r.it.use ? 'true' : 'false'); d.title = r.it.use ? 'click to leave this file out' : 'click to send this file'; d.addEventListener('click', () => toggle(r.it)); }
    const a = document.createElement('span'); a.className = 'st'; a.textContent = r.st;
    const b = document.createElement('span'); b.className = 'nm'; b.textContent = r.nm;
    d.append(a, b); list.append(d);
  });
  $('send').disabled = state.busy > 0 || !state.done || !payloadFiles().length && !$('text').value.trim();
}
// the screenshot always goes first; attached files fill the rest, up to 3 files in all
function payloadFiles() {
  const ok = state.items.filter((it) => it.state === 'ok' && it.use);
  const files = [];
  if (state.shot) files.push({ name: 'assignment overview.png', type: 'image/png', url: state.shot, ref: ok.length > 0 });
  ok.slice(0, room()).forEach((it) => files.push({ name: it.file.name, type: it.file.type, url: it.file.url, ref: false }));
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
  state.done = true;
  state.busy = state.items.length;
  render();
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
  const res = await chrome.runtime.sendMessage({ bbSend: { home: home, files: payloadFiles(), text: $('useText').checked ? $('text').value.trim().slice(0, 6000) : '' } });
  if (res && res.ok) window.close();
  else { say('could not send: ' + ((res && res.error) || 'no reply') + '. start badgerbox first.'); $('send').disabled = false; }
});
$('set').addEventListener('click', () => { $('home').hidden = !$('home').hidden; });
$('text').addEventListener('input', () => { $('useText').checked = !!$('text').value.trim(); render(); });
start();
