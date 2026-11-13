/* bb-plot: draws homework graphs in the badgerbox look, and does the math itself.
 *
 * The model (or the sample data) only supplies numbers. Regression lines, r²,
 * histogram bins and quartiles are calculated here, so they are exact.
 *
 * A figure spec:
 *   { type: 'scatter' | 'line' | 'function' | 'bar' | 'histogram' | 'box',
 *     title, xLabel, yLabel, xUnit, yUnit,
 *     points: [[x, y], ...]        scatter, line, and marked points on a function
 *     fit: true, predict: 0.5      scatter: best-fit line, and a value to read off it
 *     expr: '2x + 1', domain: [a, b], range: [c, d]     function
 *     categories: [...], values: [...]                   bar
 *     values: [...], bins: n                             histogram, box
 *     read: true }                 the data was read off a graph on the worksheet
 *
 * build(spec, { hov }) returns path strings and label positions for the page
 * template; svg(spec) returns a standalone black-on-white SVG for printing.
 */
(function () {
  'use strict';
  var VB = { w: 560, h: 300, l: 56, r: 544, t: 14, b: 252 };

  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function f(n, d) { return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function trim(n) { var s = f(n, 3); return s.indexOf('.') === -1 ? s : s.replace(/0+$/, '').replace(/\.$/, ''); }

  function linreg(ps) {
    var n = ps.length, sx = 0, sy = 0, i;
    for (i = 0; i < n; i++) { sx += ps[i][0]; sy += ps[i][1]; }
    var mx = n ? sx / n : 0, my = n ? sy / n : 0, sxx = 0, sxy = 0, syy = 0;
    for (i = 0; i < n; i++) { sxx += (ps[i][0] - mx) * (ps[i][0] - mx); sxy += (ps[i][0] - mx) * (ps[i][1] - my); syy += (ps[i][1] - my) * (ps[i][1] - my); }
    var m = sxx ? sxy / sxx : 0;
    return { m: m, b: my - m * mx, r2: (sxx && syy) ? (sxy * sxy) / (sxx * syy) : 1 };
  }
  function fitEq(fit, yName, xName) {
    return (yName || 'y') + ' = ' + trim(fit.m) + (xName || 'x') + ' ' + (fit.b < 0 ? '− ' : '+ ') + trim(Math.abs(fit.b));
  }
  function median(sorted) {
    var n = sorted.length; if (!n) return 0;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
  function summary(values) {
    var v = values.slice().sort(function (a, b) { return a - b; });
    var n = v.length, half = Math.floor(n / 2), sum = 0, i;
    for (i = 0; i < n; i++) sum += v[i];
    var mean = n ? sum / n : 0, ss = 0;
    for (i = 0; i < n; i++) ss += (v[i] - mean) * (v[i] - mean);
    return { n: n, min: v[0], max: v[n - 1], mean: mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
      median: median(v), q1: median(v.slice(0, half)), q3: median(v.slice(n % 2 ? half + 1 : half)) };
  }

  /* axis ticks at 1, 2 or 5 times a power of ten */
  function ticks(lo, hi, want) {
    if (lo === hi) { lo -= 1; hi += 1; }
    var raw = (hi - lo) / (want || 6), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), r = raw / p;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, out = [];
    for (var v = a; v <= b + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
    var d = Math.max(0, -Math.floor(Math.log(step) / Math.LN10 + 1e-9));
    return { list: out, lo: a, hi: b, step: step, dec: d };
  }
  function span(vals, zero) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (zero && lo > 0 && lo < 0.5 * hi) lo = 0;
    if (zero && hi < 0 && hi > 0.5 * lo) hi = 0;
    return [lo, hi];
  }

  /* ---- tiny expression evaluator for function graphs: 2x^2 - 3x + 1, sin(x), sqrt(x) ... ---- */
  var FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
    ln: Math.log, log: function (v) { return Math.log(v) / Math.LN10; }, asin: Math.asin, acos: Math.acos, atan: Math.atan };
  function compile(src) {
    var s = String(src || '').replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, '')
      .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3')
      .replace(/π/g, 'pi').replace(/√/g, 'sqrt').toLowerCase();
    var tok = s.match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/^()]/g) || [], i = 0;
    function peek() { return tok[i]; }
    function starts(t) { return t !== undefined && (/^[\d.]/.test(t) || /^[a-z]/.test(t) || t === '('); }
    function primary() {
      var t = tok[i++];
      if (t === undefined) throw new Error('unexpected end');
      if (/^[\d.]/.test(t)) { var n = parseFloat(t); return function () { return n; }; }
      if (t === '(') { var e = expr(); if (tok[i++] !== ')') throw new Error('missing )'); return e; }
      if (t === 'x') return function (x) { return x; };
      if (t === 'pi') return function () { return Math.PI; };
      if (t === 'e') return function () { return Math.E; };
      if (FN[t]) { var fn = FN[t]; if (tok[i++] !== '(') throw new Error('missing ('); var a = expr(); if (tok[i++] !== ')') throw new Error('missing )'); return function (x) { return fn(a(x)); }; }
      throw new Error('unknown ' + t);
    }
    function power() { var b = primary(); if (peek() === '^') { i++; var e = unary(); return function (x) { return Math.pow(b(x), e(x)); }; } return b; }
    function unary() { if (peek() === '-') { i++; var u = unary(); return function (x) { return -u(x); }; } if (peek() === '+') { i++; return unary(); } return power(); }
    function term() {
      var a = unary();
      for (;;) {
        var t = peek();
        if (t === '*' || t === '/') { i++; (function (l, r, op) { a = op === '*' ? function (x) { return l(x) * r(x); } : function (x) { return l(x) / r(x); }; })(a, unary(), t); }
        else if (starts(t)) { (function (l, r) { a = function (x) { return l(x) * r(x); }; })(a, power()); }
        else return a;
      }
    }
    function expr() {
      var a = term();
      for (;;) {
        var t = peek();
        if (t === '+' || t === '-') { i++; (function (l, r, op) { a = op === '+' ? function (x) { return l(x) + r(x); } : function (x) { return l(x) - r(x); }; })(a, term(), t); }
        else return a;
      }
    }
    var out = expr();
    if (i < tok.length) throw new Error('unexpected ' + tok[i]);
    return out;
  }

  function sq(cx, cy, h) { return 'M' + (cx - h).toFixed(1) + ' ' + (cy - h).toFixed(1) + ' h' + (2 * h) + ' v' + (2 * h) + ' h-' + (2 * h) + ' z'; }
  function rect(x, y, w, h) { return 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + ' h' + w.toFixed(1) + ' v' + h.toFixed(1) + ' h-' + w.toFixed(1) + ' z'; }
  function unit(u) { return u ? ' ' + u : ''; }

  /* Everything a drawing needs, in viewBox units. */
  function layout(spec) {
    spec = spec || {};
    var type = spec.type || 'scatter';
    var L = { type: type, title: spec.title || '', grid: [], axis: [], tick: [], stroke: [], dash: [], box: [], fill: [], labels: [], legend: [], marks: [], note: '' };
    var xu = spec.xUnit || '', yu = spec.yUnit || '';
    var pts = (spec.points || []).map(function (p) { return [num(p[0]), num(p[1])]; }).filter(function (p) { return p[0] !== null && p[1] !== null; });
    var vals = (spec.values || []).map(num).filter(function (v) { return v !== null; });
    var X, Y, gx, gy, i;
    function scales(xr, yr, xWant, yWant) {
      X = ticks(xr[0], xr[1], xWant || 7); Y = ticks(yr[0], yr[1], yWant || 6);
      gx = function (x) { return VB.l + (x - X.lo) / (X.hi - X.lo) * (VB.r - VB.l); };
      gy = function (y) { return VB.b - (y - Y.lo) / (Y.hi - Y.lo) * (VB.b - VB.t); };
    }
    function frame(xTicks, yTicks) {
      L.axis.push('M' + VB.l + ' ' + VB.t + ' V' + VB.b + ' H' + VB.r);
      if (yTicks) Y.list.forEach(function (v) {
        var y = gy(v);
        if (Math.abs(y - VB.b) > 0.5) L.grid.push('M' + VB.l + ' ' + y.toFixed(1) + ' H' + VB.r);
        L.tick.push('M' + VB.l + ' ' + y.toFixed(1) + ' h-5');
        L.labels.push({ text: f(v, Y.dec), x: VB.l - 9, y: y, anchor: 'end' });
      });
      if (xTicks) X.list.forEach(function (v) {
        var x = gx(v);
        if (Math.abs(x - VB.l) > 0.5) L.grid.push('M' + x.toFixed(1) + ' ' + VB.t + ' V' + VB.b);
        L.tick.push('M' + x.toFixed(1) + ' ' + VB.b + ' v5');
        L.labels.push({ text: f(v, X.dec), x: x, y: VB.b + 8, anchor: 'middle' });
      });
      if (spec.xLabel) L.labels.push({ text: spec.xLabel, x: (VB.l + VB.r) / 2, y: VB.b + 26, anchor: 'middle' });
      if (spec.yLabel) L.labels.push({ text: spec.yLabel, x: VB.l + 8, y: VB.t - 12, anchor: 'start', top: true });
    }

    if (type === 'scatter' || type === 'line') {
      if (!pts.length) return L;
      var fit = spec.fit ? linreg(pts) : null, px = num(spec.predict), py = (fit && px !== null) ? fit.m * px + fit.b : null;
      var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      if (py !== null) { xs.push(px); ys.push(py); }
      scales(span(xs, true), span(ys, true));
      frame(true, true);
      L.fill = pts.map(function (p) { return sq(gx(p[0]), gy(p[1]), 4.5); });
      pts.forEach(function (p, k) { L.marks.push({ cx: gx(p[0]), cy: gy(p[1]), text: '(' + trim(p[0]) + unit(xu) + ', ' + trim(p[1]) + unit(yu) + ')', label: 'point ' + (k + 1) }); });
      L.legend.push({ mark: '■', text: spec.read ? 'read from the worksheet' : 'data' });
      if (type === 'line') {
        var sorted = pts.slice().sort(function (a, b) { return a[0] - b[0]; });
        L.stroke.push(sorted.map(function (p, k) { return (k ? 'L' : 'M') + gx(p[0]).toFixed(1) + ' ' + gy(p[1]).toFixed(1); }).join(' '));
      }
      if (fit) {
        var x0 = X.lo, x1 = X.hi;
        L.stroke.push('M' + gx(x0).toFixed(1) + ' ' + gy(fit.m * x0 + fit.b).toFixed(1) + ' L' + gx(x1).toFixed(1) + ' ' + gy(fit.m * x1 + fit.b).toFixed(1));
        L.legend.push({ mark: '—', text: 'best fit: ' + fitEq(fit) + ' · r² = ' + f(fit.r2, 3) });
        L.fit = fit;
        L.note = 'the line and r² are calculated, not eyeballed.';
      }
      if (py !== null) {
        L.dash.push('M' + gx(px).toFixed(1) + ' ' + VB.b + ' V' + gy(py).toFixed(1) + ' H' + VB.l);
        L.box.push(sq(gx(px), gy(py), 6));
        L.marks.push({ cx: gx(px), cy: gy(py), text: '(' + trim(px) + unit(xu) + ', ' + f(py, 2) + unit(yu) + ') predicted', label: 'predicted' });
        L.legend.push({ mark: '□', text: 'predicted' });
        L.pred = py;
      }
      L.clip = true;
    } else if (type === 'function') {
      var fn; try { fn = compile(spec.expr); } catch (err) { L.note = 'could not read the function "' + String(spec.expr || '') + '"'; return L; }
      var dom = (spec.domain && spec.domain.length === 2) ? [num(spec.domain[0]), num(spec.domain[1])] : [-10, 10];
      if (dom[0] === null || dom[1] === null || dom[0] >= dom[1]) dom = [-10, 10];
      var N = 240, samp = [], fy = [];
      for (i = 0; i <= N; i++) { var xv = dom[0] + (dom[1] - dom[0]) * i / N, yv = fn(xv); samp.push([xv, yv]); if (isFinite(yv)) fy.push(yv); }
      var yr;
      if (spec.range && spec.range.length === 2 && num(spec.range[0]) !== null && num(spec.range[1]) !== null && num(spec.range[0]) < num(spec.range[1])) yr = [num(spec.range[0]), num(spec.range[1])];
      else {
        var sortedY = fy.slice().sort(function (a, b) { return a - b; });
        if (!sortedY.length) sortedY = [-1, 1];
        var lo = sortedY[Math.floor(sortedY.length * 0.03)], hi = sortedY[Math.ceil(sortedY.length * 0.97) - 1];
        pts.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
        if (lo === hi) { lo -= 1; hi += 1; }
        yr = [Math.min(lo, 0), Math.max(hi, 0)];
      }
      scales(dom, yr, 8, 6);
      frame(true, true);
      if (X.lo < 0 && X.hi > 0) L.axis.push('M' + gx(0).toFixed(1) + ' ' + VB.t + ' V' + VB.b);
      if (Y.lo < 0 && Y.hi > 0) L.axis.push('M' + VB.l + ' ' + gy(0).toFixed(1) + ' H' + VB.r);
      var d = '', pen = false, prev = null, limit = (Y.hi - Y.lo);
      samp.forEach(function (p) {
        var ok = isFinite(p[1]) && p[1] >= Y.lo - limit && p[1] <= Y.hi + limit && (prev === null || Math.abs(p[1] - prev) < limit * 1.5);
        if (ok) { d += (pen ? ' L' : ' M') + gx(p[0]).toFixed(1) + ' ' + gy(p[1]).toFixed(1); pen = true; } else pen = false;
        prev = isFinite(p[1]) ? p[1] : null;
      });
      L.stroke.push(d.trim());
      L.fill = pts.map(function (p) { return sq(gx(p[0]), gy(p[1]), 4.5); });
      pts.forEach(function (p, k) { L.marks.push({ cx: gx(p[0]), cy: gy(p[1]), text: '(' + trim(p[0]) + ', ' + trim(p[1]) + ')', label: 'point ' + (k + 1) }); });
      L.legend.push({ mark: '—', text: 'y = ' + String(spec.expr || '').replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '') });
      if (pts.length) L.legend.push({ mark: '■', text: 'key points' });
      L.clip = true;
      L.fn = fn;
    } else if (type === 'bar') {
      var cats = (spec.categories || []).map(String), bv = cats.map(function (_, k) { return num((spec.values || [])[k]) || 0; });
      if (!cats.length) return L;
      scales([0, cats.length], span(bv.concat([0]), true));
      frame(false, true);
      var bw = (VB.r - VB.l) / cats.length;
      cats.forEach(function (c, k) {
        var x = VB.l + bw * k + bw * 0.18, w = bw * 0.64, y0 = gy(0), y1 = gy(bv[k]);
        L.fill.push(rect(x, Math.min(y0, y1), w, Math.abs(y0 - y1)));
        L.labels.push({ text: c.length > 12 ? c.slice(0, 11) + '…' : c, x: x + w / 2, y: VB.b + 8, anchor: 'middle' });
        L.marks.push({ cx: x + w / 2, cy: y1, text: c + ': ' + trim(bv[k]) + unit(yu), label: c });
      });
      if (Y.lo < 0) L.axis.push('M' + VB.l + ' ' + gy(0).toFixed(1) + ' H' + VB.r);
    } else if (type === 'histogram') {
      if (!vals.length) return L;
      var st = summary(vals), want = Math.max(4, Math.min(12, num(spec.bins) || Math.ceil(Math.sqrt(vals.length))));
      var T = ticks(st.min, st.max, want), edges = T.list.slice();
      if (edges[edges.length - 1] <= st.max) edges.push(edges[edges.length - 1] + T.step);
      var counts = edges.slice(0, -1).map(function () { return 0; });
      vals.forEach(function (v) { var k = Math.min(counts.length - 1, Math.max(0, Math.floor((v - edges[0]) / T.step + 1e-9))); counts[k]++; });
      X = { list: edges, lo: edges[0], hi: edges[edges.length - 1], step: T.step, dec: T.dec };
      Y = ticks(0, Math.max.apply(null, counts), 5); if (Y.step < 1) Y = { list: [0, 1], lo: 0, hi: 1, step: 1, dec: 0 };
      gx = function (x) { return VB.l + (x - X.lo) / (X.hi - X.lo) * (VB.r - VB.l); };
      gy = function (y) { return VB.b - (y - Y.lo) / (Y.hi - Y.lo) * (VB.b - VB.t); };
      frame(true, true);
      counts.forEach(function (c, k) {
        var xa = gx(edges[k]) + 1, xb = gx(edges[k + 1]) - 1;
        if (c) L.fill.push(rect(xa, gy(c), xb - xa, VB.b - gy(c)));
        L.marks.push({ cx: (xa + xb) / 2, cy: gy(c), text: f(edges[k], T.dec) + ' to ' + f(edges[k + 1], T.dec) + unit(xu) + ': ' + c, label: 'bin ' + (k + 1) });
      });
      L.legend.push({ mark: '■', text: 'n = ' + st.n + ' · mean ' + f(st.mean, 2) + ' · median ' + trim(st.median) + ' · sd ' + f(st.sd, 2) });
      L.stats = st;
      L.note = 'bins and statistics are calculated from the data.';
    } else if (type === 'box') {
      if (!vals.length) return L;
      var s5 = summary(vals);
      scales([s5.min, s5.max], [0, 1]);
      frame(true, false);
      var mid = (VB.t + VB.b) / 2, hh = 44;
      L.stroke.push('M' + gx(s5.min).toFixed(1) + ' ' + mid + ' H' + gx(s5.q1).toFixed(1) + ' M' + gx(s5.q3).toFixed(1) + ' ' + mid + ' H' + gx(s5.max).toFixed(1) +
        ' M' + gx(s5.min).toFixed(1) + ' ' + (mid - 18) + ' v36 M' + gx(s5.max).toFixed(1) + ' ' + (mid - 18) + ' v36');
      L.box.push(rect(gx(s5.q1), mid - hh, gx(s5.q3) - gx(s5.q1), hh * 2));
      L.stroke.push('M' + gx(s5.median).toFixed(1) + ' ' + (mid - hh) + ' v' + (hh * 2));
      [['min', s5.min], ['Q1', s5.q1], ['median', s5.median], ['Q3', s5.q3], ['max', s5.max]].forEach(function (p) {
        L.marks.push({ cx: gx(p[1]), cy: mid, text: p[0] + ' = ' + trim(p[1]) + unit(xu), label: p[0] });
      });
      L.legend.push({ mark: '□', text: 'min ' + trim(s5.min) + ' · Q1 ' + trim(s5.q1) + ' · median ' + trim(s5.median) + ' · Q3 ' + trim(s5.q3) + ' · max ' + trim(s5.max) });
      L.legend.push({ mark: ' ', text: 'IQR = ' + trim(s5.q3 - s5.q1) + ' · quartiles by the median-of-halves method' });
      L.stats = s5;
    }
    return L;
  }

  function pct(v, of) { return (v / of * 100).toFixed(2) + '%'; }

  /* For the page template. opts.hov = index of the hovered mark, or null. */
  function build(spec, opts) {
    var L = layout(spec), hov = (opts && opts.hov != null && L.marks[opts.hov]) ? L.marks[opts.hov] : null;
    return {
      type: L.type,
      title: L.title,
      aria: (L.type === 'function' ? 'graph' : L.type === 'box' ? 'box plot' : L.type === 'bar' ? 'bar chart' : L.type === 'histogram' ? 'histogram' : 'scatter plot') +
        (L.title ? ' of ' + L.title : '') + '. ' + L.marks.map(function (m) { return m.label + ' ' + m.text; }).join('; ') +
        (L.legend.length ? '. ' + L.legend.map(function (g) { return g.text; }).join('; ') : ''),
      gridPath: L.grid.join(' '), axisPath: L.axis.join(' '), tickPath: L.tick.join(' '),
      strokePath: L.stroke.join(' '), dashPath: L.dash.join(' '), boxPath: L.box.join(' '), fillPath: L.fill.join(' '),
      hovPath: hov ? sq(hov.cx, hov.cy, 10) : '',
      labels: L.labels.map(function (t) {
        return { text: t.text, left: pct(t.x, VB.w), top: pct(t.y, VB.h),
          shift: t.anchor === 'end' ? 'translate(-100%, -50%)' : t.anchor === 'start' ? 'translate(0, 0)' : 'translate(-50%, 0)' };
      }),
      legend: L.legend,
      marks: L.marks,
      note: L.note,
      hovOn: !!hov,
      hovLeft: hov ? pct(hov.cx, VB.w) : '0', hovTop: hov ? pct(hov.cy, VB.h) : '0', hovText: hov ? hov.text : '',
      fit: L.fit || null, pred: L.pred == null ? null : L.pred, stats: L.stats || null,
      hint: (L.marks.length ? 'hover the graph to read exact values. ' : '') + (L.note || '')
    };
  }

  /* Which mark is under the pointer (viewBox units), or null. */
  function nearest(marks, mx, my) {
    var k = null, best = 28 * 28;
    (marks || []).forEach(function (m, i) { var d = (m.cx - mx) * (m.cx - mx) + (m.cy - my) * (m.cy - my); if (d < best) { best = d; k = i; } });
    return k;
  }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* Standalone SVG (black on white) for the printed worksheet. */
  function svg(spec, width) {
    var L = layout(spec), w = width || 460, h = Math.round(w * (VB.h + 6 + 16 * L.legend.length) / VB.w);
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VB.w + ' ' + (VB.h + 6 + 16 * L.legend.length) + '" width="' + w + '" height="' + h + '" font-family="Cousine, Menlo, Consolas, monospace" font-size="12">';
    out += '<path d="' + L.grid.join(' ') + '" stroke="#999" stroke-width="1" stroke-dasharray="2 4" fill="none"/>';
    out += '<path d="' + L.axis.join(' ') + ' ' + L.tick.join(' ') + '" stroke="#000" stroke-width="1.5" fill="none"/>';
    out += '<path d="' + L.stroke.join(' ') + '" stroke="#000" stroke-width="2" fill="none"/>';
    out += '<path d="' + L.dash.join(' ') + '" stroke="#000" stroke-width="1" stroke-dasharray="5 4" fill="none"/>';
    out += '<path d="' + L.box.join(' ') + '" stroke="#000" stroke-width="2" fill="#fff"/>';
    out += '<path d="' + L.fill.join(' ') + '" fill="#000"/>';
    L.labels.forEach(function (t) {
      out += '<text x="' + t.x.toFixed(1) + '" y="' + (t.y + (t.anchor === 'end' ? 4 : 11)).toFixed(1) + '" text-anchor="' + (t.anchor || 'middle') + '">' + esc(t.text) + '</text>';
    });
    L.legend.forEach(function (g, k) { out += '<text x="' + VB.l + '" y="' + (VB.h + 14 + 16 * k) + '">' + esc(g.mark + ' ' + g.text) + '</text>'; });
    return out + '</svg>';
  }

  window.bbPlot = { build: build, svg: svg, nearest: nearest, linreg: linreg, summary: summary, fitEq: fitEq, compile: compile, VB: VB };
})();
