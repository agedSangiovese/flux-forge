/**
 * The wire layer.
 *
 * Wires are drawn in *screen* coordinates into `<svg id="wire-layer">` so the
 * stroke stays the same weight at every zoom level. Each endpoint comes from
 * the live `getBoundingClientRect()` of its port element, which keeps the
 * curves glued to the nodes even mid-drag.
 *
 * Also owns the "drag a wire" interaction, socket compatibility hints and the
 * wire that pops open the node search when dropped on empty canvas.
 */

import { safeDef } from '../core/registry.js';
import { portColor, accepts } from '../core/portTypes.js';
import { svgEl, clamp } from './util.js';

const MIN_DRAG = 4; // px before a socket press becomes a wire drag

export function createWires(ctx) {
  const graph = ctx.graph;
  const svg = ctx.els.wireLayer;
  const gWires = svgEl('g', { class: 'wires' });
  const ghost = svgEl('path', { class: 'wire-ghost hidden', fill: 'none' });
  svg.append(gWires, ghost);

  const records = new Map(); // linkId -> { g, hit, path, d }
  let drag = null;
  let dragCleanup = null;
  let rafQueued = false;

  function requestDraw() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      draw();
    });
  }

  // ------------------------------------------------------------- structure

  function linkColor(link) {
    const src = graph.getNode(link.from);
    const def = safeDef(src ? src.type : null);
    const outp = (def.outputs || []).find((o) => o.key === link.fromPort);
    return portColor(outp ? outp.type : null);
  }

  function rebuild() {
    gWires.textContent = '';
    records.clear();
    for (const link of graph.links) {
      const g = svgEl('g', { class: 'wire', 'data-link': link.id });
      const hit = svgEl('path', { class: 'wire-hit', fill: 'none' });
      const path = svgEl('path', { class: 'wire-line', fill: 'none' });
      path.style.setProperty('--wc', linkColor(link));
      g.append(hit, path);
      gWires.appendChild(g);
      const rec = { g, hit, path, d: '' };
      records.set(link.id, rec);
      bindWire(link.id, rec);
    }
    for (const id of [...ctx.wireSelection]) if (!records.has(id)) ctx.wireSelection.delete(id);
    applySelection();
    requestDraw();
  }

  function bindWire(linkId, rec) {
    rec.hit.addEventListener('pointerenter', () => setHover(linkId, true));
    rec.hit.addEventListener('pointerleave', () => setHover(linkId, false));
    rec.hit.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    rec.hit.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.selectWire(linkId, e.shiftKey);
    });
  }

  function setHover(linkId, on) {
    const rec = records.get(linkId);
    if (!rec) return;
    rec.g.classList.toggle('hot', on);
    const link = graph.getLink(linkId);
    if (!link) return;
    for (const [dir, nodeId, key] of [
      ['out', link.from, link.fromPort],
      ['in', link.to, link.toPort],
    ]) {
      const p = ctx.portIndex.get(`${nodeId}|${dir}|${key}`);
      if (p) p.classList.toggle('linked', on);
    }
  }

  function applySelection() {
    for (const [id, rec] of records) {
      rec.g.classList.toggle('sel', ctx.wireSelection.has(id));
    }
  }

  function clearSelection() {
    ctx.wireSelection.clear();
    applySelection();
  }

  // ----------------------------------------------------------------- draw

  function portPoint(nodeId, dir, key, vr) {
    const p = ctx.portIndex.get(`${nodeId}|${dir}|${key}`);
    if (p) {
      const r = p.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        return { x: r.left + r.width / 2 - vr.left, y: r.top + r.height / 2 - vr.top };
      }
    }
    // Collapsed node: fall back to the node's own edge.
    const nodeEl = ctx.nodes.get(nodeId);
    if (nodeEl) {
      const r = nodeEl.getBoundingClientRect();
      const y = r.top + r.height * 0.55 - vr.top;
      return dir === 'in'
        ? { x: r.left - vr.left, y }
        : { x: r.right - vr.left, y };
    }
    return { x: 0, y: 0 };
  }

  function bezier(a, b) {
    const dx = clamp(Math.abs(b.x - a.x) * 0.5, 34, 160);
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)}, ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }

  function draw() {
    const vr = ctx.viewport.getBoundingClientRect();
    if (!vr.width) return;
    for (const [id, rec] of records) {
      const link = graph.getLink(id);
      if (!link) continue;
      const a = portPoint(link.from, 'out', link.fromPort, vr);
      const b = portPoint(link.to, 'in', link.toPort, vr);
      const d = bezier(a, b);
      if (d !== rec.d) {
        rec.d = d;
        rec.path.setAttribute('d', d);
        rec.hit.setAttribute('d', d);
      }
    }
    if (drag) drawGhost(vr);
  }

  function drawGhost(vr) {
    if (!drag) return;
    const from = drag.source
      ? portPoint(drag.source.nodeId, 'out', drag.source.key, vr)
      : portPoint(drag.target.nodeId, 'in', drag.target.key, vr);
    const to = { x: drag.x - vr.left, y: drag.y - vr.top };
    const color = drag.source ? portColor(drag.source.type) : portColor(drag.target.type);
    ghost.style.setProperty('--wc', color);
    ghost.setAttribute('d', drag.source ? bezier(from, to) : bezier(to, from));
  }

  // ------------------------------------------------------------ socket drag

  function portAt(clientX, clientY) {
    const t = document.elementFromPoint(clientX, clientY);
    if (!t || typeof t.closest !== 'function') return null;
    const p = t.closest('.port');
    return p && p.dataset.node ? p : null;
  }

  function isMultiInput(nodeId, key) {
    const node = graph.getNode(nodeId);
    const def = safeDef(node ? node.type : null);
    const inp = (def.inputs || []).find((i) => i.key === key);
    return !!(inp && inp.multi);
  }

  function acceptsPair(source, target) {
    if (!accepts(target.type, source.type)) return false;
    return !graph.wouldLoop(source.nodeId, target.nodeId);
  }

  function startDrag(e, portEl) {
    if (drag) return;
    const nodeId = portEl.dataset.node;
    const key = portEl.dataset.key;
    const dir = portEl.dataset.dir;
    const type = portEl.dataset.type || 'any';
    if (!graph.getNode(nodeId)) return;

    const state = {
      pointerId: e.pointerId,
      originEl: portEl,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      source: null,
      target: null,
      detached: null,
      detachTarget: null,
      detachedRemoved: false,
      moved: false,
      hoverPort: null,
    };

    if (dir === 'out') {
      state.source = { nodeId, key, type };
    } else {
      const links = graph.incoming(nodeId, key);
      if (links.length) {
        const link = links[0];
        const srcNode = graph.getNode(link.from);
        const def = safeDef(srcNode ? srcNode.type : null);
        const outp = (def.outputs || []).find((o) => o.key === link.fromPort);
        state.source = { nodeId: link.from, key: link.fromPort, type: outp ? outp.type : 'any' };
        state.detached = link;
        state.detachTarget = { nodeId, key };
      } else {
        state.target = { nodeId, key, type };
      }
    }

    try {
      portEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag = state;
    dragCleanup = cleanup;
    ctx.viewport.classList.add('wiring');
    ghost.classList.remove('hidden');
    applyHints(state);
    requestDraw();

    const onMove = (ev) => {
      if (ev.pointerId !== state.pointerId) return;
      state.x = ev.clientX;
      state.y = ev.clientY;
      if (!state.moved) {
        const dx = ev.clientX - state.startX;
        const dy = ev.clientY - state.startY;
        if (dx * dx + dy * dy < MIN_DRAG * MIN_DRAG) return;
        state.moved = true;
        if (state.detached && !state.detachedRemoved) {
          ctx.edit('rewire', false);
          graph.disconnect(state.detached.id);
          state.detachedRemoved = true;
          ctx.wiresChanged();
          // `ctx.edit` pushed history, which rebuilds the whole node DOM:
          // the origin port we are dragging from no longer exists and every
          // hint class was wiped. Re-point at the fresh element and re-hint.
          const fresh = ctx.portIndex.get(`${nodeId}|${dir}|${key}`);
          if (fresh) state.originEl = fresh;
          state.hoverPort = null;
          applyHints(state);
        }
      }
      const over = portAt(ev.clientX, ev.clientY);
      if (over !== state.hoverPort) {
        if (state.hoverPort) state.hoverPort.classList.remove('hover');
        state.hoverPort = over;
        if (over) over.classList.add('hover');
        ghost.classList.toggle('invalid', over ? !dropValid(state, over) : false);
      }
      requestDraw();
    };

    const onUp = (ev) => {
      if (ev.pointerId !== state.pointerId) return;
      cleanup();
      const over = state.moved ? portAt(ev.clientX, ev.clientY) : null;
      if (!state.moved) {
        finish();
        return;
      }
      let result = null;
      if (over) {
        const other = { nodeId: over.dataset.node, key: over.dataset.key, type: over.dataset.type || 'any' };
        if (state.source && over.dataset.dir === 'in') result = ctx.connectPorts(state.source, other);
        else if (state.target && over.dataset.dir === 'out') result = ctx.connectPorts(other, state.target);
      }
      if (result === 'ok') {
        finish();
      } else if (result === 'reject') {
        ctx.toast('Those ports cannot be wired together', 'err');
        finish();
      } else {
        // Dropped on empty canvas: offer to insert a node in between.
        finish();
        ctx.openInsertSearch(state, ev.clientX, ev.clientY);
      }
    };

    const onCancel = () => {
      // A cancelled drag (touch takeover, window blur) must give the
      // unplugged link back rather than silently dropping it.
      cancelDrag();
    };

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      dragCleanup = null;
      try {
        portEl.releasePointerCapture(state.pointerId);
      } catch {
        /* ignore */
      }
    }

    // Listen on `window`, never on the port element: unplugging a wire calls
    // `ctx.edit('rewire')` mid-drag, which pushes history and rebuilds the
    // node DOM — destroying the origin port and releasing its pointer
    // capture. Window listeners keep receiving events no matter what gets
    // re-rendered underneath the drag.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
  }

  function dropValid(state, portEl) {
    const other = { nodeId: portEl.dataset.node, key: portEl.dataset.key, type: portEl.dataset.type || 'any' };
    if (state.source && portEl.dataset.dir === 'in') return acceptsPair(state.source, other);
    if (state.target && portEl.dataset.dir === 'out') return acceptsPair(other, state.target);
    return false;
  }

  function applyHints(state) {
    for (const p of ctx.portIndex.values()) {
      p.classList.remove('ok', 'dim', 'active', 'bad');
      if (p.dataset.dir === 'in') {
        if (!state.source) {
          p.classList.add('dim');
        } else if (p !== state.originEl && acceptsPair(state.source, { nodeId: p.dataset.node, type: p.dataset.type || 'any' })) {
          p.classList.add('ok');
        } else if (p !== state.originEl) {
          p.classList.add('dim');
        }
      } else if (p !== state.originEl) {
        if (!state.target) {
          p.classList.add('dim');
        } else if (acceptsPair({ nodeId: p.dataset.node, type: p.dataset.type || 'any' }, state.target)) {
          p.classList.add('ok');
        } else {
          p.classList.add('dim');
        }
      }
    }
    state.originEl.classList.add('active');
  }

  function clearHints() {
    for (const p of ctx.portIndex.values()) p.classList.remove('ok', 'dim', 'active', 'bad', 'hover');
  }

  function finish() {
    drag = null;
    dragCleanup = null;
    ghost.classList.add('hidden');
    ghost.classList.remove('invalid');
    ctx.viewport.classList.remove('wiring');
    clearHints();
    ctx.requestFrame();
  }

  function cancelDrag() {
    if (!drag) return false;
    const state = drag;
    if (dragCleanup) dragCleanup();
    if (state.detachedRemoved && state.detached) ctx.restoreLink(state.detached);
    finish();
    return true;
  }

  // --------------------------------------------------------------- helpers

  function isDragging() {
    return !!drag;
  }

  function dragState() {
    return drag;
  }

  function destroy() {
    cancelDrag();
    gWires.remove();
    ghost.remove();
  }

  return {
    rebuild,
    draw,
    startDrag,
    cancelDrag,
    isDragging,
    dragState,
    clearSelection,
    applySelection,
    portPoint,
    bezier,
    isMultiInput,
    destroy,
  };
}
