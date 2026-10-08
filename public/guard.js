/* DrawDraw - safety net. Loaded before the app's bundle and depending on nothing, so that when the
   bundle fails to load, is refused, or throws before the app has drawn anything, the visitor sees a
   short note instead of a blank page; and when the app stops after it has started (React unmounts
   the whole tree on an uncaught render error), a note says so instead of leaving an empty screen.
   The notes are written in index.html; this only shows and hides them, so nothing here builds
   markup from a string. No syntax newer than const and let: it has to run in a browser too old for
   the bundle, to say so. */
(function () {
  'use strict';

  let started = false;
  let failed = false;

  function show(id) {
    const note = document.getElementById(id);
    if (note) note.hidden = false;
  }
  function hide(id) {
    const note = document.getElementById(id);
    if (note) note.hidden = true;
  }

  // A failed or refused <script> or stylesheet fires `error` on the element, which does not
  // bubble: capture phase. Either one leaves the app unusable for good (without site.css the
  // react-native-web root has no height and the editor never lays out), so the note stays even
  // once the app draws. Any other error before the app has drawn means it has not started.
  window.addEventListener(
    'error',
    function (event) {
      const target = event.target;
      if (target && target !== window && target.tagName) {
        if (target.tagName === 'SCRIPT' || (target.tagName === 'LINK' && target.rel === 'stylesheet')) {
          failed = true;
          show('site-not-started');
        }
        return; // an image has its own handling in the app
      }
      if (!started) show('site-not-started');
    },
    true
  );

  function watch() {
    const root = document.getElementById('root');
    if (!root) return;
    const check = function () {
      if (root.firstElementChild) {
        started = true;
        if (!failed) hide('site-not-started');
        hide('site-stopped');
      } else if (started) {
        show('site-stopped');
      }
    };
    new MutationObserver(check).observe(root, { childList: true });
    check();
    // A bundle that loaded and ran without drawing anything (an engine too old to parse it
    // reports a SyntaxError above, but not every failure throws) is caught by a watchdog.
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (!started) show('site-not-started');
      }, 8000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
