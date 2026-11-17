/* badgerbox: finds the blanks on a worksheet picture.
 *
 * A model can read a page but is poor at giving exact positions. So the blanks are found here, with plain
 * image processing: answer lines ("x = ______"), empty table cells and empty boxes. Each blank gets a
 * label (B1, B2, ...). The model is then only asked which label an answer belongs in.
 *
 *   bbBlanks.detect(url)          -> Promise<[{ tag, x, y, w, h }]>   positions are 0..1 of the page
 *   bbBlanks.tagged(url, blanks)  -> Promise<dataURL>  the page with every blank highlighted and labelled,
 *                                    plus a ruler grid for answers that have no blank
 */
(function () {
  'use strict';

  function loadImage(url) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = url;
    });
  }

  function detect(url) {
    return loadImage(url).then(function (im) {
      if (!im) return [];
      try { return find(im); } catch (err) { return []; }
    });
  }

  function find(im) {
    var W = Math.min(1200, im.naturalWidth), H = Math.max(1, Math.round(W * im.naturalHeight / im.naturalWidth));
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
    g.drawImage(im, 0, 0, W, H);
    var px = g.getImageData(0, 0, W, H).data;

    // 1 = ink, 0 = paper. Photos are grey rather than white, so compare with the page's own brightness.
    var lum = new Uint8Array(W * H), sum = 0, i, n = W * H;
    for (i = 0; i < n; i++) { var v = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10; lum[i] = v; sum += v; }
    var cut = Math.min(165, (sum / n) * 0.62);
    var ink = new Uint8Array(n);
    for (i = 0; i < n; i++) ink[i] = lum[i] < cut ? 1 : 0;

    // 1. long horizontal strokes: the underline of a blank, or the bottom edge of a box or table cell
    var minRun = Math.max(22, Math.round(W * 0.03)), runs = [], x, y;
    for (y = 0; y < H; y++) {
      var start = -1, gap = 0, row = y * W;
      for (x = 0; x <= W; x++) {
        var d = x < W && ink[row + x];
        if (d) { if (start < 0) start = x; gap = 0; }
        else if (start >= 0) {
          gap++;
          if (gap > 2 || x === W) { var end = x - gap; if (end - start + 1 >= minRun) runs.push({ y: y, x0: start, x1: end }); start = -1; gap = 0; }
        }
      }
    }
    // join strokes on neighbouring rows into lines, and drop anything too thick to be a line
    var lines = [], open = [];
    runs.forEach(function (r) {
      var hit = null;
      for (var k = open.length - 1; k >= 0; k--) {
        var L = open[k];
        if (r.y - L.y1 > 1) { if (r.y - L.y1 > 2) open.splice(k, 1); continue; }
        var ov = Math.min(L.x1, r.x1) - Math.max(L.x0, r.x0);
        if (ov >= 0.7 * Math.min(L.x1 - L.x0, r.x1 - r.x0)) { hit = L; break; }
      }
      if (hit) { hit.y1 = r.y; hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1); }
      else { var nl = { y0: r.y, y1: r.y, x0: r.x0, x1: r.x1 }; lines.push(nl); open.push(nl); }
    });
    var maxThick = Math.max(5, Math.round(H * 0.005));
    lines = lines.filter(function (L) { return L.y1 - L.y0 + 1 <= maxThick; });

    // 2. the space just above each line: where it is empty paper, that is a blank
    var band = Math.max(8, Math.round(H * 0.011)), capUp = Math.round(H * 0.30), minW = Math.max(18, Math.round(W * 0.025));
    var lineCap = Math.round(H * 0.03), minH = Math.round(H * 0.016);
    var out = [];
    // is there an upright stroke at this spot, going up (dir -1) or down (dir 1) from the line? (a box corner)
    function upright(xc, yFrom, dir) {
      for (var dx = -2; dx <= 2; dx++) {
        var xx = xc + dx, cnt = 0;
        if (xx < 0 || xx >= W) continue;
        for (var t = 1; t <= band; t++) { var ry = yFrom + dir * t; if (ry >= 0 && ry < H && ink[ry * W + xx]) cnt++; }
        if (cnt >= band * 0.8) return true;
      }
      return false;
    }
    lines.forEach(function (L) {
      var top = L.y0 - band;
      if (top < 1) return;
      // the top edge of a box is not a blank: the space above it belongs to whatever is printed there
      var downBoth = upright(L.x0, L.y1, 1) && upright(L.x1, L.y1, 1), upBoth = upright(L.x0, L.y0, -1) && upright(L.x1, L.y0, -1);
      if (downBoth && !upBoth) return;
      // which columns are clear in the band (a cell border or a letter makes a column not clear)
      var clear = new Uint8Array(L.x1 - L.x0 + 1), cx, yy;
      for (cx = L.x0; cx <= L.x1; cx++) {
        var dark = 0;
        for (yy = top; yy < L.y0 - 1; yy++) dark += ink[yy * W + cx];
        clear[cx - L.x0] = dark === 0 ? 1 : 0;
      }
      var s = -1;
      for (cx = 0; cx <= clear.length; cx++) {
        if (cx < clear.length && clear[cx]) { if (s < 0) s = cx; continue; }
        if (s >= 0) {
          var a = L.x0 + s, b = L.x0 + cx - 1;
          s = -1;
          if (b - a + 1 < minW) continue;
          // how far up the empty space goes
          var up = top, closed = false;
          while (up > 0 && L.y0 - up < capUp) {
            var inkRow = 0, base = (up - 1) * W;
            for (var q = a + 1; q < b; q++) inkRow += ink[base + q];
            if (inkRow > Math.max(1, (b - a) * 0.004)) { closed = inkRow > (b - a) * 0.6; break; }
            up--;
          }
          var hgt = L.y0 - up;
          // an answer line with open space above it is one line of writing tall; a closed box keeps its height
          if (!closed) { hgt = Math.min(hgt, lineCap); up = L.y0 - hgt; }
          if (hgt < minH) continue;
          out.push({ x: a, y: up, w: b - a + 1, h: hgt, box: closed });
        }
      }
    });

    // 3. tidy: drop near-duplicates (double borders), sort in reading order, label
    out.sort(function (p, q) { return p.y + p.h - (q.y + q.h) || p.x - q.x; });
    var kept = [];
    out.forEach(function (r) {
      var dup = kept.some(function (k) {
        var ox = Math.min(k.x + k.w, r.x + r.w) - Math.max(k.x, r.x), oy = Math.min(k.y + k.h, r.y + r.h) - Math.max(k.y, r.y);
        return ox > 0.8 * Math.min(k.w, r.w) && oy > 0.6 * Math.min(k.h, r.h);
      });
      if (!dup) kept.push(r);
    });
    // rows first (blanks whose bottoms are within a few pixels count as one row), then left to right
    var tol = Math.max(4, Math.round(H * 0.006));
    kept.sort(function (p, q) { var dy = (p.y + p.h) - (q.y + q.h); return Math.abs(dy) > tol ? dy : p.x - q.x; });
    return kept.slice(0, 160).map(function (r, k) {
      return { tag: 'B' + (k + 1), x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H, box: !!r.box };
    });
  }

  /* The page as the model sees it: blanks tinted and labelled, and a ruler grid round the edge. */
  function tagged(url, blanks) {
    return loadImage(url).then(function (im) {
      if (!im) return null;
      try {
        var W = Math.min(1500, im.naturalWidth), H = Math.round(W * im.naturalHeight / im.naturalWidth);
        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var g = c.getContext('2d');
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
        g.drawImage(im, 0, 0, W, H);
        var fs = Math.max(11, Math.round(W * 0.012)), k;
        // ruler grid: every tenth, labelled on all four edges
        g.font = 'bold ' + fs + 'px Arial, sans-serif'; g.textBaseline = 'top';
        for (k = 0; k <= 10; k++) {
          var x = Math.round(W * k / 10), y = Math.round(H * k / 10), label = (k / 10).toFixed(1), tw = g.measureText(label).width + 4;
          g.strokeStyle = 'rgba(220,0,0,0.30)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
          g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
          [[Math.min(W - tw, Math.max(0, x - tw / 2)), 0], [Math.min(W - tw, Math.max(0, x - tw / 2)), H - fs - 2], [0, Math.min(H - fs - 2, Math.max(0, y - fs / 2))], [W - tw, Math.min(H - fs - 2, Math.max(0, y - fs / 2))]].forEach(function (pt) {
            g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(pt[0], pt[1], tw, fs + 2);
            g.fillStyle = '#C00000'; g.fillText(label, pt[0] + 2, pt[1] + 1);
          });
        }
        // blanks
        var ls = Math.max(10, Math.round(W * 0.0105));
        g.font = 'bold ' + ls + 'px Arial, sans-serif';
        (blanks || []).forEach(function (b) {
          var bx = b.x * W, by = b.y * H, bw = b.w * W, bh = b.h * H;
          g.fillStyle = 'rgba(0,150,255,0.16)'; g.fillRect(bx, by, bw, bh);
          g.strokeStyle = 'rgba(0,90,200,0.85)'; g.lineWidth = 1.5; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
          var lw = g.measureText(b.tag).width + 6, lx = bx + 2, ly = Math.max(0, by + bh - ls - 4);
          g.fillStyle = '#003C96'; g.fillRect(lx, ly, lw, ls + 3);
          g.fillStyle = '#FFFFFF'; g.fillText(b.tag, lx + 3, ly + 1);
        });
        return c.toDataURL('image/jpeg', 0.82);
      } catch (err) { return null; }
    });
  }

  window.bbBlanks = { detect: detect, tagged: tagged };
})();
