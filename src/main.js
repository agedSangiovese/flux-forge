/**
 * Flux Forge — application shell.
 *
 * Owns the document lifecycle (graph + history + autosave), the evaluation
 * loop, the toolbar, keyboard shortcuts and the export pipeline. The node
 * editor and the three.js preview are treated as opaque panels that talk to
 * this file through the small APIs documented in editor/index.js and
 * render/index.js.
 */

import './styles/base.css';
import './styles/graph.css';

import { Graph } from './core/Graph.js';
import { History } from './core/History.js';
import { engine } from './core/Engine.js';
import { installNodes } from './nodes/index.js';
import { createEditor } from './editor/index.js';
import { createPreview } from './render/index.js';
import { PRESETS } from './presets/index.js';

// ------------------------------------------------------------------ bootstrap

installNodes();

const STORAGE_KEY = 'fluxforge.doc.v1';
const THEME_KEY = 'fluxforge.theme';

const $ = (id) => document.getElementById(id);

const els = {
  viewport: $('viewport'),
  world: $('world'),
  wireLayer: $('wire-layer'),
  minimapCanvas: $('minimap-canvas'),
  marquee: $('marquee'),
  emptyState: $('empty-state'),
  inspectorBody: $('inspector-body'),
  ctxMenu: $('ctx-menu'),
  searchModal: $('palette-modal'),
  searchInput: $('node-search-input'),
  searchResults: $('node-search-results'),
  statusLeft: $('status-left'),
  statusNodes: $('status-nodes'),
  statusZoom: $('status-zoom'),
  statusFps: $('status-fps'),
  previewHost: $('preview-host'),
  previewCanvas: $('preview-canvas'),
  previewOverlay: $('preview-overlay'),
  previewTris: $('preview-tris'),
  previewMsg: $('preview-msg'),
  presetsModal: $('presets-modal'),
  presetsGrid: $('presets-grid'),
  helpModal: $('help-modal'),
  helpBody: $('help-body'),
  exportMenu: $('export-menu'),
  toastStack: $('toast-stack'),
  paletteInput: $('palette-input'),
  paletteList: $('palette-list'),
  graphPane: $('graph-pane'),
  side: $('side'),
  inspector: $('inspector'),
  splitter: $('splitter'),
  splitterH: $('splitter-h'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
};

// -------------------------------------------------------------------- toasts

function toast(message, kind = 'info', ms = 2800) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  els.toastStack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// ------------------------------------------------------------------- document

let graph = null;
let history = null;
let bootOrigin = 'fresh';
let time = 0;
let playing = true;
let engineHasDynamic = false;
let evaluateQueued = false;
let pendingForced = false;
let lastStats = null;

// The document and its history must exist before the panels are constructed.
bootOrigin = loadInitialDocument();
history = new History(graph);

function loadInitialDocument() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (err) {
    console.warn('[autosave] could not read', err);
  }

  const fallbackId = PRESETS.some((p) => p.id === 'starter') ? 'starter' : PRESETS[0]?.id;
  const fallback = PRESETS.find((p) => p.id === fallbackId);

  if (data && Array.isArray(data.nodes) && data.nodes.length) {
    graph = new Graph(data);
    return 'restored';
  }
  graph = new Graph(fallback ? fallback.graph() : null);
  return 'fresh';
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph.toJSON()));
    } catch (err) {
      console.warn('[autosave] failed', err);
    }
  }, 700);
}

// ------------------------------------------------------------------ evaluation

function scheduleEvaluate(force = false) {
  pendingForced = pendingForced || force;
  if (evaluateQueued) return;
  evaluateQueued = true;
  requestAnimationFrame(() => {
    evaluateQueued = false;
    runEvaluate();
  });
}

