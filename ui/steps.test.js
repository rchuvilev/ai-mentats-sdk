/**
 * Tests for the step accordion.
 *
 * Five apps now drive their whole first-run flow through this, so the rules it
 * enforces — exactly one section open, a step you cannot reach yet is inert,
 * finishing one opens the next — are load-bearing in all of them.
 *
 * It renders DOM, and this package has no dependencies and is not about to
 * gain jsdom for a test. steps.js was therefore built to need only the handful
 * of DOM methods stubbed below: it creates nodes one at a time and never
 * touches innerHTML or querySelector, so there is no HTML parser to fake.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

/* ── the smallest DOM that steps.js can run against ─────────────────────── */

function makeNode(tag) {
  const listeners = {};
  const node = {
    tagName: tag,
    className: '',
    textContent: '',
    dataset: {},
    hidden: false,
    disabled: false,
    attrs: {},
    childNodes: [],
    get firstChild() { return this.childNodes[0] || null; },
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; },
    appendChild(c) { this.childNodes.push(c); return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    /** Test-only: what a user click does, including the disabled check. */
    click() { if (!this.disabled) (listeners.click || []).forEach((f) => f()); },
    classList: {
      toggle(cls, on) {
        const set = new Set(node.className.split(' ').filter(Boolean));
        on ? set.add(cls) : set.delete(cls);
        node.className = [...set].join(' ');
      },
      add(cls) { this.toggle(cls, true); },
      contains(cls) { return node.className.split(' ').includes(cls); },
    },
  };
  return node;
}

global.document = { createElement: makeNode };
global.window = {};
delete require.cache[require.resolve('./steps.js')];
require('./steps.js');
const { createSteps } = global.window.HexKit;

const STEPS = [
  { id: 'a', title: 'First', hint: 'do this' },
  { id: 'b', title: 'Second' },
  { id: 'c', title: 'Third' },
];
const mount = (steps = STEPS, opts = {}) => {
  const root = makeNode('div');
  return { root, api: createSteps(root, { steps, ...opts }) };
};
const openIds = (root) => root.childNodes.filter((n) => n.classList.contains('is-open'))
  .map((n) => n.dataset.step);
const item = (root, id) => root.childNodes.find((n) => n.dataset.step === id);
const head = (root, id) => item(root, id).childNodes[0];

/* ── structure ──────────────────────────────────────────────────────────── */

test('renders one section per step, in order, numbered from 1', () => {
  const { root } = mount();
  assert.strictEqual(root.childNodes.length, 3);
  assert.deepStrictEqual(root.childNodes.map((n) => n.dataset.step), ['a', 'b', 'c']);
  assert.strictEqual(head(root, 'a').childNodes[0].textContent, '1');
  assert.strictEqual(head(root, 'c').childNodes[0].textContent, '3');
});

test('titles and hints are text, never parsed as markup', () => {
  const { root } = mount([{ id: 'x', title: '<img onerror=alert(1)>', hint: '</span><b>' }]);
  const label = head(root, 'x').childNodes[1];
  assert.strictEqual(label.childNodes[0].textContent, '<img onerror=alert(1)>');
  assert.strictEqual(label.childNodes[1].textContent, '</span><b>');
});

test('a step with no hint renders no hint node', () => {
  const { root } = mount();
  assert.strictEqual(head(root, 'a').childNodes[1].childNodes.length, 2, 'title + hint');
  assert.strictEqual(head(root, 'b').childNodes[1].childNodes.length, 1, 'title only');
});

test('refuses to build without a root or without steps', () => {
  assert.throws(() => createSteps(null, { steps: STEPS }), /no root/);
  assert.throws(() => createSteps(makeNode('div'), { steps: [] }), /no steps/);
});

/* ── exactly one open ───────────────────────────────────────────────────── */

test('nothing is open until something opens it', () => {
  const { root } = mount();
  assert.deepStrictEqual(openIds(root), []);
});

test('opening one closes the others — always exactly one', () => {
  const { root, api } = mount();
  api.open('a');
  assert.deepStrictEqual(openIds(root), ['a']);
  api.open('c');
  assert.deepStrictEqual(openIds(root), ['c'], 'a must have closed');
});

test('an open section shows its body; the rest hide theirs', () => {
  const { root, api } = mount();
  api.open('b');
  assert.strictEqual(item(root, 'b').childNodes[1].hidden, false);
  assert.strictEqual(item(root, 'a').childNodes[1].hidden, true);
});

/* ── reachability ───────────────────────────────────────────────────────── */

test('a step that is not its turn yet is inert', () => {
  const { root, api } = mount();
  api.open('a');
  assert.strictEqual(head(root, 'c').disabled, true, 'c is still todo');
  head(root, 'c').click();
  assert.deepStrictEqual(openIds(root), ['a'], 'clicking an inert head does nothing');
});

