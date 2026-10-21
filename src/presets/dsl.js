/**
 * Tiny DSL for authoring preset graphs by hand.
 *
 * Writing raw `{ id, type, x, y, params }` documents is unreadable, so presets
 * use index-based tuples instead:
 *
 *   makeGraph({
 *     name: 'Ripple sphere',
 *     nodes: [
 *       ['shape.sphere',   0,    0,   { radius: 1.4 }],
 *       ['field.noise',  -360,   40,  { scale: 1.1, seed: 4 }],
 *       ['geo.displace',  240,   20,  { amount: 0.35 }],
 *       ['output.render', 560,   40 ],
 *     ],
 *     links: [
 *       [0, 'out', 2, 'geometry'],
 *       [1, 'out', 2, 'amount'],
 *       [2, 'out', 3, 'geometry'],
 *     ],
 *     groups: [
 *       { title: 'Sculpt', color: '#8b5cf6', note: '', nodes: [1, 2] },
 *     ],
 *   });
 *
 * `nodes` entries are `[type, x, y, params?, title?]`; `links` are
 * `[fromIndex, fromPort, toIndex, toPort]`. Params left out fall back to the
 * manifest defaults at evaluation time, so only override what matters.
 */

let seq = 0;

const NODE_W = 214;
const ROW_H = 27;
const HEAD_H = 34;
const PAD_X = 26;
const PAD_Y = 46;

function estimatedHeight(def) {
  const rows = Math.max(def.inputs?.length || 0, def.outputs?.length || 0);
  return HEAD_H + rows * ROW_H + 14;
}

export function makeGraph({ name = 'Preset', nodes = [], links = [], groups = [], view = null, defs = null } = {}) {
  const idFor = (i) => `pn${seq}_${i}_${Math.random().toString(36).slice(2, 7)}`;
  const local = nodes.map((entry, i) => {
    const [type, x, y, params = {}, title = null] = entry;
    return { id: idFor(i), type, x: Math.round(x), y: Math.round(y), title, bypass: false, params };
  });

  const doc = {
    version: 1,
    meta: { name, created: 0, modified: 0 },
    view: view || { x: 0, y: 0, zoom: 1 },
    nodes: local,
    links: links.map(([from, fromPort, to, toPort], i) => ({
      id: `pl${seq}_${i}`,
      from: local[from].id,
      fromPort,
      to: local[to].id,
      toPort,
    })),
    groups: [],
  };

  for (const [gi, g] of groups.entries()) {
    const members = (g.nodes || []).map((i) => local[i]).filter(Boolean);
    if (!members.length) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      const def = defs ? defs(m.type) : null;
      const h = def ? estimatedHeight(def) : 150;
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + NODE_W);
      maxY = Math.max(maxY, m.y + h);
    }

    doc.groups.push({
      id: `pg${seq}_${gi}`,
      title: g.title || 'Group',
      note: g.note || '',
      color: g.color || '#38bdf8',
      nodes: members.map((m) => m.id),
      x: minX - PAD_X,
      y: minY - PAD_Y,
      w: maxX - minX + PAD_X * 2,
      h: maxY - minY + PAD_Y * 2,
      collapsed: false,
    });
  }

  return doc;
}
