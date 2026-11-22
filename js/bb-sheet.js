/* badgerbox: writes the answers onto the student's own worksheet, and makes the file they download.
 *
 * Lifted out of the old walkthrough screen so the new answers screen (and tests) can use it on its own.
 *
 *   bbSheet.layout(items, aspect, fillScale)  where each answer sits on a page, readable and not overlapping
 *       items: [{ i, text, byUser, pl: { page, x, y, w, h, box, s } }]   positions are 0..1 of the page
 *       -> [{ i, text, x, y, w, h, em, lineH }]                            em = letter height, share of page width
 *   bbSheet.render(url, items, fillScale)     -> Promise<{ canvas, boxes }>   the page picture with answers drawn on
 *   bbSheet.download(job)                     -> Promise   saves one file per assignment, in the format it came in
 *       job: { fillScale, parts: [{ name, title, kind: 'pdf'|'png'|'docx'|'pptx'|'clean', orig: { kind, url } | null,
 *              pages: [{ url, items }], answers: [{ n, text, line, anchor, steps }] }] }
 *   bbSheet.kindNote(kind)                    what the download will be, in plain words
 */
(function () {
  'use strict';

  var EM0 = 0.021;        // normal letter height, as a share of the page width
  var EM_MIN = 0.0105;    // the smallest an answer is shrunk to fit a blank

  function layout(items, asp, fillScale) {
    var fs = fillScale || 1;
    if (!items || !items.length) return [];
    var boxes = items.map(function (x) {
      var pl = x.pl, byUser = !!x.byUser;
      var lines = String(x.text).split('\n');
      var longest = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 1);
      var em = EM0 * fs * (Number(pl.s) || 1);
      if (!byUser && Number(pl.h) > 0) {
        // in a blank that was found on the page: size the writing to the blank and sit it on the line
        var bw = Number(pl.w), bh = Number(pl.h), pad = Math.min(0.006, bw * 0.04);
        em = Math.min(em, (bh / (1.25 * asp)) * 0.9);
        em = Math.min(em, Math.max(EM_MIN * fs, (bw - pad * 2) / (longest * 0.56 + 0.4)));
        var lh = em * 1.25 * asp, inner = Math.max(0.02, bw - pad * 2);
        var rows = lines.reduce(function (n, l) { return n + Math.max(1, Math.ceil((l.length * em * 0.56) / inner)); }, 0);
        var py = (pl.box && bh > lh * 2.4) ? Number(pl.y) + lh * 0.25 : Number(pl.y) + bh - rows * lh - lh * 0.05;
        return { x: x, fixed: true, px: Number(pl.x) + pad, py: Math.max(0.002, py), w: inner, h: rows * lh, em: em, lineH: lh };
      }
      var charW = em * 0.56, lineH = em * 1.25 * asp;
      var want = Math.min(0.94, longest * charW + em);
      var px = Math.min(0.96, Math.max(0.01, Number(pl.x) || 0));
      var w = Math.max(Number(pl.w) || 0, want, 0.15);
      if (px + w > 0.98) { if (!byUser) px = Math.max(0.02, 0.98 - w); w = Math.max(0.15, 0.98 - px); }
      var r2 = lines.reduce(function (n, l) { return n + Math.max(1, Math.ceil((l.length * charW) / Math.max(0.05, w - em * 0.5))); }, 0);
      return { x: x, fixed: byUser, px: px, py: Math.min(0.97, Math.max(0.005, Number(pl.y) || 0)), w: w, h: r2 * lineH, em: em, lineH: lineH };
    });
    var hits = function (a, b) { return a.px < b.px + b.w && b.px < a.px + a.w && a.py < b.py + b.h + a.lineH * 0.15 && b.py < a.py + a.h + a.lineH * 0.15; };
    var done = boxes.filter(function (b) { return b.fixed; });
    boxes.filter(function (b) { return !b.fixed; }).sort(function (a, b) { return a.py - b.py || a.px - b.px; }).forEach(function (b) {
      for (var guard = 0; guard < 60; guard++) {
        var o = done.filter(function (d) { return hits(b, d); })[0];
        if (!o) break;
        b.py = o.py + o.h + b.lineH * 0.2;
      }
      if (b.py + b.h > 0.995) b.py = Math.max(0.005, 0.995 - b.h);
      done.push(b);
    });
    return boxes.map(function (b) { return { i: b.x.i, text: b.x.text, page: b.x.pl.page, x: b.px, y: b.py, w: b.w, h: b.h, em: b.em, lineH: b.lineH }; });
  }

  function loadImg(url) {
    return new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; });
  }
  function wrapLines(g, text, maxW) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      var line = '';
      para.split(' ').forEach(function (w) { var t = line ? line + ' ' + w : w; if (line && g.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; });
      out.push(line);
    });
    return out;
  }

  function render(url, items, fillScale) {
    return loadImg(url).then(function (im) {
      if (!im) return null;
      var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      var g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      g.fillStyle = '#0B2A8A'; g.textBaseline = 'top';
      var boxes = layout(items, c.width / Math.max(1, c.height), fillScale);
      boxes.forEach(function (b) {
        var fs = c.width * b.em;
        g.font = '700 ' + fs + 'px Arial, Helvetica, sans-serif';
        var maxW = Math.max(0.02, Math.min(1 - b.x, b.w || 0.5)) * c.width;
        wrapLines(g, b.text, maxW).forEach(function (ln, k) { g.fillText(ln, b.x * c.width, b.y * c.height + k * fs * 1.25); });
      });
      return { canvas: c, boxes: boxes };
    });
  }

  /* a minimal PDF: one JPEG per page */
  function makePdf(pages) {
    var enc = new TextEncoder(), chunks = [], offs = [], len = 0;
    var push = function (d) { var u = typeof d === 'string' ? enc.encode(d) : d; chunks.push(u); len += u.length; };
    var obj = function (n, parts) { offs[n] = len; push(n + ' 0 obj\n'); parts.forEach(push); push('\nendobj\n'); };
    push('%PDF-1.4\n');
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2, ['<< /Type /Pages /Kids [' + pages.map(function (_, i) { return (3 + i * 3) + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>']);
    pages.forEach(function (pg, i) {
      var W = 612, H = Math.round(612 * pg.h / pg.w * 100) / 100, base = 3 + i * 3;
      var content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      obj(base, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (base + 2) + ' 0 R >> >> /Contents ' + (base + 1) + ' 0 R >>']);
      obj(base + 1, ['<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream']);
      obj(base + 2, ['<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.bytes.length + ' >>\nstream\n', pg.bytes, '\nendstream']);
    });
    var count = 2 + pages.length * 3, xref = len;
    var table = 'xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n';
    for (var n = 1; n <= count; n++) table += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    push(table + 'trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, { type: 'application/pdf' });
  }
  function jpegOf(c) {
    return new Promise(function (res) {
      c.toBlob(function (bl) { if (!bl) { res(null); return; } bl.arrayBuffer().then(function (buf) { res({ bytes: new Uint8Array(buf), w: c.width, h: c.height }); }); }, 'image/jpeg', 0.92);
    });
  }
  function pdfOf(canvases) {
    return Promise.all(canvases.filter(Boolean).map(jpegOf)).then(function (pages) { var ok = pages.filter(Boolean); return ok.length ? makePdf(ok) : null; });
  }

  /* a clean answer sheet, for typed work or files that have no page pictures: questions and answers on letter pages */
  function cleanPages(title, answers) {
    var W = 1275, H = 1650, M = 110, out = [];
    var c = null, g = null, y = 0;
    var page = function () {
      c = document.createElement('canvas'); c.width = W; c.height = H; g = c.getContext('2d');
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.fillStyle = '#000000'; g.textBaseline = 'top';
      out.push(c); y = M;
    };
    var write = function (text, font, size, gap) {
      g.font = font + ' ' + size + 'px Arial, Helvetica, sans-serif';
      wrapLines(g, text, W - M * 2).forEach(function (ln) {
        if (y + size * 1.3 > H - M) { page(); g.font = font + ' ' + size + 'px Arial, Helvetica, sans-serif'; }
        g.fillText(ln, M, y); y += size * 1.3;
      });
      y += gap || 0;
    };
    page();
    write(title || 'worksheet', '700', 40, 10);
    write('name ______________________   date ____________', '400', 24, 30);
    (answers || []).forEach(function (a) {
      if (y > H - M - 160) page();
      write(a.n + '. ' + a.text, '400', 26, 8);
      g.fillStyle = '#0B2A8A'; write(a.line, '700', 28, 30); g.fillStyle = '#000000';
    });
    return out;
  }

  function outName(name, ext, n) {
    var base = String(name || 'worksheet').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'worksheet';
    return base.replace(/\.[A-Za-z0-9]{1,5}$/, '') + ' (filled)' + (n ? '-' + n : '') + '.' + ext;
  }
  function save(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function officeAnswers(key, answers) {
    return answers.map(function (a) {
      var at = (a.anchor && a.anchor[key]) || null;
      return { at: at, text: ((key === 'slide' || !at) ? a.n + '. ' : '') + a.line };
    });
  }

  function part(P, fillScale) {
    var OFF = window.bbOffice;
    var nm = function (ext, n) { return outName(P.name || P.title, ext, n); };
    var renders = function () { return Promise.all((P.pages || []).map(function (pg) { return render(pg.url, pg.items, fillScale); })); };
    if (P.kind === 'pptx' && OFF && P.orig) {
      if (!P.pages || !P.pages.length) return OFF.fill(P.orig.url, 'pptx', officeAnswers('slide', P.answers)).then(function (b) { save(b, nm('pptx')); });
      // page pictures match the slides one to one, so each answer goes where the preview shows it
      return Promise.all(P.pages.map(function (pg) { return loadImg(pg.url).then(function (im) { return layout(pg.items, im ? im.naturalWidth / Math.max(1, im.naturalHeight) : 1.333, fillScale); }); })).then(function (lays) {
        var placed = {}, list = [];
        lays.forEach(function (boxes, k) { boxes.forEach(function (b) { placed[b.i] = 1; list.push({ at: k + 1, x: b.x, y: b.y, w: b.w, scale: b.em / EM0, text: b.text }); }); });
        var rest = P.answers.filter(function (a) { return !placed[a.i]; });
        return OFF.fill(P.orig.url, 'pptx', list.concat(officeAnswers('slide', rest)));
      }).then(function (b) { save(b, nm('pptx')); });
    }
    if (P.kind === 'docx' && OFF && P.orig) return OFF.fill(P.orig.url, 'docx', officeAnswers('p', P.answers)).then(function (b) { save(b, nm('docx')); });
    if (P.kind === 'png' && P.pages && P.pages.length) {
      return renders().then(function (rs) {
        rs.forEach(function (r, k) { if (r) r.canvas.toBlob(function (bl) { if (bl) save(bl, nm('png', rs.length > 1 ? k + 1 : 0)); }, 'image/png'); });
      });
    }
    if (P.kind === 'pdf' && P.pages && P.pages.length) return renders().then(function (rs) { return pdfOf(rs.map(function (r) { return r && r.canvas; })); }).then(function (b) { if (b) save(b, nm('pdf')); });
    return pdfOf(cleanPages(P.title, P.answers)).then(function (b) { if (b) save(b, nm('pdf')); });
  }

  /* one file per assignment, a short pause between them so the browser lets several through */
  function download(job) {
    var chain = Promise.resolve();
    (job.parts || []).forEach(function (P, k) {
      chain = chain.then(function () { return part(P, job.fillScale); }).then(function () { return k < job.parts.length - 1 ? new Promise(function (r) { setTimeout(r, 400); }) : null; });
    });
    return chain;
  }

  function kindNote(kind) {
    return ({
      pdf: 'your own pages with the answers written in, as a PDF.',
      png: 'your own picture with the answers written in.',
      docx: 'your same Word file with the answers filled in.',
      pptx: 'your same slides with the answers filled in.',
      clean: 'a clean answer sheet: each question with its answer, as a PDF.'
    })[kind] || 'your worksheet with the answers filled in.';
  }

  window.bbSheet = { EM0: EM0, layout: layout, render: render, download: download, kindNote: kindNote, outName: outName, cleanPages: cleanPages, pdfOf: pdfOf };
})();
