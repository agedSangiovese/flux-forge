/**
 * Flux Forge — node editor.
 *
 *   import { createEditor } from './editor/index.js';
 *   const editor = createEditor({ viewport, world, wireLayer, …, graph, history });
 *
 * Owns the canvas: pan/zoom, node + group dragging, wire routing, selection,
 * the context menus, the node search, the palette, the inspector, the minimap
 * and the marquee. The document model (`core/Graph.js`) is never mutated
 * without an `onEdit()` snapshot first, so undo/redo always lines up.
 */

import { safeDef } from '../core/registry.js';
import { CATEGORIES, catalogue } from '../core/manifest.js';
import { accepts, portColor, portLabel } from '../core/portTypes.js';
import { uid } from '../core/Graph.js';
import { el, clamp, bind, isTyping, reducedMotion } from './util.js';
import { createMenu } from './menu.js';
import { createNodes, NOTE_TYPE } from './nodes.js';
import { createGroups } from './groups.js';
import { createWires } from './wires.js';
import { createSearch } from './search.js';
import { createInspector } from './inspector.js';
import { createMinimap } from './minimap.js';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const FRAME_PAD = 60;
const GROUP_COLOURS = [
  '#38bdf8', '#a78bfa', '#fb7185', '#f0b429', '#34d399',
  '#fb923c', '#f43f5e', '#94a3b8', '#22d3ee', '#fbbf24',
];

