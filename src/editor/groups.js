/**
 * Group frames.
 *
 * Groups are drawn behind the nodes, tinted with their colour. Their geometry
 * is *derived*: after any node move or full rebuild we call `graph.fitGroup`
 * and mirror the result onto the element, so the frame always stays snug.
 */

import { el, normHex } from './util.js';

export function createGroups(ctx) {
  const cleanups = [];
  const groupEls = new Map();

  function rebuild() {
    for (const g of groupEls.values()) g.remove();
    groupEls.clear();
    for (const g of ctx.graph.groups) build(g);
  }

  function build(g) {
    const wrap = el('div', 'group');
    wrap.dataset.id = g.id;
    wrap.style.setProperty('--gcolor', normHex(g.color || '#38bdf8'));

    const bar = el('div', 'group-bar');
    const dot = el('span', 'group-dot');
    const input = el('input', 'group-title-input');
    input.type = 'text';
    input.value = g.title || 'Group';
    input.spellcheck = false;
    const count = el('span', 'group-count');
    bar.append(dot, input, count);
    wrap.appendChild(bar);

    const note = el('div', 'group-note');
    note.textContent = g.note || '';
    note.dataset.placeholder = 'Add a note…';
    wrap.appendChild(note);

    // ------------------------------------------------------------ events
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('input', () => {
      ctx.edit('group.rename', true);
      g.title = input.value;
      ctx.graph.changed('group');
    });

    note.addEventListener('pointerdown', (e) => {
      if (note.isContentEditable) e.stopPropagation();
    });
    note.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      note.contentEditable = 'true';
      note.focus();
      document.execCommand?.('selectAll', false, null);
    });
    note.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') note.blur();
    });
    note.addEventListener('blur', () => {
      if (note.contentEditable !== 'true') return;
      note.contentEditable = 'false';
      const text = note.textContent.trim();
      if (text !== (g.note || '')) {
        ctx.edit('group.note', false);
        g.note = text;
        ctx.graph.changed('group');
      }
    });

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('input')) return;
      e.stopPropagation();
      ctx.startGroupDrag(e, g.id);
    });

    ctx.world.prepend(wrap);
    groupEls.set(g.id, wrap);
    updateGeom(g);
    return wrap;
  }

  function updateGeom(g) {
    const wrap = groupEls.get(g.id);
    if (!wrap) return;
    wrap.style.left = `${Math.round(g.x)}px`;
    wrap.style.top = `${Math.round(g.y)}px`;
    wrap.style.width = `${Math.round(g.w)}px`;
    wrap.style.height = `${Math.round(g.h)}px`;
    wrap.style.setProperty('--gcolor', normHex(g.color || '#38bdf8'));
    const input = wrap.querySelector('.group-title-input');
    if (input && document.activeElement !== input) input.value = g.title || 'Group';
    const count = wrap.querySelector('.group-count');
    const n = (g.nodes || []).length;
    if (count) count.textContent = `${n} node${n === 1 ? '' : 's'}`;
  }

  function updateSelection() {
    const selectedNodes = ctx.selection;
    for (const g of ctx.graph.groups) {
      const wrap = groupEls.get(g.id);
      if (!wrap) continue;
      const on = (g.nodes || []).some((id) => selectedNodes.has(id));
      wrap.classList.toggle('selected', on);
    }
  }

  function get(id) {
    return groupEls.get(id) || null;
  }

  function destroy() {
    for (const fn of cleanups) fn();
  }

  return { rebuild, build, updateGeom, updateSelection, get, destroy, groupEls };
}
