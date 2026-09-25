/**
 * Modal dialog.
 *
 * Exists so that reference material — an FAQ, a paths list, a log — can be
 * reachable from anywhere without costing a tab. A tab for the FAQ implies the
 * FAQ is a step in the flow; it is not, it is something you glance at and
 * dismiss. A header icon plus this modal says that correctly and gives the
 * sequential part of the UI the whole screen.
 *
 * Content is passed as an ELEMENT, not a string, so nothing here ever parses
 * HTML at runtime. Callers keep their markup in app.html (where their CSP can
 * see it) and hand over the node.
 *
 * Loaded as a plain <script> from app.html and exposed on window.HexKit.
 */
(function () {
  'use strict';

  var K = (window.HexKit = window.HexKit || {});
  var openEl = null;      // the backdrop currently on screen
  var lastFocus = null;

  function close() {
    if (!openEl) return;
    openEl.remove();
    openEl = null;
    document.removeEventListener('keydown', onKey, true);
    // Put focus back where the user left it, or the dialog swallows the
    // keyboard trail and a screen reader lands at the top of the document.
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {HTMLElement} opts.content  node to show; it is MOVED, then put back
   * @returns {{close: () => void}}
   */
  K.openModal = function openModal(opts) {
    close();                                   // never stack two dialogs
    var title = (opts && opts.title) || '';
    var content = opts && opts.content;
    if (!content) throw new Error('openModal: no content element');

    lastFocus = document.activeElement;

    // The content node usually lives in app.html inside a hidden holder. Move
    // it in, and move it back on close, so the caller keeps one copy of its
    // markup instead of a template plus a clone that can drift.
    var home = content.parentNode;
    var marker = document.createComment('modal-content');
    if (home) home.replaceChild(marker, content);

    var back = document.createElement('div');
    back.className = 'modal-back';
    back.addEventListener('mousedown', function (e) {
      if (e.target === back) close();          // backdrop only, not the panel
    });

    var panel = document.createElement('div');
    panel.className = 'modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    var head = document.createElement('div');
    head.className = 'modal__head';
    var h = document.createElement('h3');
    h.className = 'modal__title';
    h.textContent = title;                     // text, never parsed as markup
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'modal__close';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.addEventListener('click', close);
    head.appendChild(h);
    head.appendChild(x);

    var bodyWrap = document.createElement('div');
    bodyWrap.className = 'modal__body';
    content.hidden = false;
    bodyWrap.appendChild(content);

    panel.appendChild(head);
    panel.appendChild(bodyWrap);
    back.appendChild(panel);
    document.body.appendChild(back);
    openEl = back;

    var restore = function () {
      if (home && marker.parentNode) {
        content.hidden = true;
        home.replaceChild(content, marker);
      }
    };
    // Restoring has to happen on every close path, not just the × button.
    var origClose = close;
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('DOMNodeRemovedFromDocument', restore);
    var observer = new MutationObserver(function () {
      if (!document.body.contains(back)) { restore(); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true });

    x.focus();
    return { close: origClose };
  };

  K.closeModal = close;
})();
