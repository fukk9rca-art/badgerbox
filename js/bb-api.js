/* bb-api: the screens' link to the badgerbox backend (api/solve, api/ask).
 *
 * Without a model key the backend answers { source: 'mock' } and the screens
 * keep showing their built-in sample run. If the backend can't be reached at
 * all (for example the pages were opened straight from disk), the same happens.
 */
(function () {
  'use strict';
  var RUN_KEY = 'bb-run';
  var KEY_KEY = 'bb-key';
  function accessKey() { try { return localStorage.getItem(KEY_KEY) || ''; } catch (err) { return ''; } }
  var status = { live: false, model: '', checked: false };

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bb-key': accessKey() },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return { source: 'error', error: 'bad reply (' + r.status + ')' }; });
    }).catch(function (err) {
      return { source: 'offline', error: String(err && err.message || err) };
    });
  }

  function store(key, val) {
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (err) {}
  }
  function load(key) {
    try { var raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
  }

  /* Shrink big screenshots to a JPEG no wider/taller than 1800px so uploads stay small. */
  function readFile(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onerror = function () { resolve(null); };
      fr.onload = function () {
        var url = String(fr.result || '');
        var type = file.type || '';
        if (!/^image\/(png|jpeg|webp)$/.test(type)) { resolve(url ? { type: type || 'application/octet-stream', url: url } : null); return; }
        var img = new Image();
        img.onerror = function () { resolve({ type: type, url: url }); };
        img.onload = function () {
          var max = 1800;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          if (scale === 1 && url.length < 3000000) { resolve({ type: type, url: url }); return; }
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          var g = c.getContext('2d');
          g.fillStyle = '#FFFFFF';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          resolve({ type: 'image/jpeg', url: c.toDataURL('image/jpeg', 0.88) });
        };
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }

  window.bbApi = {
    status: status,
    isLive: function () { return status.live; },
    readFile: readFile,
    /* Ask the backend whether an access key is valid. Offline (no backend), only the test key works. */
    checkKey: function (key) {
      return post('api/key', { key: key }).then(function (res) {
        if (res && res.source === 'offline') res = { ok: key === '8008', offline: true };
        if (res && res.ok) { try { localStorage.setItem(KEY_KEY, key); } catch (err) {} }
        return res || { ok: false };
      });
    },
    accessKey: accessKey,
    solve: function (payload) {
      var started = Date.now();
      return post('api/solve', payload).then(function (res) {
        res = res || { source: 'error', error: 'no reply' };
        res.seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
        res.meta = (payload && payload.meta) || {};
        res.request = { tab: payload && payload.tab, cls: payload && payload.cls };
        if (res.source === 'model') store(RUN_KEY, res);
        else { try { sessionStorage.removeItem(RUN_KEY); } catch (err) {} }
        return res;
      });
    },
    solveOne: function (payload) { return post('api/solve', payload); },
    ask: function (payload) { return post('api/ask', payload); },
    tldr: function (payload) { return post('api/tldr', payload); },
    /* tl;dr summaries kept per class on this device, to become a study guide. */
    notes: function (cls) {
      try { return (JSON.parse(localStorage.getItem('bb-notes') || '{}')[cls]) || []; } catch (err) { return []; }
    },
    saveNote: function (cls, note) {
      try {
        var all = JSON.parse(localStorage.getItem('bb-notes') || '{}');
        var list = all[cls] || [];
        if (!list.some(function (n) { return n.topic === note.topic && n.title === note.title; })) {
          list.push(Object.assign({ at: new Date().toISOString() }, note));
          all[cls] = list.slice(-50);
          localStorage.setItem('bb-notes', JSON.stringify(all));
        }
      } catch (err) {}
    },
    lastRun: function () { return load(RUN_KEY); },
    saveRun: function (run) { store(RUN_KEY, run); }
  };

  fetch('api/status').then(function (r) { return r.json(); }).then(function (j) {
    status.live = !!(j && j.live);
    status.model = (j && j.model) || '';
    status.checked = true;
  }).catch(function () { status.checked = true; });
})();
