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
  var ORIG_KEY = 'bb-run-orig';
  var PAYLOAD_KEY = 'bb-run-payload';
  var CTX_KEY = 'bb-run-ctx';
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
        var office = window.bbOffice ? window.bbOffice.kindOf(file.name, type) : '';
        if (office) {
          window.bbOffice.read(url, office)
            .then(function (info) { resolve({ type: office, url: url, name: file.name || ('assignment.' + office), text: window.bbOffice.tagged(info, file.name || 'assignment') }); })
            .catch(function () { resolve(null); });
          return;
        }
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

  function isImg(f) { return !!f && /^image\//.test(f.type || ''); }

  /* Turn a list of read files into what gets sent to the backend.
   * items: [{ name, data (from readFile), ref (reference only), no (file number) }]
   * startImg: how many images come before these in the same request. */
  function flatten(items, startImg) {
    var files = [], text = [], keep = [], info = [], imgs = startImg || 0;
    (items || []).forEach(function (it) {
      var d = it.data;
      if (!d) return;
      var role = it.ref ? 'reference' : 'assignment';
      if (d.type === 'docx' || d.type === 'pptx') {
        text.push('File ' + it.no + (it.ref ? ' (reference only)' : '') + '. ' + d.text);
        if (!it.ref) keep.push({ kind: d.type, name: it.name, url: d.url, file: it.no });
        info.push({ n: it.no, name: it.name, role: role, origin: d.type });
        return;
      }
      var list = (d.pages && d.pages.length) ? d.pages : [{ type: d.type, url: d.url }];
      var first = imgs + 1;
      list.forEach(function (pg) { files.push({ type: pg.type, url: pg.url, file: it.no, name: it.name, ref: !!it.ref }); if (isImg(pg)) imgs++; });
      info.push({ n: it.no, name: it.name, role: role, origin: (d.pages && d.pages.length) || d.type === 'application/pdf' ? 'pdf' : (isImg(d) ? 'image' : 'text'), pages: imgs >= first ? [first, imgs] : null });
    });
    return { files: files, text: text.join('\n\n'), keep: keep, fileInfo: info };
  }
  function maxNo(list) { var m = 0; (list || []).forEach(function (f) { if (Number(f.n) > m) m = Number(f.n); }); return m; }
  function withFile(qs, fallback, allowed) {
    return (qs || []).map(function (q) { var n = Number(q.file) || 0; q.file = (allowed ? allowed.indexOf(n) !== -1 : n > 0) ? n : fallback; return q; });
  }

  window.bbApi = {
    flatten: flatten,
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
      var originals = (payload && payload.keep) || [];
      var body = Object.assign({}, payload); delete body.keep;
      return post('api/solve', body).then(function (res) {
        res = res || { source: 'error', error: 'no reply' };
        res.seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
        res.meta = (payload && payload.meta) || {};
        res.request = { tab: payload && payload.tab, cls: payload && payload.cls };
        var keep = Promise.resolve();
        if (res.source === 'model') {
          res.id = 'r' + Date.now();
          res.files = (payload && payload.fileInfo) || [];
          res.questions = withFile(res.questions, 1);
          store(RUN_KEY, res);
          // keep the worksheet images for this tab only, so answers can be put back on them
          var imgs = ((payload && payload.files) || []).filter(function (f) { return f && /^image\//.test(f.type || ''); });
          keep = idbSet(FILES_KEY, imgs).then(function () { return idbSet(ORIG_KEY, originals); }).then(function () { return idbSet(PAYLOAD_KEY, payload); }).then(function () { return idbSet(CTX_KEY, []); });
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

    /* Files added in the walkthrough chat as context (a Promise). */
    loadCtx: function () { return idbGet(CTX_KEY).then(function (v) { return Array.isArray(v) ? v : []; }); },
    saveCtx: function (list) { return idbSet(CTX_KEY, list || []); },

    /* Do another assignment and add it to the current run. The files already in the run, and any
     * chat context files, are sent along as reference so they inform the new answers. */
    solveMore: function (newItems, ctxItems) {
      return Promise.all([idbGet(FILES_KEY), idbGet(ORIG_KEY), idbGet(PAYLOAD_KEY)]).then(function (v) {
        var imgs0 = v[0] || [], orig0 = v[1] || [], p0 = v[2] || {};
        var run = load(RUN_KEY);
        if (!run) return { source: 'error', error: 'there is no run to add to' };
        if (!run.files || !run.files.length) run.files = [{ n: 1, name: 'typed assignment', role: 'assignment', origin: 'text' }];
        var next = maxNo(run.files) + 1, sent0 = p0.files || [], start = sent0.filter(isImg).length;
        var fresh = flatten((newItems || []).map(function (it, i) { return { name: it.name, data: it.data, ref: false, no: next + i }; }), start);
        var ctx = flatten((ctxItems || []).map(function (it, i) { return { name: it.name, data: it.data, ref: true, no: next + newItems.length + i }; }), start + fresh.files.filter(isImg).length);
        var body = {
          tab: p0.tab, cls: p0.cls, answers: {}, more: true,
          text: [p0.text ? 'Already done, for reference only:\n' + p0.text : '', fresh.text, ctx.text].filter(Boolean).join('\n\n'),
          files: sent0.map(function (f) { return Object.assign({}, f, { ref: true }); }).concat(fresh.files, ctx.files),
          fileInfo: run.files.map(function (f) { return Object.assign({}, f, { role: 'reference' }); }).concat(fresh.fileInfo, ctx.fileInfo)
        };
        return post('api/solve', body).then(function (res) {
          if (!res || res.source !== 'model') return res || { source: 'error', error: 'no reply' };
          var nos = fresh.fileInfo.map(function (f) { return f.n; });
          run.questions = run.questions.concat(withFile(res.questions, nos[0], nos));
          run.files = run.files.concat(fresh.fileInfo);
          run.tldr = null;
          store(RUN_KEY, run);
          p0.files = sent0.concat(fresh.files);
          p0.fileInfo = (p0.fileInfo && p0.fileInfo.length ? p0.fileInfo : run.files.slice(0, run.files.length - fresh.fileInfo.length)).concat(fresh.fileInfo);
          p0.keep = (p0.keep || []).concat(fresh.keep);
          p0.text = [p0.text, fresh.text].filter(Boolean).join('\n\n');
          return idbSet(FILES_KEY, imgs0.concat(fresh.files.filter(isImg)))
            .then(function () { return idbSet(ORIG_KEY, orig0.concat(fresh.keep)); })
            .then(function () { return idbSet(PAYLOAD_KEY, p0); })
            .then(function () { res.added = res.questions.length; return res; });
        });
      });
    },

    /* Work the whole run again, this time with the chat context files as reference. */
    redo: function (ctxItems) {
      return idbGet(PAYLOAD_KEY).then(function (p0) {
        if (!p0) return { source: 'error', error: 'this run can no longer be redone. start it again from the main screen.' };
        var run = load(RUN_KEY) || {};
        var ctx = flatten((ctxItems || []).map(function (it, i) { return { name: it.name, data: it.data, ref: true, no: maxNo(p0.fileInfo || run.files) + 1 + i }; }), (p0.files || []).filter(isImg).length);
        var body = Object.assign({}, p0, {
          files: (p0.files || []).concat(ctx.files),
          fileInfo: (p0.fileInfo || []).concat(ctx.fileInfo),
          text: [p0.text, ctx.text].filter(Boolean).join('\n\n')
        });
        delete body.keep;
        return post('api/solve', body).then(function (res) {
          if (!res || res.source !== 'model') return res || { source: 'error', error: 'no reply' };
          var nos = (run.files || []).map(function (f) { return f.n; });
          run.questions = withFile(res.questions, nos[0] || 1, nos.length ? nos : null);
          run.subject = res.subject || run.subject; run.level = res.level || run.level; run.title = res.title || run.title;
          run.tldr = null;
          store(RUN_KEY, run);
          return res;
        });
      });
    },
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
    /* the Word or PowerPoint files the student gave, so answers can go back into them (a Promise) */
    loadRunOrig: function () { return idbGet(ORIG_KEY).then(function (v) { return Array.isArray(v) ? v : []; }); },
    loadRunFiles: function () { return idbGet(FILES_KEY).then(function (v) { return Array.isArray(v) ? v : []; }); },
    /* finished runs kept on this device (without the worksheet images) */
    history: function () { return loadLocal(HIST_KEY, []); },
    openRun: function (id) {
      var h = loadLocal(HIST_KEY, []).filter(function (x) { return x.id === id; })[0];
      if (!h || !h.run) return false;
      idbSet(FILES_KEY, []); idbSet(ORIG_KEY, []); idbSet(PAYLOAD_KEY, null); idbSet(CTX_KEY, []);
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
