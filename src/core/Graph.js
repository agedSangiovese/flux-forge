/**
 * The graph document.
 *
 * A graph is plain serialisable data:
 *
 *   nodes  [{ id, type, x, y, title, bypass, params: { key: value } }]
 *   links  [{ id, from, fromPort, to, toPort }]
 *   groups [{ id, title, note, color, x, y, w, h, collapsed }]
 *   view   { x, y, zoom }
 *   meta   { name, created, modified }
 *
 * The Graph is a dumb container with a change notification; all behaviour
 * (validation, evaluation, rendering) lives elsewhere.
 */

import { safeDef } from './registry.js';

let counter = 0;

export function uid(prefix = 'id') {
  counter = (counter + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(
    Math.random() * 0xffffff
  ).toString(36)}`;
}

export class Graph {
  constructor(data = null) {
    this.nodes = [];
    this.links = [];
    this.groups = [];
    this.view = { x: 0, y: 0, zoom: 1 };
    this.meta = { name: 'Untitled', created: Date.now(), modified: Date.now() };
    this._listeners = new Set();
    this.suspend = 0;
    if (data) this.fromJSON(data);
  }

  // ------------------------------------------------------------ events

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Notify listeners. Pass a reason string so views can react selectively. */
  changed(reason = 'edit') {
    this.meta.modified = Date.now();
    if (this.suspend) return;
    for (const fn of this._listeners) {
      try {
        fn(reason);
      } catch (err) {
        console.error('[graph] listener failed', err);
      }
    }
  }

  /** Run `fn` without emitting intermediate change events. */
  batch(fn) {
    this.suspend++;
    try {
      fn();
    } finally {
      this.suspend--;
    }
    this.changed('batch');
  }

  // ------------------------------------------------------------- nodes

  getNode(id) {
    return this.nodes.find((n) => n.id === id) || null;
  }

  hasNode(id) {
    return this.nodes.some((n) => n.id === id);
  }

  /**
   * @param {object} def     node definition from the registry
   * @param {number} x
   * @param {number} y
   * @param {object} params  initial parameter values (defaults are applied first)
   * @param {object} props   extra node fields, e.g. `{ id, title, bypass }`
   */
  addNode(def, x = 0, y = 0, params = {}, props = {}) {
    const node = {
      id: uid('n'),
      type: def.type,
      x: Math.round(x),
      y: Math.round(y),
      title: null,
      bypass: false,
      params: {},
      ...props,
    };
    // Params hold explicit overrides only — the manifest remains the single
    // source of truth for defaults, which the engine substitutes at eval time.
    // Keeping saved files free of duplicated defaults means an updated default
    // in a later version applies to old graphs too.
    for (const [key, value] of Object.entries(params || {})) {
      node.params[key] = structuredCloneSafe(value);
    }
    this.nodes.push(node);
    this.changed('add-node');
    return node;
  }

  removeNode(id, { cascade = true } = {}) {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    this.nodes.splice(idx, 1);
    if (cascade) {
      this.links = this.links.filter((l) => l.from !== id && l.to !== id);
    }
    for (const g of this.groups) g.nodes = (g.nodes || []).filter((n) => n !== id);
    this.changed('remove-node');
    return true;
  }

  setParam(id, key, value) {
    const node = this.getNode(id);
    if (!node) return;
    node.params[key] = value;
    this.changed('param');
  }

  // -------------------------------------------------------------- links

  getLink(id) {
    return this.links.find((l) => l.id === id) || null;
  }

  /** Links feeding a given input port, in insertion order. */
  incoming(nodeId, portKey) {
    return this.links.filter((l) => l.to === nodeId && l.toPort === portKey);
  }

  /** Links leaving a given output port. */
  outgoing(nodeId, portKey) {
    return this.links.filter((l) => l.from === nodeId && l.fromPort === portKey);
  }

  /** Every link touching a node. */
  linksOf(nodeId) {
    return this.links.filter((l) => l.from === nodeId || l.to === nodeId);
  }

  /**
   * True when adding `from -> to` would create a cycle.
   *
   * The new wire makes `to` depend on `from`, so it is a loop only if `from`
   * already depends on `to` — walk `from`'s inputs and look for `to`.
   */
  wouldLoop(fromId, toId) {
    if (fromId === toId) return true;
    const seen = new Set();
    const stack = [fromId];
    while (stack.length) {
      const id = stack.pop();
      if (id === toId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const l of this.links) if (l.to === id) stack.push(l.from);
    }
    return false;
  }

  /**
   * Connect two ports.
   * Single-input ports replace any existing wire; multi-input ports append.
   * Returns null when the connection is rejected (loop or duplicate).
   */
  connect(fromId, fromPort, toId, toPort, opts = {}) {
    if (!fromId || !toId) return null;
    if (this.wouldLoop(fromId, toId)) return null;

    const target = this.getNode(toId);
    let multi = opts.multi;
    if (multi === undefined && target) {
      const def = safeDef(target.type);
      const input = def.inputs.find((i) => i.key === toPort);
      multi = input ? !!input.multi : false;
    }

    if (!multi) {
      const existing = this.links.filter((l) => l.to === toId && l.toPort === toPort);
      for (const l of existing) this.links.splice(this.links.indexOf(l), 1);
    }
    // Avoid exact duplicates.
    if (this.links.some((l) => l.from === fromId && l.fromPort === fromPort && l.to === toId && l.toPort === toPort)) {
      return null;
    }
    const link = { id: uid('l'), from: fromId, fromPort, to: toId, toPort };
    this.links.push(link);
    this.changed('connect');
    return link;
  }

  disconnect(linkId) {
    const idx = this.links.findIndex((l) => l.id === linkId);
    if (idx < 0) return false;
    this.links.splice(idx, 1);
    this.changed('disconnect');
    return true;
  }

  /** Detach whatever is wired into a port. Returns the removed links. */
  clearInput(nodeId, portKey) {
    const removed = this.links.filter((l) => l.to === nodeId && l.toPort === portKey);
    if (!removed.length) return [];
    this.links = this.links.filter((l) => !(l.to === nodeId && l.toPort === portKey));
    this.changed('disconnect');
    return removed;
  }

  // ------------------------------------------------------------- groups

  groupOverlapping(nodeIds) {
    return this.groups.find((g) => (g.nodes || []).some((id) => nodeIds.includes(id)));
  }

  addGroup(nodeIds, title = 'Group', color = '#38bdf8') {
    // A node lives in exactly one group: strip the new members from any
    // group that previously held them, so ungrouping only removes this one.
    for (const other of this.groups) {
      if (!other.nodes) continue;
      other.nodes = other.nodes.filter((id) => !nodeIds.includes(id));
    }
    const g = {
      id: uid('g'),
      title,
      note: '',
      color,
      nodes: [...nodeIds],
      x: 0,
      y: 0,
      w: 240,
      h: 160,
      collapsed: false,
    };
    this.groups.push(g);
    this.fitGroup(g);
    this.changed('add-group');
    return g;
  }

  removeGroup(id) {
    const idx = this.groups.findIndex((g) => g.id === id);
    if (idx < 0) return false;
    this.groups.splice(idx, 1);
    this.changed('remove-group');
    return true;
  }

  /** Grow a group so it comfortably contains its member nodes. */
  fitGroup(group, pad = 28) {
    const members = (group.nodes || []).map((id) => this.getNode(id)).filter(Boolean);
    if (!members.length) {
      group.w = Math.max(180, group.w);
      group.h = Math.max(90, group.h);
      return group;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of members) {
      const w = n._w || 190;
      const h = n._h || 110;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y - 26);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }
    group.x = minX - pad;
    group.y = minY - pad - 18;
    group.w = maxX - minX + pad * 2;
    group.h = maxY - minY + pad * 2 + 18;
    return group;
  }

  /** Assign nodes to groups by containment; drop nodes that have left. */
  syncGroupMembership(nodeIds) {
    for (const g of this.groups) {
      g.nodes = (g.nodes || []).filter((id) => {
        const n = this.getNode(id);
        if (!n) return false;
        if (nodeIds.includes(id)) return true;
        return this.nodeInside(g, n);
      });
    }
    for (const id of nodeIds) {
      if (this.groups.some((g) => (g.nodes || []).includes(id))) continue;
      for (const g of this.groups) {
        const n = this.getNode(id);
        if (n && this.nodeInside(g, n)) {
          g.nodes.push(id);
          break;
        }
      }
    }
  }

  nodeInside(group, node) {
    const cx = node.x + (node._w || 190) / 2;
    const cy = node.y + (node._h || 110) / 2;
    return cx > group.x && cx < group.x + group.w && cy > group.y && cy < group.y + group.h;
  }

  // ------------------------------------------------------------ helpers

  /** Output-port type for a link, resolved against the source definition. */
  sourcePortType(link, safeDefFn) {
    const src = this.getNode(link.from);
    if (!src) return null;
    const def = safeDefFn(src.type);
    const out = (def.outputs || []).find((o) => o.key === link.fromPort);
    return out ? out.type : null;
  }

  /** Root node the Engine should evaluate (first sink in document order). */
  outputNode() {
    // A document renders 3D when it has a Render node, 2D when it only has a
    // Shader Canvas. Both at once is user error — Render wins, documented.
    return this.nodes.find((n) => n.type === 'output.render') || this.nodes.find((n) => n.type === 'output.shader') || null;
  }

  bounds() {
    if (!this.nodes.length) return { x: 0, y: 0, w: 800, h: 600 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n._w || 190));
      maxY = Math.max(maxY, n.y + (n._h || 110));
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // ------------------------------------------------------ serialisation

  toJSON() {
    return {
      version: 1,
      meta: { ...this.meta },
      view: { ...this.view },
      nodes: this.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        title: n.title ?? null,
        bypass: !!n.bypass,
        params: { ...n.params },
      })),
      links: this.links.map((l) => ({ ...l })),
      groups: this.groups.map((g) => ({ ...g, nodes: [...(g.nodes || [])] })),
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') throw new Error('Not a valid graph file');
    this.nodes = Array.isArray(data.nodes) ? data.nodes.map(normaliseNode) : [];
    this.links = Array.isArray(data.links) ? data.links.filter(validLink) : [];
    this.groups = Array.isArray(data.groups) ? data.groups.map(normaliseGroup) : [];
    // Drop wires that reference missing endpoints.
    const ids = new Set(this.nodes.map((n) => n.id));
    this.links = this.links.filter((l) => ids.has(l.from) && ids.has(l.to));
    for (const g of this.groups) g.nodes = (g.nodes || []).filter((id) => ids.has(id));
    this.view = { x: 0, y: 0, zoom: 1, ...(data.view || {}) };
    this.meta = {
      name: 'Untitled',
      created: Date.now(),
      modified: Date.now(),
      ...(data.meta || {}),
    };
    return this;
  }

  clone() {
    return new Graph(this.toJSON());
  }

  clear() {
    this.nodes = [];
    this.links = [];
    this.groups = [];
    this.changed('clear');
  }
}

function normaliseNode(n) {
  return {
    id: n.id || uid('n'),
    type: n.type,
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    title: n.title ?? null,
    bypass: !!n.bypass,
    params: n.params && typeof n.params === 'object' ? { ...n.params } : {},
  };
}

function normaliseGroup(g) {
  return {
    id: g.id || uid('g'),
    title: String(g.title || 'Group'),
    note: String(g.note || ''),
    color: g.color || '#38bdf8',
    nodes: Array.isArray(g.nodes) ? [...g.nodes] : [],
    x: Number(g.x) || 0,
    y: Number(g.y) || 0,
    w: Number(g.w) || 240,
    h: Number(g.h) || 160,
    collapsed: !!g.collapsed,
  };
}

function validLink(l) {
  return l && typeof l.from === 'string' && typeof l.to === 'string' && l.fromPort != null && l.toPort != null;
}

function structuredCloneSafe(v) {
  if (v === null || typeof v !== 'object') return v;
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}
