/**
 * Snapshot-based undo / redo.
 *
 * Graphs are small JSON documents, so the simplest correct history is to store
 * serialised snapshots and restore them wholesale. Coalescing collapses bursts
 * of related edits (dragging a slider, moving a node) into a single step.
 */

const LIMIT = 120;

export class History {
  constructor(graph, { coalesceMs = 420, limit = LIMIT } = {}) {
    this.graph = graph;
    this.limit = limit;
    this.coalesceMs = coalesceMs;
    this.past = [];
    this.future = [];
    this.lastPush = 0;
    // `null` until something is recorded: the very first push must always
    // capture the state we can fall back to.
    this.lastSignature = null;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Notify listeners with a reason:
   *   'push'    — an ordinary edit recorded a new undo point
   *   'restore' — undo/redo replaced the document wholesale
   *   'clear'   — the history stack was reset (new document)
   * Listeners that only refresh chrome should run for every reason; a full
   * editor rebuild belongs to 'restore' alone (see main.js).
   */
  #emit(reason) {
    for (const fn of this.listeners) fn(this, reason);
  }

  #signature() {
    try {
      const doc = this.graph.toJSON();
      return JSON.stringify([doc.nodes, doc.links, doc.groups]);
    } catch {
      return String(Date.now());
    }
  }

  /**
   * Record the current state as an undo point.
   * @param {string} label   what changed, e.g. 'drag' or 'param'
   * @param {boolean} coalesce merge with the previous point when called in a burst
   */
  push(label = 'edit', coalesce = false) {
    const sig = this.#signature();
    if (sig === this.lastSignature) return false;

    const now = Date.now();
    if (coalesce && this.past.length && now - this.lastPush < this.coalesceMs) {
      // The top of the stack already holds the state from before this burst,
      // so there is nothing new to record — only the window keeps sliding.
      this.lastPush = now;
      this.future = [];
      this.#emit('push');
      return true;
    }

    this.past.push({ label, signature: sig, state: JSON.parse(JSON.stringify(this.graph.toJSON())) });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastPush = now;
    this.lastSignature = sig;
    this.#emit('push');
    return true;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    if (!this.past.length) return false;
    const entry = this.past.pop();
    const current = JSON.parse(JSON.stringify(this.graph.toJSON()));
    this.future.push({ label: entry.label, state: current });
    this.#restore(entry.state);
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    const entry = this.future.pop();
    const current = JSON.parse(JSON.stringify(this.graph.toJSON()));
    this.past.push({ label: entry.label, state: current });
    this.#restore(entry.state);
    return true;
  }

  #restore(state) {
    const view = { ...this.graph.view };
    this.graph.suspend++;
    try {
      this.graph.fromJSON(state);
      this.graph.view = view; // pan/zoom is not part of history
    } finally {
      this.graph.suspend--;
    }
    // Force the next edit to record a fresh undo point.
    this.lastSignature = null;
    this.lastPush = 0;
    this.graph.changed('history');
    this.#emit('restore');
  }

  clear() {
    this.past = [];
    this.future = [];
    // The document is new — the next edit must record its own undo point.
    this.lastSignature = null;
    this.lastPush = 0;
    this.#emit('clear');
  }

  /** Human readable label of the next undo, for tooltips. */
  peekUndo() {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }
}
