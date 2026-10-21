/**
 * Minimap.
 *
 * Draws every node as a small category-coloured rectangle, groups as faint
 * outlines and the visible world region as an accent rectangle. Dragging (or
 * clicking) inside jumps the main view there.
 *
 * The world↔minimap mapping is computed per draw and frozen for the duration
 * of a drag, so the view does not slide around under the pointer.
 */

import { safeDef } from '../core/registry.js';
import { CATEGORIES } from '../core/manifest.js';
import { clamp } from './util.js';

const W = 200;
const H = 130;
const PAD = 8;

export function createMinimap(ctx) {
  const canvas = ctx.els.minimapCanvas;
  const g = canvas.getContext('2d');
  let mapping = null;
  let lastDraw = 0;
  let dragId = null;

  // ------------------------------------------------------------ geometry

  function visibleRect() {
    const r = ctx.viewport.getBoundingClientRect();
    const tl = ctx.screenToWorld(r.left, r.top);
    const br = ctx.screenToWorld(r.right, r.bottom);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }

  function computeMapping() {
    const graph = ctx.graph;
    let minX;
    let minY;
    let maxX;
    let maxY;
    if (graph.nodes.length) {
      const b = graph.bounds();
      const view = visibleRect();
      minX = Math.min(b.x, view.x);
      minY = Math.min(b.y, view.y);
      maxX = Math.max(b.x + b.w, view.x + view.w);
      maxY = Math.max(b.y + b.h, view.y + view.h);
      // A little breathing room so nodes never touch the frame.
      const growX = Math.max(60, (maxX - minX) * 0.06);
      const growY = Math.max(40, (maxY - minY) * 0.06);
      minX -= growX;
      minY -= growY;
      maxX += growX;
      maxY += growY;
    } else {
      const view = visibleRect();
      minX = view.x;
      minY = view.y;
      maxX = view.x + view.w;
      maxY = view.y + view.h;
    }
    const spanW = Math.max(1, maxX - minX);
    const spanH = Math.max(1, maxY - minY);
    const scale = Math.min((W - PAD * 2) / spanW, (H - PAD * 2) / spanH);
    const offX = (W - spanW * scale) / 2 - minX * scale;
    const offY = (H - spanH * scale) / 2 - minY * scale;
    return { scale, offX, offY };
  }

  const toMap = (m, x, y) => ({ x: x * m.scale + m.offX, y: y * m.scale + m.offY });

  // --------------------------------------------------------------- draw

  function ensureBackingStore() {
    // Keep the canvas crisp on hidpi screens, but only when CSS actually
    // controls its size (otherwise we would change the layout).
    const dpr = window.devicePixelRatio || 1;
    if (dpr <= 1) return;
    const cssW = canvas.clientWidth;
    if (!cssW || cssW === canvas.width) return;
    const cssH = canvas.clientHeight || (canvas.height * cssW) / (canvas.width || cssW);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  function draw(force = false) {
    const now = performance.now();
    if (!force && now - lastDraw < 110) return;
    lastDraw = now;
    ensureBackingStore();

    const width = canvas.width;
    const height = canvas.height;
    const dpr = width / (canvas.clientWidth || width) || 1;
    const sx = width / W;
    const sy = height / H;

    g.setTransform(sx, 0, 0, sy, 0, 0);
    g.clearRect(0, 0, W, H);

    // Panel background + subtle grid.
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(127,143,170,0.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0.5; x < W; x += 16) {
      g.moveTo(x, 0);
      g.lineTo(x, H);
    }
    for (let y = 0.5; y < H; y += 16) {
      g.moveTo(0, y);
      g.lineTo(W, y);
    }
    g.stroke();

    const m = (mapping = computeMapping());
    const graph = ctx.graph;

    // Groups: faint outlined frames behind everything.
    for (const grp of graph.groups) {
      const a = toMap(m, grp.x, grp.y);
      g.strokeStyle = withAlpha(grp.color || '#38bdf8', 0.55);
      g.fillStyle = withAlpha(grp.color || '#38bdf8', 0.1);
      g.lineWidth = 1;
      const w = Math.max(4, grp.w * m.scale);
      const h = Math.max(3, grp.h * m.scale);
      g.fillRect(a.x, a.y, w, h);
      g.strokeRect(a.x + 0.5, a.y + 0.5, w - 1, h - 1);
    }

    // Nodes.
    for (const node of graph.nodes) {
      const def = safeDef(node.type);
      const cat = CATEGORIES[def.category] || { color: '#94a3b8' };
      const a = toMap(m, node.x, node.y);
      const w = Math.max(3, (node._w || 190) * m.scale);
      const h = Math.max(2, (node._h || 110) * m.scale);
      g.fillStyle = withAlpha(cat.color, node.bypass ? 0.28 : 0.9);
      g.fillRect(a.x, a.y, w, h);
      if (ctx.selection.has(node.id)) {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 1;
        g.strokeRect(a.x - 0.5, a.y - 0.5, w + 1, h + 1);
      }
    }

    // Visible region.
    const view = visibleRect();
    const v = toMap(m, view.x, view.y);
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6c8cff';
    g.lineWidth = 1.5;
    g.strokeRect(v.x, v.y, Math.max(4, view.w * m.scale), Math.max(3, view.h * m.scale));
    g.fillStyle = 'rgba(108,140,255,0.08)';
    g.fillRect(v.x, v.y, Math.max(4, view.w * m.scale), Math.max(3, view.h * m.scale));

    void dpr;
  }

  function withAlpha(hex, alpha) {
    const s = String(hex || '#888').replace('#', '');
    const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    const r = parseInt(full.slice(0, 2), 16) || 0;
    const gg = parseInt(full.slice(2, 4), 16) || 0;
    const b = parseInt(full.slice(4, 6), 16) || 0;
    return `rgba(${r},${gg},${b},${alpha})`;
  }

  // --------------------------------------------------------- interaction

  function worldFromEvent(e, m = mapping) {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / (r.width || W)) * W;
    const py = ((e.clientY - r.top) / (r.height || H)) * H;
    return { x: (px - m.offX) / m.scale, y: (py - m.offY) / m.scale };
  }

  function centerOn(world) {
    const r = ctx.viewport.getBoundingClientRect();
    ctx.setView({
      x: r.width / 2 - world.x * ctx.graph.view.zoom,
      y: r.height / 2 - world.y * ctx.graph.view.zoom,
    });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    draw(true);
    if (!mapping) return;
    dragId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    centerOn(worldFromEvent(e));
    const move = (ev) => {
      if (ev.pointerId !== dragId) return;
      centerOn(worldFromEvent(ev));
    };
    const up = (ev) => {
      if (ev.pointerId !== dragId) return;
      dragId = null;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    draw,
    markDirty() {
      lastDraw = 0;
    },
    destroy() {
      // Canvas listeners die with the element being torn down by the shell;
      // nothing else to release here.
    },
  };
}

export { clamp };
