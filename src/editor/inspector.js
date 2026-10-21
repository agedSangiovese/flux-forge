/**
 * Inspector panel (right column).
 *
 * One selected node → full editing surface: title, type/category, bypass, a
 * ports & wiring summary and a control for every widget-backed input. Inputs
 * that are driven by a wire are disabled with an explicit affordance.
 *
 * Two or more nodes → a small summary panel. Nothing selected → the shell's
 * `.inspector-empty` placeholder.
 */

import { safeDef } from '../core/registry.js';
import { CATEGORIES } from '../core/manifest.js';
import { portColor, portLabel } from '../core/portTypes.js';
import { el, escapeHtml } from './util.js';
import { createWidget } from './widgets.js';
import { readParam } from './nodes.js';

export function createInspector(ctx) {
  const body = ctx.els.inspectorBody;
  const widgets = new Map(); // key -> widget (single selection only)
  let shownNode = null;

  function clear() {
    body.textContent = '';
    widgets.clear();
    shownNode = null;
  }

  function render() {
    const ids = [...ctx.selection];
    clear();
    if (!ids.length) {
      body.appendChild(el('div', 'inspector-empty', 'Select a node to edit its settings.'));
      return;
    }
    if (ids.length > 1) {
      renderMulti(ids);
      return;
    }
    renderSingle(ids[0]);
  }

  // ------------------------------------------------------------- multi

  function renderMulti(ids) {
    shownNode = null;
    const wrap = el('div', 'insp-multi');
    wrap.appendChild(el('div', 'insp-multi-title', `${ids.length} nodes selected`));
    const list = el('ul', 'insp-list');
    for (const id of ids.slice(0, 12)) {
      const node = ctx.graph.getNode(id);
      if (!node) continue;
      const def = safeDef(node.type);
      const li = el('li');
      const cat = CATEGORIES[def.category] || { color: '#94a3b8', icon: '◈' };
      const dot = el('span', 'insp-dot');
      dot.style.setProperty('--pc', cat.color);
      li.append(dot, document.createTextNode(node.title || def.label));
      list.appendChild(li);
    }
    if (ids.length > 12) list.appendChild(el('li', 'insp-list-more', `…and ${ids.length - 12} more`));
    wrap.appendChild(list);

    const actions = el('div', 'insp-actions');
    actions.append(
      actionBtn('❑ Group', 'Group these nodes', () => ctx.groupSelection()),
      actionBtn('⏭ Bypass', 'Toggle bypass', () => ctx.bypassSelection()),
      actionBtn('🗑 Delete', 'Delete these nodes', () => ctx.deleteSelection(), 'danger')
    );
    wrap.appendChild(actions);
    body.appendChild(wrap);
  }

  function actionBtn(label, title, fn, kind = '') {
    const b = el('button', `insp-action${kind ? ` ${kind}` : ''}`, label);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  // ------------------------------------------------------------- single

  function renderSingle(nodeId) {
    const node = ctx.graph.getNode(nodeId);
    if (!node) {
      render();
      return;
    }
    shownNode = nodeId;
    const def = safeDef(node.type);
    const cat = CATEGORIES[def.category] || { label: def.category || 'Other', color: '#94a3b8', icon: '◈' };

    // ---- header -----------------------------------------------------
    const head = el('div', 'insp-head');
    const title = el('input', 'insp-title');
    title.type = 'text';
    title.spellcheck = false;
    title.value = node.title || def.label;
    title.placeholder = def.label;
    title.title = def.desc || def.label;
    title.addEventListener('input', () => {
      ctx.edit('rename', true);
      const v = title.value.trim();
      node.title = v && v !== def.label ? v : null;
      ctx.graph.changed('title');
      ctx.nodes.refreshState(node);
    });
    head.appendChild(title);

    const sub = el('div', 'insp-sub');
    const chip = el('span', 'insp-cat');
    chip.style.setProperty('--c', cat.color);
    chip.append(el('i', null, cat.icon), document.createTextNode(cat.label));
    const code = el('code', 'insp-type', node.type);
    code.title = def.desc || node.type;
    sub.append(chip, code);
    head.appendChild(sub);

    const bypassRow = el('label', 'insp-bypass');
    const bypass = el('input');
    bypass.type = 'checkbox';
    bypass.checked = !!node.bypass;
    bypass.addEventListener('change', () => ctx.setBypass(nodeId, bypass.checked));
    bypassRow.append(bypass, el('span', 'insp-bypass-label', 'Bypass this node'));
    bypassRow.title = def.bypassInput
      ? `Bypassed: "${def.bypassInput}" passes straight through.`
      : 'Bypassed nodes are skipped by the renderer.';
    head.appendChild(bypassRow);
    body.appendChild(head);

    if (def.missing) {
      const warn = el('div', 'insp-warning', `This node type is not installed — nothing can be edited.`);
      body.appendChild(warn);
      return;
    }

    // ---- ports & wiring ---------------------------------------------
    const ports = (def.inputs || []).concat(def.outputs || []);
    if (ports.length) {
      const section = el('div', 'insp-section');
      section.appendChild(sectionTitle('Ports & wiring'));
      for (const inp of def.inputs || []) section.appendChild(portRow(node, def, inp, 'in'));
      for (const outp of def.outputs || []) section.appendChild(portRow(node, def, outp, 'out'));
      body.appendChild(section);
    }

    // ---- parameters ---------------------------------------------------
    const withWidgets = (def.inputs || []).filter((i) => i.widget && !i.hidden);
    const section = el('div', 'insp-section');
    section.appendChild(sectionTitle('Parameters'));
    if (!withWidgets.length) {
      section.appendChild(el('div', 'insp-note', 'This node has no settings — wire its inputs instead.'));
    }
    for (const inp of withWidgets) {
      section.appendChild(paramRow(node, inp));
    }
    body.appendChild(section);
  }

  function sectionTitle(text) {
    return el('div', 'insp-section-title', text);
  }

  function portRow(node, def, port, dir) {
    const wired = dir === 'in' ? ctx.graph.incoming(node.id, port.key) : ctx.graph.outgoing(node.id, port.key);
    const row = el('div', `insp-port ${dir}${wired.length ? ' wired' : ''}`);
    const dot = el('span', 'insp-dot');
    dot.style.setProperty('--pc', portColor(port.type));
    if (port.multi) dot.classList.add('multi');
    const label = el('span', 'insp-port-label', port.label || port.key);
    const type = el('code', 'insp-port-type', port.type || 'any');
    type.title = portLabel(port.type);
    row.append(dot, label, type);

    if (dir === 'in') {
      if (wired.length) {
        const link = wired[0];
        const src = ctx.graph.getNode(link.from);
        const srcDef = safeDef(src ? src.type : null);
        const from = el('span', 'insp-port-from', `← ${src ? src.title || srcDef.label : '?'}`);
        from.title = 'Driven by a connection';
        row.appendChild(from);
        if (port.multi && wired.length > 1) row.appendChild(el('span', 'insp-port-more', `+${wired.length - 1}`));
        const x = el('button', 'insp-port-x', '✕');
        x.type = 'button';
        x.title = 'Disconnect this input';
        x.addEventListener('click', () => ctx.disconnectInput(node.id, port.key));
        row.appendChild(x);
      } else {
        row.appendChild(el('span', 'insp-port-idle', port.widget ? 'free' : 'not wired'));
      }
    } else if (wired.length) {
      row.appendChild(el('span', 'insp-port-from', `→ ${wired.length} wire${wired.length === 1 ? '' : 's'}`));
    } else {
      row.appendChild(el('span', 'insp-port-idle', 'unwired'));
    }
    return row;
  }

  function paramRow(node, inp) {
    const wired = ctx.graph.incoming(node.id, inp.key).length > 0;
    const row = el('div', `insp-row${wired ? ' driven' : ''}`);
    row.dataset.key = inp.key;

    const head = el('div', 'insp-row-head');
    const dot = el('span', 'insp-dot');
    dot.style.setProperty('--pc', portColor(inp.type));
    const label = el('span', 'insp-label', inp.label || inp.key);
    head.append(dot, label);
    if (wired) {
      const chip = el('span', 'insp-driven', '⛓ driven by connection');
      chip.title = 'This input is driven by a wire. Disconnect it to edit the value.';
      head.appendChild(chip);
    } else if (inp.unit) {
      head.appendChild(el('span', 'insp-unit', inp.unit));
    }
    row.appendChild(head);

    const ctrl = el('div', 'insp-ctrl');
    const widget = createWidget(inp, readParam(node, inp), (value, coalesce) => {
      ctx.setParam(node.id, inp.key, value, { coalesce });
    }, 'full');
    if (widget) {
      ctrl.appendChild(widget.el);
      widget.setDisabled(wired);
      widgets.set(inp.key, widget);
    }
    row.appendChild(ctrl);
    return row;
  }

  // ------------------------------------------------------------- refresh

  function refreshValue(nodeId, key) {
    if (shownNode !== nodeId) return;
    const w = widgets.get(key);
    const node = ctx.graph.getNode(nodeId);
    if (!w || !w.set || !node) return;
    const def = safeDef(node.type);
    const inp = (def.inputs || []).find((i) => i.key === key);
    if (inp) w.set(readParam(node, inp));
  }

  function destroy() {
    clear();
  }

  return { render, refreshValue, destroy };
}

export { escapeHtml };
