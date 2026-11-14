/* bb-fx: the camera-switch static flash when you enter badgerbox.
 * The flash on arrival is pure CSS (css/site.css). This adds the flash on the way out:
 * clicking an "enter" link plays a burst of static, then moves to the next screen. */
(function () {
  'use strict';
  var ENTER = /(^|\/)(enter|app|walkthrough)(\.html)?([?#].*)?$/;
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !ENTER.test(a.getAttribute('href') || '')) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    var go = function () { window.location.href = a.href; };
    document.documentElement.classList.add('bb-leaving');
    setTimeout(go, 300);
  });
  // coming back with the browser's back button should not leave the static on screen
  window.addEventListener('pageshow', function () { document.documentElement.classList.remove('bb-leaving'); });
})();
