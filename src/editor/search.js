/**
 * Node search modal + the left palette.
 *
 * `open()` powers Tab / Ctrl+K, "Add node here", and the drop-a-wire-on-empty
 * flow (which filters the list to nodes that can accept the wire and connects
 * the new node automatically).
 */

import { MANIFEST, CATEGORY_ORDER, CATEGORIES, catalogue } from '../core/manifest.js';
import { safeDef } from '../core/registry.js';
import { accepts } from '../core/portTypes.js';
import { el, bind, clamp, fuzzyMatch, markMatch } from './util.js';

export function createSearch(ctx) {
  const { searchModal, searchInput, searchResults, paletteInput, paletteList } = ctx.els;
  const card = searchModal.querySelector('.node-search');
  const cleanups = [];

  let isOpen = false;
  let items = [];
  let active = 0;
  let filter = null; // { inputType } — only show nodes accepting this
  let insert = null; // pending wire-insert state
  let point = null; // world coords for the new node
  const collapsed = new Set();

  // ------------------------------------------------------------ open/close

  function open(opts = {}) {
    filter = opts.filter || null;
    insert = opts.insert || null;
    point = opts.point || null;

    if (opts.x != null && opts.y != null) {
      const w = Math.min(560, window.innerWidth - 32);
      card.style.position = 'fixed';
      card.style.left = `${Math.round(clamp(opts.x, 8, Math.max(8, window.innerWidth - w - 8)))}px`;
      card.style.top = `${Math.round(clamp(opts.y, 8, Math.max(8, window.innerHeight - 320)))}px`;
    } else {
      card.style.position = '';
      card.style.left = '';
      card.style.top = '';
    }

    searchModal.classList.remove('hidden');
    isOpen = true;
    searchInput.value = '';
    searchInput.placeholder = filter && (filter.inputType || filter.outputFor)
      ? 'Type to find a node that fits the dropped wire…'
      : 'Type to search nodes…  ↑↓ to navigate, Enter to add';
    render();
    // Focus after the modal's entry animation has started.
    requestAnimationFrame(() => {
      searchInput.focus();
      searchInput.select();
    });
  }

  function close(cancelled = false) {
    if (!isOpen) return;
    isOpen = false;
    searchModal.classList.add('hidden');
    if (cancelled && insert) ctx.cancelInsert(insert);
    insert = null;
    filter = null;
    point = null;
  }

  // -------------------------------------------------------------- picking

  function pick(def) {
    const at = point || viewCenter();
    const node = ctx.addNodeAt(def.type, at.x, at.y, { select: true });
    const pending = insert;
    insert = null;
    close(false);
    if (node && pending) ctx.completeInsert(pending, node);
    ctx.requestFrame();
  }

  function viewCenter() {
    const r = ctx.viewport.getBoundingClientRect();
    return ctx.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ------------------------------------------------------------- results

  function score(def, q) {
    if (!q) return 0;
    const cat = CATEGORIES[def.category] || { label: def.category || '' };
    let best = fuzzyMatch(q, def.label);
    let value = best ? best.score * 3 : null;
    const typeM = fuzzyMatch(q, def.type);
    if (typeM) value = Math.max(value == null ? -Infinity : value, typeM.score * 2);
    const descM = fuzzyMatch(q, def.desc || '');
    if (descM) value = Math.max(value == null ? -Infinity : value, descM.score * 0.6);
    const catM = fuzzyMatch(q, cat.label);
    if (catM) value = Math.max(value == null ? -Infinity : value, catM.score * 0.8);
    return value;
  }

  function matchesFilter(def) {
    if (!filter || (!filter.inputType && !filter.outputFor)) return true;
    if (filter.inputType && (def.inputs || []).some((i) => accepts(i.type, filter.inputType))) return true;
    if (filter.outputFor && (def.outputs || []).some((x) => accepts(filter.outputFor, x.type))) return true;
    return false;
  }

  function render() {
    const q = searchInput.value.trim();
    searchResults.textContent = '';
    items = [];
    active = 0;

    if (filter && (filter.inputType || filter.outputFor)) {
      const hint = el('div', 'ns-filter');
      hint.append(el('span', 'ns-filter-dot'), document.createTextNode('Nodes that fit the wire you dropped — pick one'));
      searchResults.appendChild(hint);
    }

    const byCategory = new Map();
    for (const def of MANIFEST) {
      if (!matchesFilter(def)) continue;
      const s = score(def, q);
      if (s === null) continue;
      if (!byCategory.has(def.category)) byCategory.set(def.category, []);
      byCategory.get(def.category).push({ def, s });
    }

    const order = [...CATEGORY_ORDER].filter((k) => byCategory.has(k));
    for (const k of byCategory.keys()) if (!order.includes(k)) order.push(k);
    if (q) {
      order.sort((a, b) => Math.max(...byCategory.get(b).map((x) => x.s)) - Math.max(...byCategory.get(a).map((x) => x.s)));
    }

    let any = false;
    for (const key of order) {
      const meta = CATEGORIES[key] || { label: key, color: '#94a3b8', icon: '◈' };
      const list = byCategory.get(key).sort((a, b) => b.s - a.s);
      const head = el('div', 'ns-cat');
      const dot = el('span', 'ns-cat-dot');
      dot.style.setProperty('--c', meta.color);
      head.append(dot, document.createTextNode(meta.label));
      searchResults.appendChild(head);

      for (const { def } of list) {
        const b = el('button', 'ns-item');
        b.type = 'button';
        b.dataset.type = def.type;
        const ico = el('span', 'ns-ico', meta.icon);
        ico.style.setProperty('--c', meta.color);
        const main = el('span', 'ns-main');
        const label = el('span', 'ns-label');
        label.innerHTML = markMatch(q, def.label);
        const desc = el('span', 'ns-desc', def.desc || '');
        main.append(label, desc);
        b.append(ico, main);
        const idx = items.length;
        items.push(def);
        b.dataset.idx = String(idx);
        b.addEventListener('pointerenter', () => setActive(idx));
        b.addEventListener('click', () => pick(def));
        searchResults.appendChild(b);
        any = true;
      }
    }

    if (!any) {
      const none = el('div', 'ns-empty');
      none.textContent = q ? `Nothing matches “${q}”.` : 'No nodes available.';
      searchResults.appendChild(none);
    }
    setActive(0, true);
  }

  function setActive(index, scroll = false) {
    if (!items.length) return;
    active = clamp(index, 0, items.length - 1);
    for (const b of searchResults.querySelectorAll('.ns-item')) {
      const on = Number(b.dataset.idx) === active;
      b.classList.toggle('active', on);
      if (on && scroll) b.scrollIntoView({ block: 'nearest' });
    }
  }

  // ------------------------------------------------------------- palette

  function buildPalette() {
    paletteList.textContent = '';
    for (const group of catalogue()) {
      const gEl = el('div', 'palette-group');
      gEl.dataset.key = group.key;

      const head = el('button', 'palette-head');
      head.type = 'button';
      head.title = group.meta.desc || group.meta.label;
      const ico = el('span', 'pi-ico', group.meta.icon);
      ico.style.setProperty('--cat', group.meta.color);
      head.append(
        ico,
        el('span', 'ph-label', group.meta.label),
        el('span', 'ph-count', String(group.items.length)),
        el('span', 'ph-chev', 'v')
      );

      const itemsEl = el('div', 'palette-items');
      for (const def of group.items) {
        const item = el('button', 'palette-item');
        item.type = 'button';
        item.dataset.type = def.type;
        item.title = `${def.label} — ${def.desc || ''}`;
        const i2 = el('span', 'pi-ico', group.meta.icon);
        i2.style.setProperty('--cat', group.meta.color);
        item.append(i2, el('span', 'pi-label', def.label));
        let suppress = false;
        item.addEventListener('click', () => {
          if (suppress) return;
          ctx.addNodeCentered(def.type);
        });
        item.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          startPaletteDrag(e, def.type, () => {
            suppress = true;
            setTimeout(() => {
              suppress = false;
            }, 0);
          });
        });
        itemsEl.appendChild(item);
      }

      head.addEventListener('click', () => {
        if (collapsed.has(group.key)) collapsed.delete(group.key);
        else collapsed.add(group.key);
        applyCollapse(gEl);
      });

      gEl.append(head, itemsEl);
      paletteList.appendChild(gEl);
      applyCollapse(gEl);
    }
  }

  function applyCollapse(gEl) {
    const key = gEl.dataset.key;
    const on = collapsed.has(key) && !paletteInput.value.trim();
    gEl.classList.toggle('collapsed', on);
  }

  function filterPalette() {
    const q = paletteInput.value.trim().toLowerCase();
    for (const gEl of paletteList.querySelectorAll('.palette-group')) {
      let shown = 0;
      for (const item of gEl.querySelectorAll('.palette-item')) {
        const def = safeDef(item.dataset.type);
        const hay = `${def.label} ${def.type} ${def.desc || ''}`.toLowerCase();
        const ok = !q || hay.includes(q);
        item.classList.toggle('hidden', !ok);
        if (ok) shown++;
      }
      gEl.classList.toggle('hidden', shown === 0);
      const count = gEl.querySelector('.ph-count');
      if (count) count.textContent = String(shown);
      applyCollapse(gEl);
    }
  }

  /** Drag a palette row onto the canvas to drop a node there. */
  function startPaletteDrag(e, type, onConsumed) {
    const ghost = el('div', 'palette-ghost');
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      if (!moved) {
        if (dx * dx + dy * dy < 20) return;
        moved = true;
        ghost.textContent = safeDef(type).label;
        document.body.appendChild(ghost);
        ctx.viewport.classList.add('wiring');
      }
      ghost.style.left = `${ev.clientX + 14}px`;
      ghost.style.top = `${ev.clientY + 10}px`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      ctx.viewport.classList.remove('wiring');
      ghost.remove();
      if (!moved) return;
      onConsumed();
      const r = ctx.viewport.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      const p = ctx.screenToWorld(ev.clientX, ev.clientY);
      ctx.addNodeAt(type, p.x, p.y, { select: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // -------------------------------------------------------------- events

  bind(
    searchInput,
    'input',
    () => render(),
    undefined,
    cleanups
  );

  bind(
    searchInput,
    'keydown',
    (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1, true);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1, true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[active]) pick(items[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    },
    undefined,
    cleanups
  );

  bind(
    searchModal,
    'pointerdown',
    (e) => {
      if (e.target === searchModal) {
        e.preventDefault();
        close(true);
      }
    },
    undefined,
    cleanups
  );

  bind(
    paletteInput,
    'input',
    () => filterPalette(),
    undefined,
    cleanups
  );

  buildPalette();

  return {
    open,
    close,
    buildPalette,
    filterPalette,
    isOpen: () => isOpen,
    destroy() {
      for (const fn of cleanups) fn();
    },
  };
}
