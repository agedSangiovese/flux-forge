/**
 * Node DOM.
 *
 * Renders every node of the graph inside `#world` from its (possibly missing)
 * definition, wires up the inline widgets, ports, collapse chevron, sticky
 * notes, error badges and selection state.
 *
 * Nothing here mutates the document model — the module calls back into the
 * editor (`ctx.setParam`, `ctx.startNodeDrag`, …) which owns history.
 */

import { safeDef } from '../core/registry.js';
import { CATEGORIES } from '../core/manifest.js';
import { portColor, portLabel } from '../core/portTypes.js';
import { el, escapeHtml } from './util.js';
import { createWidget } from './widgets.js';

export const NOTE_TYPE = 'util.note';

export function createNodes(ctx) {
  const cleanups = [];
  const nodeEls = new Map(); // nodeId -> element
  const widgetMaps = new Map(); // nodeId -> Map(key -> widget)
  let errorSig = null;
  let measureRaf = 0;
  let measureTimer = 0;

  // ------------------------------------------------------------------ build

  function rebuild() {
    for (const n of nodeEls.values()) n.remove();
    nodeEls.clear();
    widgetMaps.clear();
    ctx.portIndex.clear();
    errorSig = null;
    for (const node of ctx.graph.nodes) build(node);
  }

  function build(node) {
    const def = safeDef(node.type);
    const cat = CATEGORIES[def.category] || { color: '#94a3b8', icon: '◈', label: def.category || 'Other' };
    const isNote = node.type === NOTE_TYPE;

    const wrap = el('div', 'node');
    wrap.dataset.id = node.id;
    wrap.dataset.type = node.type;
    wrap.style.setProperty('--cat', cat.color);
    wrap.style.left = `${Math.round(node.x)}px`;
    wrap.style.top = `${Math.round(node.y)}px`;
    if (def.missing) wrap.classList.add('missing');
    if (node.bypass) wrap.classList.add('bypassed');
    if (isNote) wrap.classList.add('note');
    if (node.collapsed) wrap.classList.add('collapsed');

    // ------------------------------------------------------------ header
    const head = el('div', 'node-head');
    if (def.desc) head.title = def.desc;
    const ico = el('span', 'node-ico', def.missing ? '⚠' : cat.icon);
    ico.style.setProperty('--cat', cat.color);
    const title = el('span', 'node-title', node.title || def.label);
    const badges = el('span', 'node-badges');
    const chev = el('button', 'node-chev', 'v');
    chev.type = 'button';
    chev.title = 'Collapse / expand';
    head.append(ico, title, badges, chev);
    wrap.appendChild(head);

    // ------------------------------------------------------------ body
    const body = el('div', 'node-body');
    wrap.appendChild(body);

    if (isNote) {
      buildNoteBody(node, def, body);
    } else if (def.missing) {
      body.appendChild(el('div', 'node-missing', `Unknown node type “${node.type}”. It will be ignored.`));
    } else {
      const widgets = new Map();
      for (const inp of def.inputs || []) {
        if (inp.hidden) continue;
        body.appendChild(buildInputRow(node, inp, widgets));
      }
      for (const outp of def.outputs || []) {
        body.appendChild(buildOutputRow(node, outp));
      }
      if (!(def.inputs || []).length && !(def.outputs || []).length) {
        body.appendChild(el('div', 'node-plain', 'No ports'));
      }
      widgetMaps.set(node.id, widgets);
    }

    // -------------------------------------------------------- interactions
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      const port = e.target.closest ? e.target.closest('.port') : null;
      if (port) {
        e.preventDefault();
        e.stopPropagation();
        ctx.wires.startDrag(e, port);
        return;
      }
      if (e.button !== 0) return;
      if (e.target.closest('input, textarea, select, button, .row-ctrl, .wg')) return;
      e.stopPropagation();
      ctx.startNodeDrag(e, node.id);
    });

    wrap.addEventListener('contextmenu', (e) => {
      // Let the canvas handler build the node menu, but make sure the node is
      // the one selected.
      if (!ctx.selection.has(node.id)) ctx.selectOnly(node.id);
      e.stopPropagation();
    });

    chev.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse(node.id);
    });

    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      startRename(node.id);
    });

    ctx.world.appendChild(wrap);
    nodeEls.set(node.id, wrap);
    registerPorts(node, wrap, def);
    measure(node);
    applyBadges(node.id);
    return wrap;
  }

  function buildInputRow(node, inp, widgets) {
    const row = el('div', 'row in');
    row.dataset.key = inp.key;
    row.appendChild(makePort(node, 'in', inp));
    const label = el('span', 'row-label', inp.label || inp.key);
    label.title = `${inp.label || inp.key} · ${portLabel(inp.type)}${inp.widget ? '' : ' (socket only)'}`;
    row.appendChild(label);

    let widget = null;
    if (inp.widget) {
      const host = el('span', 'row-ctrl');
      widget = createWidget(
        inp,
        readParam(node, inp),
        (value, coalesce) => ctx.setParam(node.id, inp.key, value, { coalesce }),
        'inline'
      );
      if (widget) host.appendChild(widget.el);
      row.appendChild(host);
      if (widget) widgets.set(inp.key, widget);
    } else {
      row.classList.add('socket-only');
    }

    if (ctx.graph.incoming(node.id, inp.key).length) {
      row.classList.add('wired');
      if (widget) widget.setDisabled(true);
    }
    return row;
  }

  function buildOutputRow(node, outp) {
    const row = el('div', 'row out');
    row.dataset.key = outp.key;
    const label = el('span', 'row-label', outp.label || outp.key);
    label.title = `${outp.label || outp.key} · ${portLabel(outp.type)}`;
    row.appendChild(label);
    row.appendChild(makePort(node, 'out', outp));
    return row;
  }

  function buildNoteBody(node, def, body) {
    body.classList.add('note-body');
    const ta = document.createElement('textarea');
    ta.className = 'note-text';
    ta.spellcheck = false;
    ta.placeholder = 'Write a note…';
    ta.value = readParam(node, { key: 'text', default: 'Write a note…' });
    body.appendChild(ta);
    wrapNoteStyle(node);

    ta.addEventListener('input', () => {
      ctx.setParam(node.id, 'text', ta.value, { coalesce: true });
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('dblclick', (e) => e.stopPropagation());
    // Keep the node under the caret when the text scrolls.
    ta.addEventListener('scroll', () => ctx.requestFrame());
    autoGrow(ta);
  }

  function wrapNoteStyle(node) {
    const wrap = nodeEls.get(node.id);
    if (!wrap) return;
    wrap.style.setProperty('--note', node.params.color || '#fde047');
  }

  function makePort(node, dir, p) {
    const s = el('span', `port ${dir}${p.multi ? ' multi' : ''}`);
    s.dataset.node = node.id;
    s.dataset.dir = dir;
    s.dataset.key = p.key;
    s.dataset.type = p.type || 'any';
    if (p.multi) s.dataset.multi = '1';
    s.style.setProperty('--pc', portColor(p.type));
    s.title = `${p.label || p.key} · ${portLabel(p.type)}${p.multi ? ' · accepts several wires' : ''}`;
    ctx.portIndex.set(`${node.id}|${dir}|${p.key}`, s);
    return s;
  }

  function registerPorts(node, wrap, def) {
    // Ports are created while rows are built; this is a safety net for types
    // whose rows were skipped (e.g. collapsed rebuilds).
    for (const dots of wrap.querySelectorAll('.port')) {
      ctx.portIndex.set(`${dots.dataset.node}|${dots.dataset.dir}|${dots.dataset.key}`, dots);
    }
    if (def.missing) return;
  }

  // -------------------------------------------------------------- measure

  function measure(node) {
    const wrap = nodeEls.get(node.id);
    if (!wrap) return;
    node._w = Math.round(wrap.offsetWidth) || node._w || 190;
    node._h = Math.round(wrap.offsetHeight) || node._h || 110;
  }

  function measureLater(node) {
    const wrap = nodeEls.get(node.id);
    if (!wrap) return;
    // Collapse/expand animates, so the final box is only known once the
    // transition has settled; sample a few frames in and once it is done.
    cancelAnimationFrame(measureRaf);
    clearTimeout(measureTimer);
    let count = 0;
    const tick = () => {
      measure(node);
      if (count++ < 12) measureRaf = requestAnimationFrame(tick);
    };
    measureRaf = requestAnimationFrame(tick);
    measureTimer = setTimeout(() => {
      measure(node);
      ctx.fitGroups();
      ctx.requestFrame();
    }, 220);
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }

  // ------------------------------------------------------------- state sync

  function refreshState(node) {
    const wrap = nodeEls.get(node.id);
    if (!wrap) return;
    const def = safeDef(node.type);
    const title = wrap.querySelector('.node-title');
    if (title) title.textContent = node.title || def.label;
    wrap.classList.toggle('bypassed', !!node.bypass);
    wrap.classList.toggle('collapsed', !!node.collapsed);
    if (node.type === NOTE_TYPE) wrapNoteStyle(node);
    applyBadges(node.id);
  }

  function applyBadges(nodeId) {
    const wrap = nodeEls.get(nodeId);
    if (!wrap) return;
    const badges = wrap.querySelector('.node-badges');
    if (!badges) return;
    badges.textContent = '';
    const node = ctx.graph.getNode(nodeId);
    if (!node) return;
    if (node.bypass) {
      const b = el('span', 'node-badge bypass', '⏭');
      b.title = 'This node is bypassed — it passes its input straight through.';
      badges.appendChild(b);
    }
    const def = safeDef(node.type);
    if (def.missing) {
      const b = el('span', 'node-badge warn', '?');
      b.title = `Unknown node type “${node.type}” — it is not installed.`;
      badges.appendChild(b);
    }
    if (errorState.errors.has(nodeId)) {
      const b = el('span', 'node-badge err', '!');
      b.title = errorState.errors.get(nodeId);
      badges.appendChild(b);
    } else if (errorState.warnings.has(nodeId)) {
      const b = el('span', 'node-badge warn', '⚠');
      b.title = errorState.warnings.get(nodeId);
      badges.appendChild(b);
    }
  }

  const errorState = { errors: new Map(), warnings: new Map() };

  function applyErrors(errors, warnings) {
    const toMap = (v) => (v instanceof Map ? v : v && typeof v === 'object' ? new Map(Object.entries(v)) : new Map());
    const errs = toMap(errors);
    const warns = toMap(warnings);
    const sig = JSON.stringify([[...errs], [...warns]]);
    if (sig === errorSig) return;
    errorSig = sig;
    errorState.errors = errs;
    errorState.warnings = warns;
    for (const id of nodeEls.keys()) applyBadges(id);
  }

  function updateSelection() {
    for (const [id, wrap] of nodeEls) {
      wrap.classList.toggle('selected', ctx.selection.has(id));
    }
  }

  function setPos(node) {
    const wrap = nodeEls.get(node.id);
    if (!wrap) return;
    wrap.style.left = `${Math.round(node.x)}px`;
    wrap.style.top = `${Math.round(node.y)}px`;
  }

  function setDragging(ids, on) {
    for (const id of ids) {
      const wrap = nodeEls.get(id);
      if (wrap) wrap.classList.toggle('dragging', on);
    }
  }

  // ---------------------------------------------------------- wired inputs

  function refreshWired() {
    for (const [id, wrap] of nodeEls) {
      const widgets = widgetMaps.get(id);
      for (const row of wrap.querySelectorAll('.row.in')) {
        const key = row.dataset.key;
        const wired = ctx.graph.incoming(id, key).length > 0;
        row.classList.toggle('wired', wired);
        const w = widgets && widgets.get(key);
        if (w && w.setDisabled) w.setDisabled(wired);
      }
    }
  }

  // ------------------------------------------------------------- params

  function onParam(nodeId, key, value) {
    const widgets = widgetMaps.get(nodeId);
    const w = widgets && widgets.get(key);
    if (w && w.set) w.set(value);
    const node = ctx.graph.getNode(nodeId);
    if (!node) return;
    if (node.type === NOTE_TYPE) {
      const wrap = nodeEls.get(nodeId);
      if (!wrap) return;
      if (key === 'color') wrapNoteStyle(node);
      if (key === 'text') {
        const ta = wrap.querySelector('.note-text');
        if (ta && document.activeElement !== ta) ta.value = value == null ? '' : String(value);
        if (ta) autoGrow(ta);
        measure(node);
        ctx.fitGroups();
        ctx.requestFrame();
      }
    }
  }

  // -------------------------------------------------------------- rename

  function startRename(nodeId) {
    const wrap = nodeEls.get(nodeId);
    const node = ctx.graph.getNode(nodeId);
    if (!wrap || !node) return;
    if (wrap.querySelector('.node-title-input')) return;
    const def = safeDef(node.type);
    const titleEl = wrap.querySelector('.node-title');
    const head = wrap.querySelector('.node-head');
    const input = el('input', 'node-title-input');
    input.type = 'text';
    input.value = node.title || def.label;
    input.spellcheck = false;
    wrap.classList.add('renaming');
    head.insertBefore(input, titleEl);
    input.focus();
    input.select();

    let done = false;
    const finish = (revert) => {
      if (done) return;
      done = true;
      const final = revert ? node.title || def.label || '' : input.value.trim();
      input.remove();
      wrap.classList.remove('renaming');
      if (!revert) {
        const next = final && final !== def.label ? final : null;
        if (next !== (node.title ?? null)) {
          ctx.edit('rename', false);
          node.title = next;
          ctx.graph.changed('title');
          titleEl.textContent = next || def.label;
          ctx.refreshInspector();
        }
      }
    };

    input.addEventListener('input', () => {
      const v = input.value;
      ctx.edit('rename', true);
      node.title = v.trim() === def.label ? null : v;
      titleEl.textContent = v || def.label;
      ctx.graph.changed('title');
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(true);
      }
    });
    input.addEventListener('blur', () => finish(false));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------- collapse

  function toggleCollapse(nodeId) {
    const node = ctx.graph.getNode(nodeId);
    if (!node) return;
    node.collapsed = !node.collapsed;
    ctx.rememberCollapse(nodeId, node.collapsed);
    const wrap = nodeEls.get(nodeId);
    if (wrap) {
      wrap.classList.toggle('collapsed', !!node.collapsed);
      measureLater(node);
    }
    ctx.requestFrame();
  }

  function focusNote(nodeId) {
    const wrap = nodeEls.get(nodeId);
    const ta = wrap && wrap.querySelector('.note-text');
    if (ta) {
      ta.focus();
      ta.select();
    }
  }

  function get(id) {
    return nodeEls.get(id) || null;
  }

  function destroy() {
    cancelAnimationFrame(measureRaf);
    clearTimeout(measureTimer);
    for (const fn of cleanups) fn();
    nodeEls.clear();
    widgetMaps.clear();
  }

  return {
    rebuild,
    build,
    get,
    measure,
    setPos,
    setDragging,
    updateSelection,
    refreshWired,
    refreshState,
    onParam,
    applyErrors,
    startRename,
    focusNote,
    toggleCollapse,
    autoGrow,
    destroy,
    nodeEls,
  };
}

// --------------------------------------------------------------- helpers

export function readParam(node, input) {
  const v = node.params ? node.params[input.key] : undefined;
  return v === undefined || v === null ? input.default : v;
}

export { escapeHtml };
