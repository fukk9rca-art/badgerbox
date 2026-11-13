/* dc-lite: runs a badgerbox screen (.dc.html format) as a normal web page.
 *
 * A screen file has an <x-dc> block of markup with {{ holes }}, <sc-for> and
 * <sc-if>, plus a <script type="text/x-dc"> holding `class Component extends
 * DCLogic`. This file reads both, renders the markup from renderVals(), and
 * re-renders on setState by morphing the live DOM (so focus, typed text and
 * scroll positions survive).
 */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\}\}/g;
  var ONE_HOLE = /^\s*\{\{\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\}\}\s*$/;
  var EVENT_ALIAS = { doubleclick: 'dblclick', focus: 'focusin', blur: 'focusout' };
  var NO_BUBBLE = { scroll: true };

  function lookup(scope, path) {
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }

  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(scope, p);
      return v == null ? '' : String(v);
    });
  }

  function evalAttr(el, name, scope) {
    var raw = el.getAttribute(name);
    if (raw == null) return undefined;
    var m = ONE_HOLE.exec(raw);
    return m ? lookup(scope, m[1]) : interp(raw, scope);
  }

  function child(scope) { return Object.create(scope); }

  function buildChildren(tpl, scope, parent) {
    for (var n = tpl.firstChild; n; n = n.nextSibling) build(n, scope, parent);
  }

  function build(tpl, scope, parent) {
    if (tpl.nodeType === 3) {
      parent.appendChild(document.createTextNode(interp(tpl.nodeValue, scope)));
      return;
    }
    if (tpl.nodeType !== 1) return;
    var tag = tpl.localName;
    if (tag === 'helmet') return;
    if (tag === 'sc-for') {
      var list = evalAttr(tpl, 'list', scope) || [];
      var as = tpl.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var sc = child(scope);
        sc[as] = list[i];
        buildChildren(tpl, sc, parent);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (evalAttr(tpl, 'value', scope)) buildChildren(tpl, scope, parent);
      return;
    }
    var el = document.createElementNS(tpl.namespaceURI, tpl.localName);
    var attrs = tpl.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name;
      var raw = attrs[a].value;
      if (name.indexOf('hint-') === 0) continue;
      var m = ONE_HOLE.exec(raw);
      var val = m ? lookup(scope, m[1]) : interp(raw, scope);
      if (/^on[a-z]+$/.test(name) && (m || typeof val === 'function')) {
        if (typeof val === 'function') {
          var type = name.slice(2);
          type = EVENT_ALIAS[type] || type;
          (el.__dc || (el.__dc = {}))[type] = val;
        }
        continue;
      }
      if (val == null || val === false) continue;
      el.setAttribute(name, val === true ? '' : String(val));
    }
    buildChildren(tpl, scope, el);
    parent.appendChild(el);
  }

  /* ---------- events: one listener per type on the document ---------- */
  var bound = {};
  function bind(type) {
    if (bound[type]) return;
    bound[type] = true;
    document.addEventListener(type, function (e) {
      var stopped = false;
      var nativeStop = e.stopPropagation;
      try { e.stopPropagation = function () { stopped = true; nativeStop.call(e); }; } catch (err) {}
      var node = e.target;
      while (node && !stopped) {
        var h = node.__dc && node.__dc[type];
        if (h) {
          try { Object.defineProperty(e, 'currentTarget', { value: node, configurable: true }); } catch (err) {}
          h(e);
          if (NO_BUBBLE[type]) break;
        }
        if (NO_BUBBLE[type]) break;
        node = node.parentNode;
      }
    }, NO_BUBBLE[type] ? true : false);
  }
  ['click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'keyup', 'focusin', 'focusout',
   'scroll', 'paste', 'dragover', 'dragleave', 'drop', 'pointerdown', 'pointermove', 'pointerup',
   'pointercancel', 'mousedown', 'mouseup'].forEach(bind);

  /* ---------- component base ---------- */
  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state || {}, this.props) : patch;
    this.state = Object.assign({}, this.state || {}, p || {});
    if (this.__schedule) this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__schedule) this.__schedule(); };
  DCLogic.prototype.componentDidMount = function () {};
  DCLogic.prototype.componentWillUnmount = function () {};
  DCLogic.prototype.renderVals = function () { return {}; };
  window.DCLogic = DCLogic;

  function keepFieldValue(from, to) {
    var tag = from.nodeName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    var type = (from.getAttribute('type') || '').toLowerCase();
    if (type === 'file' || type === 'checkbox' || type === 'radio') return;
    var focused = from === document.activeElement;
    if (!to.hasAttribute('value') || focused) to.value = from.value;
  }

  function mount() {
    var xdc = document.querySelector('x-dc');
    var script = document.querySelector('script[type="text/x-dc"]');
    if (!xdc || !script) return;

    var helmet = xdc.querySelector('helmet');
    if (helmet) {
      while (helmet.firstChild) {
        var c = helmet.firstChild;
        if (c.nodeType === 1) document.head.appendChild(c); else helmet.removeChild(c);
      }
    }

    var tpl = document.createElement('div');
    while (xdc.firstChild) tpl.appendChild(xdc.firstChild);
    var root = document.createElement('div');
    root.id = 'dc-mount';
    root.style.display = 'contents';
    xdc.parentNode.replaceChild(root, xdc);

    var defs = {};
    try { defs = JSON.parse(script.getAttribute('data-props') || '{}'); } catch (err) {}
    var props = {};
    Object.keys(defs).forEach(function (k) {
      if (k.charAt(0) !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k].default;
    });

    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    var comp = new Component(props);
    if (!comp.state) comp.state = {};
    comp.props = comp.props && Object.keys(comp.props).length ? comp.props : props;

    var pending = false;
    function render() {
      pending = false;
      var vals = comp.renderVals() || {};
      var scope = Object.assign(Object.create(null), vals);
      var next = document.createElement('div');
      buildChildren(tpl, scope, next);
      window.morphdom(root, next, {
        childrenOnly: true,
        onBeforeElUpdated: function (from, to) {
          from.__dc = to.__dc;
          keepFieldValue(from, to);
          return true;
        }
      });
    }
    comp.__schedule = function () {
      if (pending) return;
      pending = true;
      Promise.resolve().then(render);
    };
    render();
    document.documentElement.classList.add('dc-ready');
    comp.componentDidMount();
    window.addEventListener('pagehide', function () { try { comp.componentWillUnmount(); } catch (err) {} });
    window.__dcComponent = comp;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
