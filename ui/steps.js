/**
 * Single-screen step accordion.
 *
 * Replaces a tab bar for flows that are actually SEQUENTIAL. Tabs imply the
 * sections are peers you may visit in any order; a first-run setup is not that
 * — step 2 is meaningless before step 1 succeeds, and a tab bar happily lets
 * you open it anyway and find an empty or failing panel. The accordion states
 * the order in the layout itself.
 *
 * Rules, deliberately few:
 *  - exactly one section is open, always;
 *  - which one is DERIVED from the active step, not from clicks alone, so the
 *    UI cannot disagree with the flow;
 *  - completing a step collapses it and opens the next unfinished one, so the
 *    user is never asked "what now?";
 *  - a finished step can be reopened by clicking it (people do want to go
 *    back), but an unreachable one cannot — it is inert until its turn.
 *
 * Loaded as a plain <script> from app.html, like sdk/ui/update-bar.js, and
 * exposed on window.HexKit so a renderer with a strict CSP needs no inline
 * script to use it.
 */
(function () {
  'use strict';

  var K = (window.HexKit = window.HexKit || {});

  /**
   * @param {HTMLElement} root   container the steps are rendered into
   * @param {object}      opts
   * @param {Array<{id:string,title:string,hint?:string}>} opts.steps
   * @param {(id:string)=>void} [opts.onOpen] fired when a section becomes open
   * @returns {object} controller
   */
  K.createSteps = function createSteps(root, opts) {
    if (!root) throw new Error('createSteps: no root element');
    var defs = (opts && opts.steps) || [];
    if (!defs.length) throw new Error('createSteps: no steps');
    var onOpen = (opts && opts.onOpen) || function () {};

    var items = {};      // id -> { def, el, head, body, state }
    var order = [];      // ids, in declaration order
    var openId = null;

    root.classList.add('steps');
    root.innerHTML = '';

    defs.forEach(function (def, i) {
      var el = document.createElement('section');
      el.className = 'steps__item';
      el.dataset.step = def.id;

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'steps__head';
      // A disabled button is skipped by the tab order, which is right: a step
      // that cannot be opened yet should not be a keyboard stop either.
      head.setAttribute('aria-expanded', 'false');
      // Static skeleton only — the sole interpolation is the loop index. Every
      // caller-supplied string (title, hint, and later setNote) goes in through
      // textContent below, so a step titled `<img onerror=...>` is inert text.
      head.innerHTML =
        '<span class="steps__num">' + (i + 1) + '</span>' +
        '<span class="steps__label">' +
          '<span class="steps__title"></span>' +
          (def.hint ? '<span class="steps__hint"></span>' : '') +
        '</span>' +
        '<span class="steps__state"></span>';
      head.querySelector('.steps__title').textContent = def.title;
      if (def.hint) head.querySelector('.steps__hint').textContent = def.hint;

      var body = document.createElement('div');
      body.className = 'steps__body';

      head.addEventListener('click', function () {
        // Only a finished or already-active step is clickable. Anything else
        // is not yet meaningful, and opening it would show a dead panel.
        var st = items[def.id].state;
        if (st === 'done' || st === 'active') api.open(def.id);
      });

      el.appendChild(head);
      el.appendChild(body);
      root.appendChild(el);

      items[def.id] = { def: def, el: el, head: head, body: body, state: 'todo' };
      order.push(def.id);
    });

    function render() {
      order.forEach(function (id) {
        var it = items[id];
        var open = id === openId;
        it.el.classList.toggle('is-open', open);
        it.el.classList.toggle('is-done', it.state === 'done');
        it.el.classList.toggle('is-busy', it.state === 'busy');
        it.el.classList.toggle('is-todo', it.state === 'todo');
        it.head.setAttribute('aria-expanded', open ? 'true' : 'false');
        it.head.disabled = !(it.state === 'done' || it.state === 'active');
        it.body.hidden = !open;
      });
    }

    var api = {
      /** The element a caller renders this step's content into. */
      body: function (id) { return items[id].body; },

      /** Open one section; everything else closes. */
      open: function (id) {
        if (!items[id]) return;
        openId = id;
        if (items[id].state === 'todo') items[id].state = 'active';
        render();
        onOpen(id);
      },

      /**
       * 'todo' | 'active' | 'busy' | 'done'. Setting a step active opens it,
       * because "which step is active" and "which section is open" are the
       * same fact — keeping them as two facts is how they drift apart.
       */
      setState: function (id, state) {
        if (!items[id]) return;
        items[id].state = state;
        if (state === 'active') return api.open(id);
        render();
      },

      state: function (id) { return items[id] && items[id].state; },

      /** Mark done and advance to the first unfinished step. */
      complete: function (id) {
        if (!items[id]) return;
        items[id].state = 'done';
        var next = order.find(function (x) { return items[x].state !== 'done'; });
        if (next) api.open(next);
        else render();          // everything done: collapse, open nothing
        return next || null;
      },

      /** Open the first unfinished step. Used on load, once state is known. */
      resume: function () {
        var next = order.find(function (x) { return items[x].state !== 'done'; });
        if (next) api.open(next); else render();
        return next || null;
      },

      /** Status text on the right of a header (e.g. "Running", "2.4 GB"). */
      setNote: function (id, text) {
        if (!items[id]) return;
        var el = items[id].head.querySelector('.steps__state');
        el.textContent = text || '';
        // The note truncates, so the full text has to stay reachable.
        el.title = text || '';
      },
    };

    render();
    return api;
  };
})();