export function createEditor(options) {
  const o = options;
  const graph = o.graph;
  const toast = o.toast || (() => {});
  const cleanups = [];

  const selection = new Set();
  const wireSelection = new Set();
  const portIndex = new Map(); // `${nodeId}|${dir}|${key}` -> element
  const collapsedMemory = new Map();

  const els = {
    viewport: o.viewport,
    world: o.world,
    wireLayer: o.wireLayer,
    minimapCanvas: o.minimapCanvas,
    marquee: o.marquee,
    emptyState: o.emptyState,
    inspectorBody: o.inspectorBody,
    ctxMenu: o.ctxMenu,
    searchModal: o.searchModal,
    searchInput: o.searchInput,
    searchResults: o.searchResults,
    paletteInput: o.paletteInput,
    paletteList: o.paletteList,
  };

  let destroyed = false;
  let lastZoom = graph.view.zoom;
  let frameQueued = false;
  let viewAnim = null;
  let viewPersistTimer = 0;
  let spaceHeld = false;

  // ------------------------------------------------------------------ ctx

  const ctx = {
    els,
    ...els, // ctx.viewport, ctx.world, … — what the sub-modules reach for
    graph,
    toast,
    selection,
    wireSelection,
    portIndex,
    edit(label, coalesce) {
      try {
        if (o.onEdit) o.onEdit(label, !!coalesce);
      } catch (err) {
        console.error('[editor] onEdit failed', err);
      }
      // The caller mutates the graph right after this returns. Edits no
      // longer trigger a full sync, so schedule the layout-sensitive layers
      // (wires, minimap) to redraw once the mutation has landed.
      minimap.markDirty();
      requestFrame();
    },
    requestFrame,
    fitGroups,
    screenToWorld,
    worldToScreen,
    setView,
    startNodeDrag,
    startGroupDrag,
    setParam,
    setBypass,
    connectPorts,
    restoreLink,
    wiresChanged,
    disconnectInput,
    openInsertSearch,
    completeInsert,
    cancelInsert,
    addNodeAt,
    addNodeCentered,
    toast,
    refreshInspector: () => inspector.render(),
    rememberCollapse(id, value) {
      collapsedMemory.set(id, value);
    },
    catalogueGroups: () => catalogue(),
  };

  ctx.menu = createMenu(ctx);
  ctx.nodes = createNodes(ctx);
  ctx.groups = createGroups(ctx);
  ctx.wires = createWires(ctx);
  ctx.inspector = createInspector(ctx);
  ctx.minimap = createMinimap(ctx);
  ctx.search = createSearch(ctx);

  const { nodes, groups, wires, inspector, minimap, search, menu } = ctx;

  // ------------------------------------------------------------- helpers

  function screenToWorld(clientX, clientY) {
    const r = els.viewport.getBoundingClientRect();
    const v = graph.view;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }

  function worldToScreen(x, y) {
    const r = els.viewport.getBoundingClientRect();
    const v = graph.view;
    return { x: x * v.zoom + v.x + r.left, y: y * v.zoom + v.y + r.top };
  }

  function applyView() {
    const v = graph.view;
    els.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    if (v.zoom !== lastZoom) {
      lastZoom = v.zoom;
      if (o.onZoom) o.onZoom(v.zoom);
    }
  }

  function setView(next) {
    const v = graph.view;
    if (next.x !== undefined) v.x = next.x;
    if (next.y !== undefined) v.y = next.y;
    if (next.zoom !== undefined && next.zoom !== v.zoom) {
      v.zoom = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    }
    applyView();
    scheduleViewPersist();
    requestFrame();
    minimap.markDirty();
  }

  /** Pan/zoom is not part of the document, but it is worth autosaving. */
  function scheduleViewPersist() {
    clearTimeout(viewPersistTimer);
    viewPersistTimer = setTimeout(() => {
      if (destroyed) return;
      graph.changed('view');
    }, 900);
  }

  function requestFrame() {
    if (destroyed || frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      if (destroyed) return;
      wires.draw();
      minimap.draw();
    });
  }

  function fitGroups() {
    for (const g of graph.groups) {
      graph.fitGroup(g);
      groups.updateGeom(g);
    }
  }

  function updateEmptyState() {
    if (els.emptyState) els.emptyState.classList.toggle('hidden', graph.nodes.length > 0);
  }

  // ------------------------------------------------------------ selection

  function applySelection() {
    nodes.updateSelection();
    groups.updateSelection();
    wires.applySelection();
    inspector.render();
    if (o.onSelectionChange) o.onSelectionChange([...selection]);
  }

  function setSelection(ids) {
    selection.clear();
    for (const id of ids) if (graph.hasNode(id)) selection.add(id);
    applySelection();
  }

  function selectOnly(id) {
    setSelection([id]);
  }

  function toggleNodeSelection(id) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    applySelection();
  }

  function clearSelection() {
    if (!selection.size && !wireSelection.size) return;
    selection.clear();
    wires.clearSelection();
    applySelection();
  }

  function selectAll() {
    setSelection(graph.nodes.map((n) => n.id));
  }

  function getSelection() {
    return [...selection];
  }

  function selectWire(linkId, additive) {
    if (additive) {
      if (wireSelection.has(linkId)) wireSelection.delete(linkId);
      else wireSelection.add(linkId);
    } else {
      wireSelection.clear();
      wireSelection.add(linkId);
      selection.clear();
      applySelection();
    }
    wires.applySelection();
  }

  // ------------------------------------------------------------------ view

  function cancelViewAnim() {
    if (viewAnim) {
      cancelAnimationFrame(viewAnim);
      viewAnim = null;
    }
  }

  function animateView(target) {
    cancelViewAnim();
    const from = { ...graph.view };
    const to = {
      x: target.x,
      y: target.y,
      zoom: clamp(target.zoom, MIN_ZOOM, MAX_ZOOM),
    };
    if (reducedMotion()) {
      setView(to);
      return;
    }
    const t0 = performance.now();
    const dur = 380;
    const tick = (now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setView({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      });
      viewAnim = k < 1 ? requestAnimationFrame(tick) : null;
    };
    viewAnim = requestAnimationFrame(tick);
  }

  function frameAll() {
    cancelViewAnim();
    const b = graph.bounds();
    const r = els.viewport.getBoundingClientRect();
    const w = Math.max(1, b.w);
    const h = Math.max(1, b.h);
    const zoom = clamp(
      Math.min((r.width - FRAME_PAD * 2) / w, (r.height - FRAME_PAD * 2) / h),
      MIN_ZOOM,
      MAX_ZOOM
    );
    animateView({
      zoom,
      x: r.width / 2 - (b.x + b.w / 2) * zoom,
      y: r.height / 2 - (b.y + b.h / 2) * zoom,
    });
  }

  function onWheel(e) {
    e.preventDefault();
    cancelViewAnim();
    const v = graph.view;
    const r = els.viewport.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const wx = (px - v.x) / v.zoom;
    const wy = (py - v.y) / v.zoom;
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 18;
    else if (e.deltaMode === 2) delta *= 120;
    const zoom = clamp(v.zoom * Math.exp(-delta * 0.0016), MIN_ZOOM, MAX_ZOOM);
    setView({ x: px - wx * zoom, y: py - wy * zoom, zoom });
  }

  // --------------------------------------------------------------- params

  function setParam(nodeId, key, value, opts = {}) {
    const node = graph.getNode(nodeId);
    if (!node) return;
    ctx.edit(`param · ${key}`, opts.coalesce !== false);
    graph.setParam(nodeId, key, value);
    nodes.onParam(nodeId, key, value);
    inspector.refreshValue(nodeId, key);
  }

  function setBypass(nodeId, value) {
    const node = graph.getNode(nodeId);
    if (!node || !!node.bypass === !!value) return;
    ctx.edit('bypass', false);
    node.bypass = !!value;
    graph.changed('bypass');
    nodes.refreshState(node);
    inspector.render();
  }

  function bypassSelection() {
    const ids = getSelection();
    if (!ids.length) {
      toast('Select a node to bypass first');
      return;
    }
    ctx.edit('bypass', false);
    graph.batch(() => {
      for (const id of ids) {
        const n = graph.getNode(id);
        if (n) n.bypass = !n.bypass;
      }
    });
    for (const id of ids) {
      const n = graph.getNode(id);
      if (n) nodes.refreshState(n);
    }
    inspector.render();
  }

  // ------------------------------------------------------------- wiring

  function isMultiInput(nodeId, key) {
    const node = graph.getNode(nodeId);
    const def = safeDef(node ? node.type : null);
    const inp = (def.inputs || []).find((i) => i.key === key);
    return !!(inp && inp.multi);
  }

  function connectPorts(source, target) {
    const srcNode = graph.getNode(source.nodeId);
    const tgtNode = graph.getNode(target.nodeId);
    if (!srcNode || !tgtNode) return null;
    const tgtDef = safeDef(tgtNode.type);
    const inp = (tgtDef.inputs || []).find((i) => i.key === target.key);
    const targetType = target.type || (inp ? inp.type : 'any');
    if (!accepts(targetType, source.type)) return 'reject';
    if (graph.wouldLoop(source.nodeId, target.nodeId)) return 'reject';
    ctx.edit('connect', false);
    const link = graph.connect(source.nodeId, source.key, target.nodeId, target.key, {
      multi: !!(inp && inp.multi),
    });
    if (!link) return null;
    wiresChanged();
    return 'ok';
  }

  function wiresChanged() {
    wires.rebuild();
    nodes.refreshWired();
    inspector.render();
    requestFrame();
  }

  function restoreLink(link) {
    if (!link) return;
    if (graph.getLink(link.id)) return;
    const tgtNode = graph.getNode(link.to);
    const def = safeDef(tgtNode ? tgtNode.type : null);
    const inp = (def.inputs || []).find((i) => i.key === link.toPort);
    graph.connect(link.from, link.fromPort, link.to, link.toPort, {
      multi: !!(inp && inp.multi),
    });
    wiresChanged();
  }

  function disconnectInput(nodeId, key) {
    const links = graph.incoming(nodeId, key);
    if (!links.length) return;
    ctx.edit('disconnect', false);
    graph.batch(() => {
      for (const l of [...links]) graph.disconnect(l.id);
    });
    wiresChanged();
  }

  function disconnectNode(nodeId) {
    const links = graph.linksOf(nodeId);
    if (!links.length) {
      toast('That node has no wires');
      return;
    }
    ctx.edit('disconnect', false);
    graph.batch(() => {
      for (const l of [...links]) graph.disconnect(l.id);
    });
    wiresChanged();
  }

  // -------------------------------------------------- drop-a-wire inserts

  function openInsertSearch(state, clientX, clientY) {
    const restore = state.detachedRemoved && state.detached ? state.detached : null;
    let restoreType = null;
    if (restore && state.detachTarget) {
      const n = graph.getNode(state.detachTarget.nodeId);
      const def = safeDef(n ? n.type : null);
      const inp = (def.inputs || []).find((i) => i.key === state.detachTarget.key);
      restoreType = inp ? inp.type : 'any';
    }
    const insert = {
      source: state.source,
      target: state.target,
      restore: restore ? { link: restore, type: restoreType } : null,
    };
    if (!insert.source && !insert.target) return;
    const filter = {};
    if (insert.source) filter.inputType = insert.source.type;
    if (insert.target) filter.outputFor = insert.target.type;
    search.open({
      x: clientX,
      y: clientY,
      filter,
      insert,
      point: screenToWorld(clientX, clientY),
    });
  }

  function completeInsert(insert, node) {
    const def = safeDef(node.type);
    if (insert.source) {
      const inp = (def.inputs || []).find((i) => accepts(i.type, insert.source.type));
      if (inp) connectPorts(insert.source, { nodeId: node.id, key: inp.key, type: inp.type });
      if (insert.restore) {
        const outp = (def.outputs || []).find((x) => accepts(insert.restore.type, x.type));
        const tgt = insert.restore.link;
        if (outp && graph.getNode(tgt.to)) {
          ctx.edit('connect', false);
          graph.connect(node.id, outp.key, tgt.to, tgt.toPort, {
            multi: isMultiInput(tgt.to, tgt.toPort),
          });
        }
      }
    } else if (insert.target) {
      const outp = (def.outputs || []).find((x) => accepts(insert.target.type, x.type));
      if (outp) connectPorts({ nodeId: node.id, key: outp.key, type: outp.type }, insert.target);
    }
    wiresChanged();
  }

  function cancelInsert(insert) {
    if (insert && insert.restore) restoreLink(insert.restore.link);
  }

  // ----------------------------------------------------------- node edits

  function addNodeAt(type, wx, wy, opts = {}) {
    const def = safeDef(type);
    ctx.edit('add-node', false);
    const node = graph.addNode(def, 0, 0);
    nodes.build(node);
    const w = node._w || 190;
    const h = node._h || 110;
    node.x = Math.round(wx - w / 2);
    node.y = Math.round(wy - Math.min(h / 2, 46));
    nodes.setPos(node);
    fitGroups();
    if (opts.select !== false) setSelection([node.id]);
    updateEmptyState();
    minimap.markDirty();
    requestFrame();
    if (node.type === NOTE_TYPE) nodes.focusNote(node.id);
    return node;
  }

  function addNodeCentered(type) {
    const r = els.viewport.getBoundingClientRect();
    const p = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    return addNodeAt(type, p.x, p.y, { select: true });
  }

  function duplicateSelection() {
    const ids = getSelection();
    if (!ids.length) {
      toast('Select a node to duplicate first');
      return;
    }
    ctx.edit('duplicate', false);
    const map = new Map();
    const created = [];
    graph.batch(() => {
      for (const id of ids) {
        const src = graph.getNode(id);
        if (!src) continue;
        const def = safeDef(src.type);
        const copy = graph.addNode(def, src.x + 32, src.y + 32);
        copy.title = src.title;
        copy.bypass = src.bypass;
        copy.params = JSON.parse(JSON.stringify(src.params || {}));
        map.set(id, copy.id);
        created.push(copy.id);
      }
      for (const l of graph.links) {
        if (map.has(l.from) && map.has(l.to)) {
          graph.links.push({ id: uid('l'), from: map.get(l.from), fromPort: l.fromPort, to: map.get(l.to), toPort: l.toPort });
        }
      }
    });
    for (const [src, dst] of map) {
      if (collapsedMemory.has(src)) collapsedMemory.set(dst, collapsedMemory.get(src));
    }
    sync();
    setSelection(created);
  }

  function deleteSelection() {
    const ids = getSelection();
    const wiresToDelete = [...wireSelection];
    if (!ids.length && !wiresToDelete.length) return;
    ctx.edit('delete', false);
    graph.batch(() => {
      for (const id of wiresToDelete) graph.disconnect(id);
      for (const id of ids) graph.removeNode(id);
    });
    selection.clear();
    wireSelection.clear();
    sync();
    applySelection();
  }

  function groupSelection() {
    const ids = getSelection().filter((id) => graph.hasNode(id));
    if (ids.length < 1) {
      toast('Select the nodes you want to group first');
      return;
    }
    ctx.edit('group.add', false);
    const group = graph.addGroup(ids, 'Group', GROUP_COLOURS[graph.groups.length % GROUP_COLOURS.length]);
    groups.build(group);
    fitGroups();
    groups.updateSelection();
    requestFrame();
    const wrap = groups.get(group.id);
    const input = wrap && wrap.querySelector('.group-title-input');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function ungroupSelection() {
    const ids = getSelection();
    const doomed = graph.groups.filter((g) => (g.nodes || []).some((id) => ids.includes(id)));
    if (!doomed.length) {
      toast('Nothing to ungroup');
      return;
    }
    ctx.edit('group.remove', false);
    graph.batch(() => {
      for (const g of doomed) graph.removeGroup(g.id);
    });
    groups.rebuild();
    requestFrame();
  }

  function deleteGroup(groupId) {
    const g = graph.groups.find((x) => x.id === groupId);
    if (!g) return;
    ctx.edit('group.remove', false);
    graph.removeGroup(groupId);
    groups.rebuild();
    requestFrame();
    toast(`Removed “${g.title || 'Group'}” — the nodes stay`);
  }

  function recolourGroup(groupId, color) {
    const g = graph.groups.find((x) => x.id === groupId);
    if (!g) return;
    ctx.edit('group.recolour', false);
    g.color = color;
    graph.changed('group');
    groups.updateGeom(g);
  }

  // ------------------------------------------------------- node dragging

  function startNodeDrag(e, nodeId) {
    if (e.button !== 0) return;
    cancelViewAnim();
    menu.close();
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleNodeSelection(nodeId);
    else if (!selection.has(nodeId)) selectOnly(nodeId);
    if (!selection.has(nodeId)) return;

    const ids = getSelection();
    const start = new Map();
    for (const id of ids) {
      const n = graph.getNode(id);
      if (n) start.set(id, { x: n.x, y: n.y });
    }
    const handle = nodes.get(nodeId);
    if (!handle) return;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    let moved = false;
    let edited = false;
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const zoom = graph.view.zoom || 1;
      const dx = (ev.clientX - e.clientX) / zoom;
      const dy = (ev.clientY - e.clientY) / zoom;
      if (!moved) {
        if (dx * dx + dy * dy < 9) return;
        moved = true;
        nodes.setDragging(ids, true);
      }
      if (!edited) {
        edited = true;
        ctx.edit('move', false);
      }
      for (const [id, p] of start) {
        const n = graph.getNode(id);
        if (!n) continue;
        n.x = p.x + dx;
        n.y = p.y + dy;
        nodes.setPos(n);
      }
      fitGroups();
      requestFrame();
    };
    const finish = (ev) => {
      if (ev && ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      nodes.setDragging(ids, false);
      if (moved) {
        for (const id of ids) {
          const n = graph.getNode(id);
          if (n) nodes.measure(n);
        }
        graph.syncGroupMembership(ids);
        fitGroups();
        requestFrame();
        minimap.markDirty();
      }
    };
    // Window, not the node element: an undo (or any rebuild) mid-drag can
    // replace the node DOM, and a gesture whose listeners died with the old
    // element leaves the drag state stuck. Window listeners survive it.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function startGroupDrag(e, groupId) {
    if (e.button !== 0) return;
    cancelViewAnim();
    menu.close();
    const g = graph.groups.find((x) => x.id === groupId);
    if (!g) return;
    if (!e.shiftKey) setSelection((g.nodes || []).filter((id) => graph.hasNode(id)));
    const ids = [...new Set([...(g.nodes || []), ...getSelection()])].filter((id) => graph.hasNode(id));
    if (!ids.length) return;
    const start = new Map();
    for (const id of ids) {
      const n = graph.getNode(id);
      if (n) start.set(id, { x: n.x, y: n.y });
    }
    try {
      els.viewport.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    let edited = false;
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const zoom = graph.view.zoom || 1;
      const dx = (ev.clientX - e.clientX) / zoom;
      const dy = (ev.clientY - e.clientY) / zoom;
      if (!edited) {
        if (dx * dx + dy * dy < 9) return;
        edited = true;
        ctx.edit('group.move', false);
        nodes.setDragging(ids, true);
      }
      for (const [id, p] of start) {
        const n = graph.getNode(id);
        if (!n) continue;
        n.x = p.x + dx;
        n.y = p.y + dy;
        nodes.setPos(n);
      }
      fitGroups();
      requestFrame();
    };
    const finish = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      els.viewport.removeEventListener('pointermove', onMove);
      els.viewport.removeEventListener('pointerup', finish);
      els.viewport.removeEventListener('pointercancel', finish);
      try {
        els.viewport.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      nodes.setDragging(ids, false);
      if (edited) {
        for (const id of ids) {
          const n = graph.getNode(id);
          if (n) nodes.measure(n);
        }
        graph.syncGroupMembership(ids);
        fitGroups();
        requestFrame();
      }
    };
    els.viewport.addEventListener('pointermove', onMove);
    els.viewport.addEventListener('pointerup', finish);
    els.viewport.addEventListener('pointercancel', finish);
  }

  // -------------------------------------------------- background gestures

  function startPan(e) {
    cancelViewAnim();
    menu.close();
    const origin = { x: graph.view.x, y: graph.view.y, cx: e.clientX, cy: e.clientY };
    try {
      els.viewport.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    els.viewport.classList.add('panning');
    let moved = false;
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      moved = true;
      setView({ x: origin.x + (ev.clientX - origin.cx), y: origin.y + (ev.clientY - origin.cy) });
    };
    const finish = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      els.viewport.removeEventListener('pointermove', onMove);
      els.viewport.removeEventListener('pointerup', finish);
      els.viewport.removeEventListener('pointercancel', finish);
      els.viewport.classList.remove('panning');
      try {
        els.viewport.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!moved && e.button === 0 && !e.shiftKey) clearSelection();
    };
    els.viewport.addEventListener('pointermove', onMove);
    els.viewport.addEventListener('pointerup', finish);
    els.viewport.addEventListener('pointercancel', finish);
  }

  function startMarquee(e) {
    cancelViewAnim();
    menu.close();
    const vr0 = els.viewport.getBoundingClientRect();
    const origin = { x: e.clientX - vr0.left, y: e.clientY - vr0.top };
    const base = e.shiftKey ? new Set(selection) : new Set();
    els.marquee.classList.remove('hidden');
    try {
      els.viewport.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const x = ev.clientX - vr0.left;
      const y = ev.clientY - vr0.top;
      const rect = {
        x: Math.min(origin.x, x),
        y: Math.min(origin.y, y),
        w: Math.abs(x - origin.x),
        h: Math.abs(y - origin.y),
      };
      els.marquee.style.left = `${rect.x}px`;
      els.marquee.style.top = `${rect.y}px`;
      els.marquee.style.width = `${rect.w}px`;
      els.marquee.style.height = `${rect.h}px`;

      const a = screenToWorld(vr0.left + rect.x, vr0.top + rect.y);
      const b = screenToWorld(vr0.left + rect.x + rect.w, vr0.top + rect.y + rect.h);
      const hits = new Set(base);
      for (const n of graph.nodes) {
        const w = n._w || 190;
        const h = n._h || 110;
        if (n.x < b.x && n.x + w > a.x && n.y < b.y && n.y + h > a.y) hits.add(n.id);
      }
      setSelection([...hits]);
    };
    const finish = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      els.viewport.removeEventListener('pointermove', onMove);
      els.viewport.removeEventListener('pointerup', finish);
      els.viewport.removeEventListener('pointercancel', finish);
      els.marquee.classList.add('hidden');
      try {
        els.viewport.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    els.viewport.addEventListener('pointermove', onMove);
    els.viewport.addEventListener('pointerup', finish);
    els.viewport.addEventListener('pointercancel', finish);
  }

  function onViewportPointerDown(e) {
    if (e.button === 2) return;
    const t = e.target;
    if (t.closest && t.closest('.node, .group, .minimap, .marquee, .wire-hit, #empty-state')) return;
    menu.close();
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      startPan(e);
    } else if (e.button === 0 && e.shiftKey) {
      e.preventDefault();
      startMarquee(e);
    } else if (e.button === 0) {
      startPan(e);
    }
  }

  // -------------------------------------------------------- context menus

  function onContextMenu(e) {
    const t = e.target;
    if (t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    const nodeEl = t.closest('.node');
    const groupEl = t.closest('.group');
    const wireEl = t.closest('[data-link]');
    if (nodeEl) return showNodeMenu(nodeEl.dataset.id, e);
    if (groupEl) return showGroupMenu(groupEl.dataset.id, e);
    if (wireEl) return showWireMenu(wireEl.getAttribute('data-link'), e);
    if (t.closest('#empty-state')) return;
    showBackgroundMenu(e);
  }

  function showBackgroundMenu(e) {
    const p = screenToWorld(e.clientX, e.clientY);
    menu.show(
      [
        {
          label: 'Add node here',
          icon: '＋',
          hint: 'Tab',
          fn: () => search.open({ x: e.clientX, y: e.clientY, point: p }),
        },
        { label: 'Add note', icon: '✎', fn: () => addNodeAt(NOTE_TYPE, p.x, p.y) },
        '-',
        { label: 'Frame all', icon: '⛶', hint: 'F', fn: frameAll },
        { label: 'Select all', icon: '⬚', hint: 'A', fn: selectAll },
      ],
      e.clientX,
      e.clientY
    );
  }

  function showNodeMenu(nodeId, e) {
    const node = graph.getNode(nodeId);
    if (!node) return;
    if (!selection.has(nodeId)) selectOnly(nodeId);
    const def = safeDef(node.type);
    menu.show(
      [
        { head: node.title || def.label },
        { label: 'Rename', icon: '✎', hint: 'double-click', fn: () => nodes.startRename(nodeId) },
        { label: 'Duplicate', icon: '⧉', hint: 'Ctrl+D', fn: duplicateSelection },
        {
          label: node.bypass ? 'Un-bypass' : 'Bypass',
          icon: '⏭',
          hint: 'B',
          fn: bypassSelection,
        },
        { label: 'Group', icon: '❑', hint: 'Ctrl+G', fn: groupSelection },
        '-',
        { label: 'Disconnect all', icon: '✂', fn: () => disconnectNode(nodeId) },
        { label: 'Delete', icon: '🗑', hint: 'Del', danger: true, fn: deleteSelection },
      ],
      e.clientX,
      e.clientY
    );
  }

  function showWireMenu(linkId, e) {
    const link = graph.getLink(linkId);
    if (!link) return;
    if (!wireSelection.has(linkId)) {
      wireSelection.clear();
      wireSelection.add(linkId);
      wires.applySelection();
    }
    menu.show(
      [
        { head: 'Wire' },
        {
          label: 'Insert node…',
          icon: '＋',
          fn: () => insertIntoWire(linkId, e.clientX, e.clientY),
        },
        '-',
        { label: 'Delete wire', icon: '🗑', danger: true, fn: () => deleteWire(linkId) },
      ],
      e.clientX,
      e.clientY
    );
  }

  function deleteWire(linkId) {
    if (!graph.getLink(linkId)) return;
    ctx.edit('delete-wire', false);
    graph.disconnect(linkId);
    wireSelection.delete(linkId);
    wiresChanged();
  }

  function insertIntoWire(linkId, clientX, clientY) {
    const link = graph.getLink(linkId);
    if (!link) return;
    const srcNode = graph.getNode(link.from);
    const srcDef = safeDef(srcNode ? srcNode.type : null);
    const outp = (srcDef.outputs || []).find((x) => x.key === link.fromPort);
    const tgtNode = graph.getNode(link.to);
    const tgtDef = safeDef(tgtNode ? tgtNode.type : null);
    const inp = (tgtDef.inputs || []).find((x) => x.key === link.toPort);

    const vr = els.viewport.getBoundingClientRect();
    const a = wires.portPoint(link.from, 'out', link.fromPort, vr);
    const b = wires.portPoint(link.to, 'in', link.toPort, vr);
    const mid = screenToWorld(vr.left + (a.x + b.x) / 2, vr.top + (a.y + b.y) / 2);

    ctx.edit('insert-node', false);
    graph.disconnect(linkId);
    wiresChanged();

    search.open({
      x: clientX,
      y: clientY,
      filter: {
        inputType: outp ? outp.type : null,
        outputFor: inp ? inp.type : null,
      },
      insert: {
        source: { nodeId: link.from, key: link.fromPort, type: outp ? outp.type : 'any' },
        target: null,
        restore: { link, type: inp ? inp.type : 'any' },
      },
      point: mid,
    });
  }

  function showGroupMenu(groupId, e) {
    const g = graph.groups.find((x) => x.id === groupId);
    if (!g) return;
    const wrap = groups.get(groupId);
    menu.show(
      [
        { head: g.title || 'Group' },
        {
          label: 'Rename',
          icon: '✎',
          fn: () => {
            const input = wrap && wrap.querySelector('.group-title-input');
            if (input) {
              input.focus();
              input.select();
            }
          },
        },
        {
          label: 'Recolour',
          icon: '◍',
          fn: () => showGroupColours(groupId, e.clientX, e.clientY),
        },
        { label: 'Select members', icon: '⬚', fn: () => setSelection((g.nodes || []).filter((id) => graph.hasNode(id))) },
        '-',
        { label: 'Delete group', icon: '🗑', hint: 'keeps nodes', danger: true, fn: () => deleteGroup(groupId) },
      ],
      e.clientX,
      e.clientY
    );
  }

  function showGroupColours(groupId, x, y) {
    const g = graph.groups.find((item) => item.id === groupId);
    const items = GROUP_COLOURS.map((c) => ({
      label: c,
      icon: '●',
      fn: () => recolourGroup(groupId, c),
    }));
    items.push({
      label: 'Custom…',
      icon: '✦',
      fn: () => {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = g && /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#38bdf8';
        input.style.position = 'fixed';
        input.style.left = '-100px';
        document.body.appendChild(input);
        input.addEventListener('input', () => recolourGroup(groupId, input.value));
        input.addEventListener('change', () => {
          recolourGroup(groupId, input.value);
          input.remove();
        });
        input.click();
      },
    });
    menu.show(items, x, y);
  }

  // ------------------------------------------------------------ keyboard

  function onKeyDown(e) {
    if (e.code === 'Space') {
      if (e.repeat) {
        // Holding space must not spam the shell's pause/play shortcut.
        e.stopImmediatePropagation();
        return;
      }
      if (isTyping(e.target)) return; // let space type in fields
      spaceHeld = true;
      els.viewport.classList.add('space-pan');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      if (isTyping(e.target)) return;
      e.preventDefault();
      duplicateSelection();
      return;
    }
    if (e.key === 'Escape') {
      if (wires.isDragging()) {
        e.stopImmediatePropagation();
        wires.cancelDrag();
        return;
      }
      // Search + context menu handle their own Escape; swallow it so the
      // shell does not clear the selection underneath them.
      if (search.isOpen() || menu.isOpen()) {
        e.stopImmediatePropagation();
        return;
      }
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceHeld = false;
      els.viewport.classList.remove('space-pan');
    }
  }

  // ---------------------------------------------------------------- sync

  function sync() {
    if (destroyed) return;
    // Collapse is view state that the document does not carry — keep it.
    for (const [id, value] of [...collapsedMemory]) {
      const n = graph.getNode(id);
      if (n) n.collapsed = value;
      else collapsedMemory.delete(id);
    }
    applyView();
    nodes.rebuild();
    groups.rebuild();
    fitGroups();
    wires.rebuild();
    applySelection();
    nodes.refreshWired();
    inspector.render();
    updateEmptyState();
    minimap.markDirty();
    requestFrame();
  }

  // ------------------------------------------------------------- bootstrap

  bind(els.viewport, 'pointerdown', onViewportPointerDown, undefined, cleanups);
  // Recovery net for wire drags: if a drag ever loses its pointerup (mouse
  // released outside the window, element re-rendered underneath it), the next
  // press anywhere ends it — restoring the unplugged link — instead of leaving
  // a ghost wire and a dead drag state behind. Capture phase, so it runs
  // before the press can start something new; a *fresh* drag starts after its
  // own pointerdown, when `isDragging()` is still false.
  bind(
    window,
    'pointerdown',
    () => {
      if (wires.isDragging()) wires.cancelDrag();
    },
    { capture: true },
    cleanups
  );
  bind(els.viewport, 'wheel', onWheel, { passive: false }, cleanups);
  bind(els.viewport, 'contextmenu', onContextMenu, undefined, cleanups);
  bind(window, 'keydown', onKeyDown, undefined, cleanups);
  bind(window, 'keyup', onKeyUp, undefined, cleanups);
  bind(window, 'blur', () => {
    spaceHeld = false;
  }, undefined, cleanups);

  // Wires must never lag the canvas: react to layout changes…
  let resizeObserver = null;
  try {
    resizeObserver = new ResizeObserver(() => {
      requestFrame();
      minimap.markDirty();
    });
    resizeObserver.observe(els.viewport);
  } catch {
    resizeObserver = null;
    bind(window, 'resize', () => requestFrame(), undefined, cleanups);
  }

  // …and to *any* movement of the node DOM, whoever caused it.
  let mutationObserver = null;
  try {
    mutationObserver = new MutationObserver(() => requestFrame());
    mutationObserver.observe(els.world, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: true,
    });
  } catch {
    mutationObserver = null;
  }

  applyView();
  sync();

  // ------------------------------------------------------------ public API

  const editor = {
    sync,
    frameAll,
    openSearch(x, y) {
      search.open(x != null ? { x, y } : {});
    },
    closeMenus() {
      menu.close();
      search.close(true);
    },
    deleteSelection,
    bypassSelection,
    groupSelection,
    ungroupSelection,
    selectAll,
    clearSelection,
    getSelection,
    requestFrame,
    setErrors(errors, warnings) {
      nodes.applyErrors(errors, warnings);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelViewAnim();
      clearTimeout(viewPersistTimer);
      if (resizeObserver) resizeObserver.disconnect();
      if (mutationObserver) mutationObserver.disconnect();
      for (const fn of cleanups.splice(0)) fn();
      wires.destroy();
      inspector.destroy();
      search.destroy();
      menu.destroy();
      nodes.destroy();
      groups.destroy();
      minimap.destroy();
      els.world.textContent = '';
      els.wireLayer.textContent = '';
    },
    // Handy for other panels / debugging.
    graph,
    view: () => ({ ...graph.view }),
    nodes,
  };

  return editor;
}

export { CATEGORIES, portColor, portLabel };
