/* bb-api: the screens' link to the badgerbox backend (api/solve, api/ask).
 *
 * Without a model key the backend answers { source: 'mock' } and the screens
 * keep showing their built-in sample run. If the backend can't be reached at
 * all (for example the pages were opened straight from disk), the same happens.
 */
(function () {
  'use strict';
  var RUN_KEY = 'bb-run';
  var FILES_KEY = 'bb-run-files';
  var HIST_KEY = 'bb-history';
  function loadLocal(key, fallback) { try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (err) { return fallback; } }
  function saveLocal(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (err) { return false; } }
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

  /* Small key-value store in IndexedDB for things too big for sessionStorage (worksheet page images). */
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('badgerbox', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbSet(key, val) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(undefined); };
      });
    }).catch(function () { return undefined; });
  }

  /* Turn each page of a PDF into a JPEG, so answers can be written back onto the pages. */
  var MAX_PDF_PAGES = 10;
  var pdfLib = null;
  function loadPdfLib() {
    if (!pdfLib) {
      pdfLib = import(new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
        return lib;
      });
    }
    return pdfLib;
  }
  function pdfPages(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      return loadPdfLib().then(function (lib) { return lib.getDocument({ data: buf }).promise; });
    }).then(function (doc) {
      if (doc.numPages > MAX_PDF_PAGES) return null;
      var out = [], chain = Promise.resolve();
      for (var n = 1; n <= doc.numPages; n++) {
        (function (n) {
          chain = chain.then(function () { return doc.getPage(n); }).then(function (page) {
            var base = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: Math.min(1500 / base.width, 1900 / base.height) });
            var c = document.createElement('canvas');
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            var g = c.getContext('2d');
            g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: g, viewport: vp }).promise.then(function () {
              out.push({ type: 'image/jpeg', url: c.toDataURL('image/jpeg', 0.85) });
            });
          });
        })(n);
      }
      return chain.then(function () { return out; });
    }).catch(function () { return null; });
  }

  /* Shrink big screenshots to a JPEG no wider/taller than 1800px so uploads stay small. */
  function readFile(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onerror = function () { resolve(null); };
      fr.onload = function () {
        var url = String(fr.result || '');
        var type = file.type || '';
        if (type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
          pdfPages(url).then(function (pages) { resolve({ type: 'application/pdf', url: url, pages: (pages && pages.length) ? pages : null }); });
          return;
        }
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
        var keep = Promise.resolve();
        if (res.source === 'model') {
          res.id = 'r' + Date.now();
          store(RUN_KEY, res);
          // keep the worksheet images for this tab only, so answers can be put back on them
          var imgs = ((payload && payload.files) || []).filter(function (f) { return f && /^image\//.test(f.type || ''); });
          keep = idbSet(FILES_KEY, imgs);
          var qs = res.questions || [];
          var hist = loadLocal(HIST_KEY, []);
          hist.unshift({ id: res.id, at: new Date().toISOString(), tab: (res.meta || {}).tab || '', title: res.title || res.subject || 'assignment',
            n: qs.length, flags: qs.filter(function (q) { return !q.sure; }).length, run: res });
          hist = hist.slice(0, 12);
          while (hist.length && !saveLocal(HIST_KEY, hist)) hist.pop();
        } else { try { sessionStorage.removeItem(RUN_KEY); } catch (err) {} }
        return keep.then(function () { return res; });
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
    /* the worksheet page images for the current run (a Promise) */
    loadRunFiles: function () { return idbGet(FILES_KEY).then(function (v) { return Array.isArray(v) ? v : []; }); },
    /* finished runs kept on this device (without the worksheet images) */
    history: function () { return loadLocal(HIST_KEY, []); },
    openRun: function (id) {
      var h = loadLocal(HIST_KEY, []).filter(function (x) { return x.id === id; })[0];
      if (!h || !h.run) return false;
      idbSet(FILES_KEY, []);
      store(RUN_KEY, h.run);
      return true;
    },
    clearHistory: function () { try { localStorage.removeItem(HIST_KEY); } catch (err) {} },
    saveRun: function (run) { store(RUN_KEY, run); }
  };

  fetch('api/status').then(function (r) { return r.json(); }).then(function (j) {
    status.live = !!(j && j.live);
    status.model = (j && j.model) || '';
    status.checked = true;
  }).catch(function () { status.checked = true; });
})();
