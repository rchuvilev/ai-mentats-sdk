/**
 * Tests for the modal.
 *
 * Five apps put their FAQ, tunnel and log panels behind this. The property
 * that matters is the borrowing: openModal MOVES the caller's node rather than
 * cloning it, so there is one copy of that markup instead of two that can
 * drift — which means closing has to put it back on every path, or the panel
 * is gone until the app restarts.
 *
 * Same approach as steps.test.js: a stub, not jsdom, because this package has
 * no dependencies.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

/* ── DOM stub ───────────────────────────────────────────────────────────── */

function makeNode(tag) {
  const listeners = {};
  const node = {
    tagName: tag,
    className: '',
    textContent: '',
    hidden: false,
    parentNode: null,
    focused: false,
    attrs: {},
    childNodes: [],
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; },
    replaceChild(nu, old) {
      const i = this.childNodes.indexOf(old);
      if (i < 0) return old;
      this.childNodes[i] = nu; nu.parentNode = this; old.parentNode = null; return old;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    contains(c) { return this.childNodes.includes(c); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    focus() { doc.activeElement = this; this.focused = true; },
    fire(ev, e = {}) { (listeners[ev] || []).forEach((f) => f({ target: this, stopPropagation() {}, ...e })); },
    /** Test-only: dispatch with an explicit event target. */
    fireWith(ev, e) { (listeners[ev] || []).forEach((f) => f({ stopPropagation() {}, ...e })); },
  };
  return node;
}

const docListeners = {};
const doc = {
  body: makeNode('body'),
  activeElement: null,
  createElement: makeNode,
  createComment: () => makeNode('#comment'),
  addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
  removeEventListener(ev, fn) {
    docListeners[ev] = (docListeners[ev] || []).filter((f) => f !== fn);
  },
  press(key) { (docListeners.keydown || []).slice().forEach((f) => f({ key, stopPropagation() {} })); },
};
global.document = doc;
global.window = {};
delete require.cache[require.resolve('./modal.js')];
require('./modal.js');
const { openModal, closeModal } = global.window.HexKit;

/** A panel living in the page, hidden, as the apps keep theirs. */
function homedContent() {
  const home = makeNode('div');
  const content = makeNode('section');
  content.hidden = true;
  home.appendChild(content);
  return { home, content };
}
const backdrop = () => doc.body.childNodes.find((n) => n.className === 'modal-back');

/* ── borrowing and returning ────────────────────────────────────────────── */

test('the content node is MOVED into the dialog, not copied', () => {
  const { home, content } = homedContent();
  openModal({ title: 'FAQ', content });
  assert.ok(!home.childNodes.includes(content), 'left its home');
  assert.strictEqual(content.hidden, false, 'and is visible');
  assert.ok(backdrop(), 'a backdrop is on screen');
  closeModal();
});

test('closing puts it back, hidden, where it came from', () => {
  const { home, content } = homedContent();
  openModal({ title: 'FAQ', content });
  closeModal();
  assert.ok(home.childNodes.includes(content), 'returned home');
  assert.strictEqual(content.hidden, true, 'hidden again');
  assert.strictEqual(backdrop(), undefined, 'backdrop gone');
});

test('the returned handle closes it too', () => {
  const { home, content } = homedContent();
  const h = openModal({ title: 'FAQ', content });
  h.close();
  assert.ok(home.childNodes.includes(content));
});

test('reopening after closing still works — the node is reusable', () => {
  const { home, content } = homedContent();
  openModal({ title: 'one', content });
  closeModal();
  openModal({ title: 'two', content });
  assert.ok(!home.childNodes.includes(content));
  closeModal();
  assert.ok(home.childNodes.includes(content));
});

/* ── ways it closes ─────────────────────────────────────────────────────── */

test('Escape closes it', () => {
  const { home, content } = homedContent();
  openModal({ title: 'FAQ', content });
  doc.press('Escape');
  assert.ok(home.childNodes.includes(content), 'Escape returned the content');
});

test('a key that is not Escape does nothing', () => {
  const { home, content } = homedContent();
  openModal({ title: 'FAQ', content });
  doc.press('a');
  assert.ok(!home.childNodes.includes(content), 'still open');
  closeModal();
});

test('clicking the backdrop closes, clicking the panel does not', () => {
  const { home, content } = homedContent();
  openModal({ title: 'FAQ', content });
  const back = backdrop();
  const panel = back.childNodes[0];

  back.fireWith('mousedown', { target: panel });
  assert.ok(!home.childNodes.includes(content), 'a click inside must not close it');

  back.fireWith('mousedown', { target: back });
  assert.ok(home.childNodes.includes(content), 'a click on the backdrop closes it');
});

test('the close button closes it', () => {
  const { home, content } = homedContent();
  openModal({ title: 'FAQ', content });
  const head = backdrop().childNodes[0].childNodes[0];
  head.childNodes[1].fire('click');
  assert.ok(home.childNodes.includes(content));
});

/* ── never two at once ──────────────────────────────────────────────────── */

test('opening a second dialog closes the first and returns its content', () => {
  const a = homedContent();
  const b = homedContent();
  openModal({ title: 'A', content: a.content });
  openModal({ title: 'B', content: b.content });

  assert.ok(a.home.childNodes.includes(a.content), 'the first one was put back');
  assert.ok(!b.home.childNodes.includes(b.content), 'the second is showing');
  assert.strictEqual(doc.body.childNodes.filter((n) => n.className === 'modal-back').length, 1);
  closeModal();
});

test('closing when nothing is open is harmless', () => {
  assert.doesNotThrow(() => { closeModal(); closeModal(); });
});

/* ── content and titles ─────────────────────────────────────────────────── */

test('the title is text, never parsed as markup', () => {
  const { content } = homedContent();
  openModal({ title: '<img onerror=alert(1)>', content });
  const title = backdrop().childNodes[0].childNodes[0].childNodes[0];
  assert.strictEqual(title.textContent, '<img onerror=alert(1)>');
  closeModal();
});

test('it refuses to open without content rather than showing an empty box', () => {
  assert.throws(() => openModal({ title: 'nothing' }), /no content/);
});

/* ── focus ──────────────────────────────────────────────────────────────── */

test('focus moves to the close button and returns to where it was', () => {
  const opener = makeNode('button');
  opener.focus();
  const { content } = homedContent();
  openModal({ title: 'FAQ', content });

  const closeBtn = backdrop().childNodes[0].childNodes[0].childNodes[1];
  assert.strictEqual(doc.activeElement, closeBtn, 'focus enters the dialog');

  closeModal();
  assert.strictEqual(doc.activeElement, opener, 'and comes back out');
});

/* ── the listener is not left behind ────────────────────────────────────── */

test('the keydown listener is removed on close', () => {
  const before = (docListeners.keydown || []).length;
  const { content } = homedContent();
  openModal({ title: 'FAQ', content });
  assert.strictEqual((docListeners.keydown || []).length, before + 1);
  closeModal();
  assert.strictEqual((docListeners.keydown || []).length, before,
    'a long-lived page would otherwise accumulate one per open');
});