test('a finished step can be reopened — people do go back', () => {
  const { root, api } = mount();
  api.complete('a');
  assert.deepStrictEqual(openIds(root), ['b']);
  assert.strictEqual(head(root, 'a').disabled, false);
  head(root, 'a').click();
  assert.deepStrictEqual(openIds(root), ['a']);
});

/* ── advancing ──────────────────────────────────────────────────────────── */

test('completing a step collapses it and opens the next unfinished one', () => {
  const { root, api } = mount();
  api.open('a');
  const next = api.complete('a');
  assert.strictEqual(next, 'b');
  assert.deepStrictEqual(openIds(root), ['b']);
  assert.ok(item(root, 'a').classList.contains('is-done'));
});

test('completing the last one leaves nothing open rather than reopening', () => {
  const { root, api } = mount();
  api.complete('a'); api.complete('b');
  const next = api.complete('c');
  assert.strictEqual(next, null);
  assert.deepStrictEqual(openIds(root), []);
});

test('complete() skips steps already done', () => {
  const { api } = mount();
  api.setState('b', 'done');
  assert.strictEqual(api.complete('a'), 'c', 'b is done, so c is next');
});

test('resume() opens the first unfinished step', () => {
  const { root, api } = mount();
  api.setState('a', 'done');
  api.setState('b', 'done');
  assert.strictEqual(api.resume(), 'c');
  assert.deepStrictEqual(openIds(root), ['c']);
});

/* ── state ──────────────────────────────────────────────────────────────── */

test("setting a step active opens it — one fact, not two", () => {
  const { root, api } = mount();
  api.open('a');
  api.setState('c', 'active');
  assert.deepStrictEqual(openIds(root), ['c']);
});

test('marking a step done does NOT move what is open', () => {
  // n8n depends on this: its first step CONTAINS the product, so finishing it
  // must not collapse it.
  const { root, api } = mount();
  api.open('a');
  api.setState('a', 'done');
  assert.deepStrictEqual(openIds(root), ['a'], 'the open step stays open when it finishes');
  assert.strictEqual(api.state('a'), 'done');

  // And a DIFFERENT step finishing must not steal the screen either — this is
  // the case that distinguishes 'done does not open' from 'done opens'.
  api.setState('c', 'done');
  assert.deepStrictEqual(openIds(root), ['a'], 'finishing c must not open c');
});

test('busy is a state of its own, not a synonym for todo', () => {
  const { root, api } = mount();
  api.setState('a', 'busy');
  assert.ok(item(root, 'a').classList.contains('is-busy'));
  assert.strictEqual(head(root, 'a').disabled, true, 'busy is not clickable');
});

test('an unknown id is ignored rather than throwing', () => {
  const { api } = mount();
  assert.doesNotThrow(() => { api.open('nope'); api.setState('nope', 'done'); api.setNote('nope', 'x'); });
  assert.strictEqual(api.complete('nope'), undefined);
});

/* ── notes ──────────────────────────────────────────────────────────────── */

test('a note is shown and kept in full on the title, because it truncates', () => {
  const { root, api } = mount();
  const long = 'Missing: a, b, c, d, e, f, g, h';
  api.setNote('a', long);
  const note = head(root, 'a').childNodes[2];
  assert.strictEqual(note.textContent, long);
  assert.strictEqual(note.title, long, 'full text stays reachable on hover');
});

test('clearing a note empties it rather than printing undefined', () => {
  const { root, api } = mount();
  api.setNote('a', 'x');
  api.setNote('a');
  assert.strictEqual(head(root, 'a').childNodes[2].textContent, '');
});

/* ── bodies ─────────────────────────────────────────────────────────────── */

test('body() returns the same node every time, so callers can append once', () => {
  const { api } = mount();
  const b = api.body('a');
  assert.strictEqual(api.body('a'), b);
  const child = makeNode('div');
  b.appendChild(child);
  assert.strictEqual(api.body('a').childNodes[0], child);
});

test('rebuilding on the same root does not stack old sections', () => {
  const root = makeNode('div');
  createSteps(root, { steps: STEPS });
  createSteps(root, { steps: [{ id: 'z', title: 'Only' }] });
  assert.strictEqual(root.childNodes.length, 1);
  assert.strictEqual(root.childNodes[0].dataset.step, 'z');
});

/* ── onOpen ─────────────────────────────────────────────────────────────── */

test('onOpen reports which section became open', () => {
  const seen = [];
  const { api } = mount(STEPS, { onOpen: (id) => seen.push(id) });
  api.open('a');
  api.complete('a');
  assert.deepStrictEqual(seen, ['a', 'b']);
});
