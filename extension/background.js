// Opens badgerbox in a new tab and hands it the files and instructions the popup collected.
// This runs here, not in the popup, because the popup closes as soon as the new tab opens.
function whenLoaded(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('badgerbox did not open. is it running?')); }, 20000);
    function on(id, info) { if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); } }
    chrome.tabs.onUpdated.addListener(on);
  });
}

// Runs inside the badgerbox page: waits until the page is ready, then passes the payload to it.
function handOver(payload) {
  return new Promise((resolve) => {
    let tries = 0;
    (function wait() {
      if (document.documentElement.dataset.bbReady === '1') { window.postMessage({ bbExt: payload }, location.origin); resolve('sent'); return; }
      if (++tries > 100) { resolve('not badgerbox'); return; }
      setTimeout(wait, 150);
    })();
  });
}

async function deliver(p) {
  const tab = await chrome.tabs.create({ url: p.home + '/app.html' });
  await whenLoaded(tab.id);
  const out = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: handOver, args: [{ files: p.files, text: p.text }] });
  if (!out || !out[0] || out[0].result !== 'sent') throw new Error('that page is not badgerbox');
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || !msg.bbSend) return;
  deliver(msg.bbSend).then(() => respond({ ok: true }), (err) => respond({ ok: false, error: String(err && err.message || err) }));
  return true;
});