function runEvaluate() {
  const force = pendingForced;
  pendingForced = false;

  const started = performance.now();
  let result;
  try {
    result = engine.evaluate(graph, { time });
  } catch (err) {
    console.error('[engine] crashed', err);
    preview.setStatus({ error: err.message || String(err) });
    return;
  }
  lastStats = result;
  engineHasDynamic = result.dynamicCount > 0;

  preview.setScene(result.scene, force);
  preview.setStatus({ error: result.scene ? null : describeFailure(result) });

  // Surface node-level problems without shouting about pure cache hits.
  const firstError = [...result.errors.values()][0];
  els.previewMsg.textContent = firstError ? `⚠ ${firstError}` : '';
  els.previewMsg.classList.toggle('bad', !!firstError);

  if (editor) editor.setErrors(result.errors, result.warnings);

  const ms = performance.now() - started;
  els.statusLeft.textContent = firstError
    ? 'error'
    : `${result.evaluated} evaluated · ${result.cached} cached · ${ms.toFixed(1)} ms`;
  els.statusLeft.classList.toggle('bad', !!firstError);
}

function describeFailure(result) {
  if (result.reason === 'no-output') {
    return 'Nothing is wired into a Render node yet.';
  }
  return result.errors.get(graph.outputNode()?.id) || 'This graph could not be rendered.';
}

// --------------------------------------------------------------------- preview

const preview = createPreview({
  canvas: els.previewCanvas,
  overlayEl: els.previewOverlay,
  triEl: els.previewTris,
  onFrame: (elapsed) => {
    time = elapsed;
    if (playing && engineHasDynamic) runEvaluate();
  },
  onFps: (fps) => {
    els.statusFps.textContent = `${Math.round(fps)} fps`;
  },
});

// --------------------------------------------------------------------- editor

const editor = createEditor({
  viewport: els.viewport,
  world: els.world,
  wireLayer: els.wireLayer,
  minimapCanvas: els.minimapCanvas,
  marquee: els.marquee,
  emptyState: els.emptyState,
  inspectorBody: els.inspectorBody,
  ctxMenu: els.ctxMenu,
  searchModal: els.searchModal,
  searchInput: els.searchInput,
  searchResults: els.searchResults,
  paletteInput: els.paletteInput,
  paletteList: els.paletteList,
  graph,
  history,
  toast,
  onSelectionChange: updateToolbar,
  onZoom: (zoom) => {
    els.statusZoom.textContent = `${Math.round(zoom * 100)}%`;
  },
  onEdit: (label, coalesce) => {
    history.push(label, coalesce);
    scheduleEvaluate();
    scheduleAutosave();
    updateToolbar();
  },
});

// --------------------------------------------------------------- graph events

function bindGraph() {
  graph.on((reason) => {
    if (reason === 'history') return; // handled by history listener
    scheduleEvaluate();
    scheduleAutosave();
    updateToolbar();
    const n = graph.nodes.length;
    els.statusNodes.textContent = `${n} node${n === 1 ? '' : 's'}`;
    els.emptyState.classList.toggle('hidden', n > 0);
  });
}

history.on((_, reason) => {
  // An ordinary edit ('push') only recorded a *pre-edit* snapshot — the
  // caller refreshes its own DOM immediately after, and a full rebuild here
  // would destroy whatever the user is mid-gesture on (slider handles, the
  // node being dragged, an open rename field). Only undo/redo ('restore')
  // swaps the whole document behind the editor's back.
  if (reason === 'restore') {
    editor.sync();
    engine.invalidate();
    scheduleEvaluate(true);
  }
  scheduleAutosave();
  updateToolbar();
});

function updateToolbar() {
  els.btnUndo.disabled = !history.canUndo;
  els.btnRedo.disabled = !history.canRedo;
}

// ------------------------------------------------------------------- toolbar

function replaceDocument(json, label) {
  graph.fromJSON(json);
  graph.changed('load');
  engine.invalidate();
  editor.sync();
  editor.frameAll();
  history.clear();
  history.push('load');
  scheduleEvaluate(true);
  scheduleAutosave();
  if (label) toast(label);
}

