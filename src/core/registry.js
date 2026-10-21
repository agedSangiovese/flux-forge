/**
 * Node definition registry.
 *
 * A node definition ("def") is a plain object:
 *
 *   {
 *     type: 'shape.sphere',       // unique id, `<family>.<name>`
 *     label: 'Sphere',
 *     category: 'shape',          // see manifest.js for the list
 *     desc: '…',                  // one-line help, shown in search + palette
 *     inputs: [{ key, label, type, widget?, options?, min?, max?, step?, default?, multi?, hidden? }],
 *     outputs: [{ key, label, type }],
 *     isOutput?: boolean,         // graph sinks; the Engine evaluates the first one
 *     dynamic?: boolean,          // depends on time -> re-evaluates every frame
 *     bypassInput?: 'geometry',   // which input to route straight through when bypassed
 *     eval(ctx, inputs) -> { portKey: value }
 *   }
 *
 * `inputs` doubles as the parameter list: any input with a `widget` shows an
 * inline control on the node *and* a wireable port, so every knob can be
 * driven procedurally.
 */

const defs = new Map();

const WARNED = new Set();

function warn(msg) {
  if (WARNED.has(msg)) return;
  WARNED.add(msg);
  console.warn(`[nodes] ${msg}`);
}

export function register(def) {
  if (!def || !def.type) {
    warn('skipping a definition without a `type`');
    return;
  }
  if (defs.has(def.type)) warn(`duplicate node type "${def.type}" — the later one wins`);
  if (!Array.isArray(def.inputs)) def.inputs = [];
  if (!Array.isArray(def.outputs)) def.outputs = [];
  if (typeof def.eval !== 'function') def.eval = () => ({});
  if (!def.label) def.label = def.type;
  if (!def.category) def.category = 'other';
  defs.set(def.type, def);
}

export function registerAll(list) {
  for (const def of list) register(def);
}

export function getDef(type) {
  return defs.get(type) || null;
}

export function hasDef(type) {
  return defs.has(type);
}

export function allDefs() {
  return [...defs.values()];
}

export function inputKeys(type) {
  const d = defs.get(type);
  return d ? d.inputs.map((i) => i.key) : [];
}

/** Group definitions by category, keeping manifest order within each group. */
export function byCategory() {
  const map = new Map();
  for (const def of defs.values()) {
    if (!map.has(def.category)) map.set(def.category, []);
    map.get(def.category).push(def);
  }
  return map;
}

export function categories() {
  return [...byCategory().keys()];
}

/** Definition lookup that never throws, for rendering stale graphs. */
export function safeDef(type) {
  return (
    defs.get(type) || {
      type,
      label: type,
      category: 'other',
      desc: 'This node type is not installed.',
      missing: true,
      inputs: [],
      outputs: [],
      eval: () => ({}),
    }
  );
}
