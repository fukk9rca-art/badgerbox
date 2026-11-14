/* bb-office: reading and writing Word (.docx) and PowerPoint (.pptx) files in the browser.
 *
 * Google Docs and Google Slides import both formats, so this is how a worksheet that came
 * from Docs or Slides goes back as something that opens there and can still be edited.
 *
 *   read(dataUrl, kind)                    -> { kind, parts: ['paragraph or slide text', ...] }
 *   fill(dataUrl, kind, answers)           -> Blob: the student's own file with answers added
 *   pagesPptx(pages, name)                 -> Blob: page pictures with editable answer boxes on top
 *   cleanPptx(title, questions)            -> Blob: one slide per question
 *   cleanDocx(title, klass, questions)     -> Blob: questions, work and answers as normal text
 *
 * JSZip and PptxGenJS (vendor/office/) are only downloaded the first time one of these is used.
 */
(function () {
  'use strict';
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var INK = '0B2A8A';
  var MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };

  var libs = null;
  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = new URL(src, document.baseURI).href;
      s.onload = resolve; s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function load() {
    if (!libs) libs = script('vendor/office/jszip.min.js').then(function () { return script('vendor/office/pptxgen.min.js'); });
    return libs;
  }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function xml(str) { return new DOMParser().parseFromString(str, 'application/xml'); }
  function out(doc) { return new XMLSerializer().serializeToString(doc); }
  function bytes(dataUrl) { return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }); }
  function open(dataUrl) { return load().then(function () { return bytes(dataUrl); }).then(function (buf) { return window.JSZip.loadAsync(buf); }); }
  function textOf(node, tag) {
    var ts = node.getElementsByTagNameNS(tag === 'w' ? W_NS : A_NS, 't'), s = '';
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  /* slides in the order they are shown */
  function slidePaths(zip) {
    var rels = zip.file('ppt/_rels/presentation.xml.rels'), pres = zip.file('ppt/presentation.xml');
    var fallback = function () {
      return Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
        .sort(function (a, b) { return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]); });
    };
    if (!rels || !pres) return Promise.resolve({ paths: fallback(), cx: 9144000, cy: 6858000 });
    return Promise.all([rels.async('string'), pres.async('string')]).then(function (r) {
      var map = {}, relDoc = xml(r[0]), presDoc = xml(r[1]);
      var rs = relDoc.getElementsByTagName('Relationship');
      for (var i = 0; i < rs.length; i++) map[rs[i].getAttribute('Id')] = rs[i].getAttribute('Target');
      var ids = presDoc.getElementsByTagNameNS(P_NS, 'sldId'), paths = [];
      for (var k = 0; k < ids.length; k++) {
        var t = map[ids[k].getAttributeNS(R_NS, 'id')];
        if (t) paths.push(t.charAt(0) === '/' ? t.slice(1) : 'ppt/' + t);
      }
      var sz = presDoc.getElementsByTagNameNS(P_NS, 'sldSz')[0];
      return { paths: paths.length ? paths : fallback(), cx: sz ? Number(sz.getAttribute('cx')) : 9144000, cy: sz ? Number(sz.getAttribute('cy')) : 6858000 };
    });
  }

  function read(dataUrl, kind) {
    return open(dataUrl).then(function (zip) {
      if (kind === 'docx') {
        return zip.file('word/document.xml').async('string').then(function (s) {
          var ps = xml(s).getElementsByTagNameNS(W_NS, 'p'), parts = [];
          for (var i = 0; i < ps.length; i++) parts.push(textOf(ps[i], 'w'));
          return { kind: 'docx', parts: parts };
        });
      }
      return slidePaths(zip).then(function (info) {
        return Promise.all(info.paths.map(function (p) { return zip.file(p).async('string'); })).then(function (all) {
          return { kind: 'pptx', parts: all.map(function (s) {
            var ps = xml(s).getElementsByTagNameNS(A_NS, 'p'), lines = [];
            for (var i = 0; i < ps.length; i++) { var t = textOf(ps[i], 'a'); if (t.trim()) lines.push(t); }
            return lines.join('\n');
          }) };
        });
      });
    });
  }

  /* The text the model reads: every paragraph or slide tagged so it can say where an answer goes. */
  function tagged(info, name) {
    if (info.kind === 'docx') {
      return 'The assignment is the Word document "' + name + '". Its paragraphs, each tagged [pN]:\n' +
        info.parts.map(function (t, i) { return t.trim() ? '[p' + (i + 1) + '] ' + t : ''; }).filter(Boolean).join('\n');
    }
    return 'The assignment is the slide deck "' + name + '". The text on each slide, tagged [slide N]:\n' +
      info.parts.map(function (t, i) { return '[slide ' + (i + 1) + ']\n' + (t || '(no text)'); }).join('\n\n');
  }

  function wEl(doc, name, attrs) {
    var e = doc.createElementNS(W_NS, 'w:' + name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttributeNS(W_NS, 'w:' + k, attrs[k]); });
    return e;
  }
  function answerPara(doc, text) {
    var p = wEl(doc, 'p'), r = wEl(doc, 'r'), pr = wEl(doc, 'rPr');
    pr.appendChild(wEl(doc, 'b')); pr.appendChild(wEl(doc, 'color', { val: INK }));
    r.appendChild(pr);
    String(text).split('\n').forEach(function (line, i) {
      if (i) r.appendChild(wEl(doc, 'br'));
      var t = wEl(doc, 't'); t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = line;
      r.appendChild(t);
    });
    p.appendChild(r);
    return p;
  }

  /* answers: [{ at: paragraph or slide number (1-based) or null, text }] */
  function fill(dataUrl, kind, answers) {
    return open(dataUrl).then(function (zip) {
      if (kind === 'docx') {
        return zip.file('word/document.xml').async('string').then(function (s) {
          var doc = xml(s), ps = Array.prototype.slice.call(doc.getElementsByTagNameNS(W_NS, 'p'));
          var body = doc.getElementsByTagNameNS(W_NS, 'body')[0], loose = [];
          // insert from the bottom up so earlier positions don't move
          answers.slice().reverse().forEach(function (a) {
            var target = a.at ? ps[a.at - 1] : null;
            if (!target) { loose.unshift(a); return; }
            target.parentNode.insertBefore(answerPara(doc, a.text), target.nextSibling);
          });
          if (loose.length && body) {
            var sect = null;
            for (var c = body.lastChild; c; c = c.previousSibling) { if (c.nodeType === 1 && c.localName === 'sectPr') { sect = c; break; } }
            loose.forEach(function (a) { body.insertBefore(answerPara(doc, a.text), sect); });
          }
          zip.file('word/document.xml', out(doc));
          return zip.generateAsync({ type: 'blob', mimeType: MIME.docx });
        });
      }
      return slidePaths(zip).then(function (info) {
        var bySlide = {};
        answers.forEach(function (a) { var n = Math.min(info.paths.length, Math.max(1, Number(a.at) || info.paths.length)); (bySlide[n] = bySlide[n] || []).push(a); });
        return Promise.all(Object.keys(bySlide).map(function (n) {
          var path = info.paths[Number(n) - 1], list = bySlide[n];
          return zip.file(path).async('string').then(function (s) {
            var doc = xml(s), tree = doc.getElementsByTagNameNS(P_NS, 'spTree')[0];
            if (!tree) return;
            var h = Math.round(info.cy * 0.075);
            list.forEach(function (a, k) {
              var y = Math.round(info.cy * 0.985 - h * (list.length - k));
              var frag = xml('<p:sp xmlns:p="' + P_NS + '" xmlns:a="' + A_NS + '"><p:nvSpPr><p:cNvPr id="' + (90000 + k) + '" name="badgerbox answer ' + (k + 1) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
                '<p:spPr><a:xfrm><a:off x="' + Math.round(info.cx * 0.04) + '" y="' + y + '"/><a:ext cx="' + Math.round(info.cx * 0.92) + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
                '<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>' +
                String(a.text).split('\n').map(function (line) { return '<a:p><a:r><a:rPr lang="en-US" sz="1600" b="1" dirty="0"><a:solidFill><a:srgbClr val="' + INK + '"/></a:solidFill></a:rPr><a:t>' + esc(line) + '</a:t></a:r></a:p>'; }).join('') +
                '</p:txBody></p:sp>');
              tree.appendChild(doc.importNode(frag.documentElement, true));
            });
            zip.file(path, out(doc));
          });
        })).then(function () { return zip.generateAsync({ type: 'blob', mimeType: MIME.pptx }); });
      });
    });
  }

  /* pages: [{ url (data URL of the page picture), w, h (pixels), items: [{ x, y, w (0..1), text }] }] */
  function pagesPptx(pages, scale) {
    return load().then(function () {
      var pptx = new window.PptxGenJS();
      var W = 10, H = Math.round(W * pages[0].h / pages[0].w * 100) / 100;
      pptx.defineLayout({ name: 'worksheet', width: W, height: H });
      pptx.layout = 'worksheet';
      pages.forEach(function (pg) {
        var slide = pptx.addSlide();
        var ph = Math.min(H, W * pg.h / pg.w);
        slide.addImage({ data: pg.url.replace(/^data:/, ''), x: 0, y: 0, w: W, h: ph });
        var size = Math.max(8, Math.round(W * 72 * 0.021 * (scale || 1)));
        pg.items.forEach(function (it) {
          var w = Math.max(0.15, Math.min(1 - it.x, it.w || 0.5)) * W;
          var lines = Math.max(1, String(it.text).split('\n').length + Math.floor(String(it.text).length * size * 0.55 / (w * 72)));
          slide.addText(String(it.text), { x: it.x * W, y: it.y * ph, w: w, h: lines * size * 1.3 / 72, fontSize: size, bold: true, color: INK, fontFace: 'Arial', valign: 'top', margin: 0 });
        });
      });
      return pptx.write({ outputType: 'blob' });
    });
  }

  function cleanPptx(title, questions) {
    return load().then(function () {
      var pptx = new window.PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';
      questions.forEach(function (q) {
        var slide = pptx.addSlide();
        slide.addText(q.n + '. ' + q.text, { x: 0.5, y: 0.3, w: 9, h: 1.2, fontSize: 18, bold: true, color: '000000', fontFace: 'Arial', valign: 'top' });
        slide.addText((q.steps || []).map(function (s) { return s.text + ':  ' + s.result; }).join('\n'), { x: 0.7, y: 1.6, w: 8.6, h: 2.6, fontSize: 13, color: '333333', fontFace: 'Arial', valign: 'top' });
        slide.addText(q.ans + (q.unsure ? '  (?)' : ''), { x: 0.5, y: 4.4, w: 9, h: 0.9, fontSize: 18, bold: true, color: INK, fontFace: 'Arial', valign: 'top' });
      });
      return pptx.write({ outputType: 'blob' });
    });
  }

  function cleanDocx(title, klass, questions) {
    return load().then(function () {
      var run = function (text, opts) {
        opts = opts || {};
        return '<w:r><w:rPr>' + (opts.b ? '<w:b/>' : '') + (opts.color ? '<w:color w:val="' + opts.color + '"/>' : '') + '</w:rPr><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
      };
      var para = function (inner, indent) { return '<w:p>' + (indent ? '<w:pPr><w:ind w:left="' + indent + '"/></w:pPr>' : '') + inner + '</w:p>'; };
      var body = para(run(title || 'worksheet', { b: true }) + (klass ? run('    ' + klass) : '')) + para(run('name ____________________   date __________   period ____', { color: '555555' })) + para('');
      questions.forEach(function (q) {
        body += para(run(q.n + '. ' + q.text, { b: true }));
        (q.steps || []).forEach(function (s) { body += para(run(s.text + ':  ' + s.result, { color: '333333' }), 360); });
        body += para(run(q.ans + (q.unsure ? '  (?)' : ''), { b: true, color: INK }), 360) + para('');
      });
      var zip = new window.JSZip();
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + W_NS + '"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>');
      return zip.generateAsync({ type: 'blob', mimeType: MIME.docx });
    });
  }

  function kindOf(name, type) {
    if (/\.docx$/i.test(name || '') || type === MIME.docx) return 'docx';
    if (/\.pptx$/i.test(name || '') || type === MIME.pptx) return 'pptx';
    return '';
  }

  window.bbOffice = { read: read, tagged: tagged, fill: fill, pagesPptx: pagesPptx, cleanPptx: cleanPptx, cleanDocx: cleanDocx, kindOf: kindOf, MIME: MIME };
})();