function wireToolbar() {
  $('btn-undo').addEventListener('click', () => history.undo());
  $('btn-redo').addEventListener('click', () => history.redo());
  $('btn-add-node').addEventListener('click', () => editor.openSearch());
  $('btn-frame').addEventListener('click', () => editor.frameAll());
  $('btn-bypass').addEventListener('click', () => editor.bypassSelection());
  $('btn-group').addEventListener('click', () => editor.groupSelection());
  $('btn-save').addEventListener('click', exportJSON);
  $('btn-load').addEventListener('click', importJSON);
  $('btn-presets').addEventListener('click', openPresets);
  $('btn-export-png').addEventListener('click', () => exportPNG(1));
  $('btn-export-menu').addEventListener('click', (e) => toggleExportMenu(e));
  $('btn-help').addEventListener('click', openHelp);
  $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-delete-node').addEventListener('click', () => editor.deleteSelection());
  $('btn-reset-cam').addEventListener('click', () => {
    preview.resetCamera();
    toast('Camera reset');
  });
  $('btn-anim').addEventListener('click', togglePlay);
  $('btn-fullscreen').addEventListener('click', toggleFullscreen);

  $('empty-add').addEventListener('click', () => editor.openSearch());
  $('empty-preset').addEventListener('click', openPresets);
}

// ------------------------------------------------------------------- playback

function togglePlay() {
  playing = !playing;
  preview.setPlaying(playing);
  const btn = $('btn-anim');
  btn.textContent = playing ? '||' : '>';
  btn.title = playing ? 'Pause animation' : 'Play animation';
  if (playing) scheduleEvaluate(true);
}

function toggleFullscreen() {
  const el = $('preview');
  if (!document.fullscreenElement) el.requestFullscreen?.().then(() => preview.resize()).catch(() => {});
  else document.exitFullscreen?.().then(() => preview.resize()).catch(() => {});
}

// --------------------------------------------------------------------- theme

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(`${next[0].toUpperCase()}${next.slice(1)} theme`);
  scheduleEvaluate(true);
}

// ------------------------------------------------------------------ file I/O

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function safeName() {
  return (graph.meta.name || 'flux-forge').replace(/[^\w.-]+/g, '-').toLowerCase();
}

function exportJSON() {
  const json = JSON.stringify(graph.toJSON(), null, 2);
  download(new Blob([json], { type: 'application/json' }), `${safeName()}.json`);
  toast('Graph saved', 'ok');
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = JSON.parse(text);
        replaceDocument(data, `Loaded ${file.name}`);
      } catch (err) {
        toast(`Could not load that file: ${err.message}`, 'err', 4200);
      }
    });
  });
  input.click();
}

// -------------------------------------------------------------------- exports

async function exportPNG(scale = 1) {
  try {
    const blob = await preview.screenshot({ scale, type: 'image/png' });
    download(blob, `${safeName()}@${scale}x.png`);
    toast(`Exported ${Math.round(scale * 100)}% PNG`, 'ok');
  } catch (err) {
    toast(`PNG export failed: ${err.message}`, 'err', 4200);
  }
}

async function exportGLTF(binary) {
  try {
    const blob = await preview.exportGLTF({ binary });
    download(blob, `${safeName()}${binary ? '.glb' : '.gltf'}`);
    toast(`Exported ${binary ? 'GLB' : 'glTF'}`, 'ok');
  } catch (err) {
    toast(`3D export failed: ${err.message}`, 'err', 4200);
  }
}

function toggleExportMenu(evt) {
  const menu = els.exportMenu;
  if (!menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    return;
  }
  const items = [
    ['PNG · 1×', () => exportPNG(1)],
    ['PNG · 2×', () => exportPNG(2)],
    ['PNG · 4×', () => exportPNG(4)],
    ['glTF (JSON)', () => exportGLTF(false)],
    ['GLB (binary)', () => exportGLTF(true)],
    ['Graph JSON', exportJSON],
  ];
  menu.innerHTML = '';
  for (const [label, fn] of items) {
    const b = document.createElement('button');
    b.className = 'menu-item';
    b.textContent = label;
    b.addEventListener('click', () => {
      menu.classList.add('hidden');
      fn();
    });
    menu.appendChild(b);
  }
  const r = evt.currentTarget.getBoundingClientRect();
  menu.style.left = `${Math.max(8, r.left)}px`;
  menu.style.top = `${r.bottom + 6}px`;
  menu.classList.remove('hidden');
}

// -------------------------------------------------------------------- presets

function openPresets() {
  els.presetsGrid.innerHTML = '';
  for (const preset of PRESETS) {
    const card = document.createElement('button');
    card.className = 'preset-card';
    card.innerHTML = `
      <span class="preset-swatch" style="--sw:${preset.color || '#38bdf8'}"></span>
      <span class="preset-title">${escapeHtml(preset.title)}</span>
      <span class="preset-blurb">${escapeHtml(preset.blurb)}</span>
      <span class="preset-meta">${preset.nodes ?? '?'} nodes · ${preset.category || 'art'}</span>`;
    card.addEventListener('click', () => {
      closeModals();
      replaceDocument(preset.graph(), `Loaded “${preset.title}”`);
    });
    els.presetsGrid.appendChild(card);
  }
  els.presetsModal.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ----------------------------------------------------------------------- help

const SHORTCUTS = [
  ['Tab / Ctrl+K', 'Open node search'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'],
  ['Ctrl+S', 'Save graph as JSON'],
  ['Ctrl+E', 'Export a 1× PNG'],
  ['Delete / Backspace', 'Delete selection'],
  ['Ctrl+G', 'Group selection'],
  ['Ctrl+Shift+G', 'Ungroup'],
  ['B', 'Bypass the selected node'],
  ['F', 'Frame every node'],
  ['A', 'Select every node'],
  ['Esc', 'Deselect / close dialog'],
  ['Space', 'Pause or resume time'],
  ['H / ?', 'This help panel'],
  ['P', 'Preset gallery'],
  ['1 / 2', 'Preview: reset camera / re-frame object'],
];

function openHelp() {
  const rows = SHORTCUTS.map(([k, d]) => `<dt><kbd>${escapeHtml(k)}</kbd></dt><dd>${escapeHtml(d)}</dd>`).join('');
  els.helpBody.innerHTML = `
    <h4>Keyboard</h4>
    <dl class="shortcuts">${rows}</dl>
    <h4>Building a graph</h4>
    <ol class="help-steps">
      <li>Add a <b>Shape</b> — that's your starting mesh.</li>
      <li>Add a <b>Field</b> like Noise, then a <b>Displace</b> to sculpt it.</li>
      <li>Feed the field into a <b>Colour Ramp</b>, then into a <b>Standard Material</b>.</li>
      <li>Wire shape and material into <b>Render</b>.</li>
    </ol>
    <p class="help-note">Every knob is also a socket — drag from the dot on the left of any
    parameter to drive it with a pattern instead of a fixed value.</p>`;
  els.helpModal.classList.remove('hidden');
}

function closeModals() {
  for (const m of [els.presetsModal, els.helpModal, els.searchModal]) m.classList.add('hidden');
  els.exportMenu.classList.add('hidden');
}

// ------------------------------------------------------------------ shortcuts

function isTyping() {
  const t = document.activeElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function onKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;

  if (key === 'Escape') {
    closeModals();
    editor.closeMenus?.();
    if (!isTyping()) editor.clearSelection();
    return;
  }

  if (mod && (key === 'z' || key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if (mod && (key === 'y' || key === 'Y')) {
    e.preventDefault();
    history.redo();
    return;
  }
  if (mod && key === 's') {
    e.preventDefault();
    exportJSON();
    return;
  }
  if (mod && key === 'e') {
    e.preventDefault();
    exportPNG(1);
    return;
  }
  if (mod && key === 'k') {
    e.preventDefault();
    editor.openSearch();
    return;
  }
  if (mod && (key === 'g' || key === 'G')) {
    e.preventDefault();
    if (e.shiftKey) editor.ungroupSelection();
    else editor.groupSelection();
    return;
  }

  if (isTyping()) return;

  switch (key) {
    case 'Tab':
      e.preventDefault();
      editor.openSearch();
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      editor.deleteSelection();
      break;
    case 'b':
    case 'B':
      editor.bypassSelection();
      break;
    case 'f':
    case 'F':
      editor.frameAll();
      break;
    case 'a':
    case 'A':
      editor.selectAll();
      break;
    case 'h':
    case 'H':
    case '?':
      openHelp();
      break;
    case 'p':
    case 'P':
      openPresets();
      break;
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case '1':
      preview.resetCamera();
      break;
    case '2':
      preview.frameObject();
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------- splitters

function setupSplitters() {
  const root = document.documentElement;
  const apply = (sidePct, inspectorPct) => {
    root.style.setProperty('--side-width', `${Math.round(sidePct)}%`);
    root.style.setProperty('--inspector-height', `${Math.round(inspectorPct)}%`);
    preview.resize();
    editor.requestFrame?.();
  };

  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem('fluxforge.layout') || 'null');
    } catch {
      return null;
    }
  })();
  if (stored) apply(stored.side ?? 34, stored.inspector ?? 45);

  const save = () => {
    const side = parseFloat(getComputedStyle(root).getPropertyValue('--side-width')) || 34;
    const insp = parseFloat(getComputedStyle(root).getPropertyValue('--inspector-height')) || 45;
    try {
      localStorage.setItem('fluxforge.layout', JSON.stringify({ side, inspector: insp }));
    } catch {
      /* ignore */
    }
  };

  const drag = (handle, axis) => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const rect = $('main').getBoundingClientRect();
      const move = (ev) => {
        if (axis === 'x') {
          const pct = ((rect.right - ev.clientX) / rect.width) * 100;
          apply(clampNum(pct, 20, 60), parseFloat(getComputedStyle(root).getPropertyValue('--inspector-height')) || 45);
        } else {
          const sideRect = els.side.getBoundingClientRect();
          const pct = ((ev.clientY - sideRect.top) / sideRect.height) * 100;
          const side = parseFloat(getComputedStyle(root).getPropertyValue('--side-width')) || 34;
          apply(side, clampNum(pct, 25, 75));
        }
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        save();
        preview.resize();
        editor.requestFrame?.();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  };

  drag(els.splitter, 'x');
  drag(els.splitterH, 'y');
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ----------------------------------------------------------------------- misc

function dismissEmptyState() {
  const n = graph.nodes.length;
  els.emptyState.classList.toggle('hidden', n > 0);
}

function boot() {
  const storedTheme = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  })();
  applyTheme(storedTheme || 'dark');

  bindGraph();
  wireToolbar();
  setupSplitters();

  history.push('open');
  updateToolbar();

  editor.sync();
  editor.frameAll();
  scheduleEvaluate(true);
  dismissEmptyState();

  els.statusNodes.textContent = `${graph.nodes.length} nodes`;
  els.statusZoom.textContent = `${Math.round(graph.view.zoom * 100)}%`;

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    preview.resize();
    editor.requestFrame?.();
  });
  document.addEventListener('click', (e) => {
    // ✕ buttons (`data-close`) and clicks on the dimmed backdrop both dismiss
    // the open dialog — Esc alone is too easy to miss.
    if (e.target.closest?.('[data-close]') || e.target.classList?.contains('modal')) {
      closeModals();
      editor.closeMenus?.();
    }
    if (!els.exportMenu.contains(e.target) && !e.target.closest('#btn-export-menu')) {
      els.exportMenu.classList.add('hidden');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    preview.resize();
    editor.requestFrame?.();
  });

  if (bootOrigin === 'fresh') toast('Welcome — a starter artwork is loaded. Press P for more.', 'ok', 5200);
  else toast('Restored your last session', 'info', 2400);
}

boot();
