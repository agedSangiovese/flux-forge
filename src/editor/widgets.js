/**
 * Inline + inspector controls for the manifest's `widget` types.
 *
 * Every widget follows the same contract:
 *
 *   const w = createWidget(input, value, onChange, size)
 *   w.el            // element to place in the DOM
 *   w.set(v)        // adopt an external value (skipped while the user is in it)
 *   w.setDisabled(b) // grey out / lock, used when the input is wired
 *
 * `onChange(value, coalesce)` is called *after* the user changed something; the
 * caller owns history (it pushes `onEdit` before writing to the graph).
 * `size` is 'inline' (compact, inside a node row) or 'full' (inspector).
 */

import { el, svgEl, clamp, fmtNum, normHex, normStops, gradientCss, sampleStops } from './util.js';
import { normKeys, sampleCurve, keyRange, KEY_EASES } from '../core/curves.js';

export function createWidget(input, value, onChange, size = 'inline') {
  switch (input.widget) {
    case 'slider':
      return sliderWidget(input, value, onChange, size);
    case 'float':
      return numberWidget(input, value, onChange, size, false);
    case 'int':
      return numberWidget(input, value, onChange, size, true);
    case 'toggle':
      return toggleWidget(input, value, onChange, size);
    case 'select':
      return selectWidget(input, value, onChange, size);
    case 'color':
      return colorWidget(input, value, onChange, size);
    case 'text':
      return textWidget(input, value, onChange, size);
    case 'gradient':
      return gradientWidget(input, value, onChange, size);
    case 'curve':
      return curveWidget(input, value, onChange, size);
    case 'file':
      return fileWidget(input, value, onChange, size);
    default:
      return null;
  }
}

function guardSet(host, fn) {
  return (v) => {
    if (host && host.isConnected && host.contains(document.activeElement)) return;
    fn(v);
  };
}

// ---------------------------------------------------------------------- slider

function sliderWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-slider ${size}`);
  const range = el('input');
  range.type = 'range';
  range.min = String(input.min ?? 0);
  range.max = String(input.max ?? 1);
  range.step = String(input.step ?? 0.01);
  const readout = el('span', 'wg-readout');
  wrap.append(range, readout);

  const paint = (v) => {
    const n = Number(v);
    range.value = String(Number.isFinite(n) ? n : 0);
    readout.textContent = `${fmtNum(range.value, input.step)}${input.unit ? input.unit : ''}`;
  };
  paint(value);

  range.addEventListener('input', () => {
    paint(range.value);
    onChange(Number(range.value), true);
  });
  if (size === 'full') {
    range.addEventListener('dblclick', () => {
      const d = Number(input.default ?? 0);
      onChange(d, false);
      paint(d);
    });
    readout.title = 'Double-click to reset to the default';
  }

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, range, b) };
}

// ---------------------------------------------------------------------- number

function numberWidget(input, value, onChange, size, integral) {
  const wrap = el('div', `wg wg-number ${size}`);
  const box = el('input');
  box.type = 'number';
  box.step = integral ? '1' : input.step != null ? String(input.step) : 'any';
  if (input.min != null) box.min = String(input.min);
  if (input.max != null) box.max = String(input.max);
  if (size === 'full') box.placeholder = String(input.default ?? 0);
  wrap.appendChild(box);

  const paint = (v) => {
    const n = Number(v);
    box.value = Number.isFinite(n) ? (integral ? String(Math.round(n)) : String(n)) : '';
  };
  paint(value);

  box.addEventListener('input', () => {
    const n = parseFloat(box.value);
    if (!Number.isFinite(n)) return;
    onChange(integral ? Math.round(n) : n, true);
  });
  box.addEventListener('blur', () => paint(box.value === '' ? input.default ?? 0 : box.value));

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, box, b) };
}

// ---------------------------------------------------------------------- toggle

function toggleWidget(input, value, onChange, size) {
  const wrap = el('label', `wg wg-toggle ${size}`);
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!Number(value);
  const track = el('span', 'wg-track');
  const knob = el('span', 'wg-knob');
  track.appendChild(knob);
  wrap.append(box, track);

  box.addEventListener('change', () => onChange(box.checked ? 1 : 0, false));
  const paint = (v) => {
    box.checked = !!Number(v);
  };

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, box, b) };
}

// ---------------------------------------------------------------------- select

function selectWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-select ${size}`);
  const box = el('select');
  const options = Array.isArray(input.options) ? input.options : [];
  for (const opt of options) {
    const o = el('option');
    if (opt && typeof opt === 'object') {
      o.value = String(opt.value);
      o.textContent = String(opt.label ?? opt.value);
    } else {
      o.value = String(opt);
      o.textContent = String(opt);
    }
    box.appendChild(o);
  }
  wrap.appendChild(box);

  const paint = (v) => {
    const s = String(v);
    const has = Array.from(box.options).some((o) => o.value === s);
    box.value = has ? s : (box.options[0] ? box.options[0].value : '');
  };
  paint(value);

  box.addEventListener('change', () => {
    const raw = box.value;
    const match = options.find((opt) =>
      opt && typeof opt === 'object' ? String(opt.value) === raw : String(opt) === raw
    );
    const out = match && typeof match === 'object' ? match.value : raw;
    onChange(out, false);
  });

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, box, b) };
}

// ---------------------------------------------------------------------- colour

function colorWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-color ${size}`);
  const picker = el('input');
  picker.type = 'color';
  const hex = el('input');
  hex.type = 'text';
  hex.className = 'wg-hex';
  hex.spellcheck = false;
  wrap.append(picker, hex);

  const paint = (v) => {
    const h = normHex(v);
    picker.value = h;
    hex.value = h;
  };
  paint(value);

  picker.addEventListener('input', () => {
    hex.value = picker.value;
    onChange(picker.value, true);
  });
  hex.addEventListener('input', () => {
    const raw = hex.value.trim();
    if (!/^#?[0-9a-f]{6}$/i.test(raw)) return;
    const h = normHex(raw);
    picker.value = h;
    onChange(h, true);
  });
  hex.addEventListener('blur', () => paint(hex.value));

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, picker, b) };
}

// ----------------------------------------------------------------------- text

function textWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-text ${size}`);
  const box = el('input');
  box.type = 'text';
  box.spellcheck = false;
  box.placeholder = String(input.default ?? '');
  wrap.appendChild(box);

  const paint = (v) => {
    box.value = v == null ? '' : String(v);
  };
  paint(value);

  box.addEventListener('input', () => onChange(box.value, true));

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, box, b) };
}

// ------------------------------------------------------------------- gradient

function gradientWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-gradient ${size}`);
  const bar = el('div', 'grad-bar');
  const handles = el('div', 'grad-handles');
  bar.appendChild(handles);
  wrap.appendChild(bar);

  const full = size === 'full';
  const list = full ? el('div', 'grad-list') : null;
  if (list) wrap.appendChild(list);

  const fallback = normStops(input.default, null);
  let stops = normStops(value, fallback);
  let handleEls = [];
  let rowEls = [];

  const snapshot = () => stops.map((s) => ({ t: s.t, c: s.c }));

  function commit(coalesce) {
    onChange(snapshot(), coalesce);
  }

  function syncHandles() {
    if (handleEls.length === stops.length) return;
    handles.textContent = '';
    handleEls = stops.map((_, i) => {
      const h = el('button', 'grad-stop');
      h.type = 'button';
      h.title = 'Drag to move · double-click to remove';
      h.addEventListener('pointerdown', (e) => startStopDrag(e, i, h));
      h.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (stops.length <= 2) return;
        stops = stops.filter((_, j) => j !== i);
        paint();
        commit(false);
      });
      handles.appendChild(h);
      return h;
    });
  }

  function syncRows() {
    if (!list) return;
    if (rowEls.length === stops.length) return;
    list.textContent = '';
    rowEls = stops.map((_, i) => {
      const row = el('div', 'grad-row');
      const swatch = el('input');
      swatch.type = 'color';
      swatch.title = 'Stop colour';
      const pos = el('input');
      pos.type = 'number';
      pos.step = '0.01';
      pos.min = '0';
      pos.max = '1';
      pos.title = 'Stop position 0…1';
      const rm = el('button', 'grad-rm', '✕');
      rm.type = 'button';
      rm.title = 'Remove this stop';

      swatch.addEventListener('input', () => {
        stops[i].c = normHex(swatch.value);
        paint();
        commit(true);
      });
      pos.addEventListener('input', () => {
        const v = parseFloat(pos.value);
        if (!Number.isFinite(v)) return;
        stops[i].t = clamp(v, 0, 1);
        paint();
        commit(true);
      });
      pos.addEventListener('change', () => {
        stops.sort((a, b) => a.t - b.t);
        paint();
        commit(false);
      });
      rm.addEventListener('click', () => {
        if (stops.length <= 2) return;
        stops = stops.filter((_, j) => j !== i);
        paint();
        commit(false);
      });

      row.append(swatch, pos, rm);
      list.appendChild(row);
      return { row, swatch, pos };
    });
  }

  function paint() {
    bar.style.background = gradientCss(stops);
    syncHandles();
    stops.forEach((s, i) => {
      const h = handleEls[i];
      if (!h) return;
      h.style.left = `${clamp(s.t, 0, 1) * 100}%`;
      h.style.setProperty('--sw', s.c);
    });
    if (!list) return;
    syncRows();
    stops.forEach((s, i) => {
      const r = rowEls[i];
      if (!r) return;
      if (document.activeElement !== r.swatch) r.swatch.value = s.c;
      if (document.activeElement !== r.pos) r.pos.value = s.t.toFixed(2);
    });
  }

  function tFromEvent(clientX) {
    const r = bar.getBoundingClientRect();
    if (!r.width) return 0;
    return clamp((clientX - r.left) / r.width, 0, 1);
  }

  function startStopDrag(e, index, handle) {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev) => {
      moved = true;
      stops[index].t = tFromEvent(ev.clientX);
      paint();
      commit(true);
    };
    const up = (ev) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      if (moved) {
        stops.sort((a, b) => a.t - b.t);
        paint();
        commit(false);
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  bar.addEventListener('pointerdown', (e) => {
    if (e.target !== bar && e.target !== handles) return;
    e.preventDefault();
    const t = tFromEvent(e.clientX);
    const c = sampleStops(stops, t);
    stops.push({ t, c });
    stops.sort((a, b) => a.t - b.t);
    paint();
    commit(false);
  });

  bar.title = 'Click to add a stop · drag a stop · double-click a stop to remove';
  paint();

  return {
    el: wrap,
    set: (v) => {
      stops = normStops(v, fallback);
      paint();
    },
    setDisabled: (b) => {
      wrap.classList.toggle('disabled', !!b);
      bar.style.pointerEvents = b ? 'none' : '';
      for (const r of rowEls) {
        r.swatch.disabled = !!b;
        r.pos.disabled = !!b;
      }
    },
  };
}

// ------------------------------------------------------------------ keyframes

function curveWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-curve ${size}`);
  const plot = el('div', 'cv-plot');

  // The plot is SVG so the curve line scales with the box while the handles
  // stay crisp HTML dots on top; the 100×100 viewBox lets one set of
  // percentage-style coordinates drive both layers.
  const svg = svgEl('svg', {
    class: 'cv-svg',
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
  });
  const grid = svgEl('path', { class: 'cv-grid' });
  const line = svgEl('polyline', { class: 'cv-line', points: '' });
  svg.appendChild(grid);
  svg.appendChild(line);
  const handles = el('div', 'cv-handles');
  plot.appendChild(svg);
  plot.appendChild(handles);
  wrap.appendChild(plot);

  const full = size === 'full';
  const list = full ? el('div', 'cv-list') : null;
  if (list) wrap.appendChild(list);

  const fallback = normKeys(input.default);
  let keys = normKeys(value, fallback);
  let handleEls = [];
  let rowEls = [];
  let disabled = false;
  // Frozen view while a handle is dragged: the plot must not rescale under
  // the cursor, so the domains are captured at drag start and released after.
  let view = null;

  function commit(coalesce) {
    onChange(keys.map((k) => ({ t: k.t, v: k.v, ease: k.ease })), coalesce);
  }

  function computeView() {
    let tMax = 0;
    for (const k of keys) if (k.t > tMax) tMax = k.t;
    // A quarter of empty timeline at the right: room to drag the last key
    // further out or click a new key beyond the current end.
    tMax = tMax > 0 ? tMax * 1.25 : 1;
    return { tMax, ...keyRange(keys) };
  }

  function syncHandles() {
    if (handleEls.length === keys.length) return;
    handles.textContent = '';
    handleEls = keys.map((_, i) => {
      const dot = el('button', 'cv-dot');
      dot.type = 'button';
      dot.title = 'Drag to shape · double-click to remove';
      dot.addEventListener('pointerdown', (e) => startKeyDrag(e, i, dot));
      dot.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (keys.length <= 2) return;
        keys = keys.filter((_, j) => j !== i);
        paint();
        commit(false);
      });
      handles.appendChild(dot);
      return dot;
    });
  }

  function syncRows() {
    if (!list) return;
    if (rowEls.length === keys.length) return;
    list.textContent = '';
    rowEls = keys.map((_, i) => {
      const row = el('div', 'cv-row');
      const t = el('input');
      t.type = 'number';
      t.step = '0.05';
      t.min = '0';
      t.title = 'Key time in seconds';
      const v = el('input');
      v.type = 'number';
      v.step = '0.01';
      v.title = 'Value at this key';
      const ease = el('select');
      ease.title = 'How the curve leaves this key';
      for (const kind of KEY_EASES) {
        const opt = el('option');
        opt.value = kind;
        opt.textContent = kind;
        ease.appendChild(opt);
      }
      const rm = el('button', 'cv-rm', '✕');
      rm.type = 'button';
      rm.title = 'Remove this key';

      t.addEventListener('input', () => {
        const n = parseFloat(t.value);
        if (!Number.isFinite(n)) return;
        keys[i].t = Math.max(0, n);
        paint();
        commit(true);
      });
      t.addEventListener('change', () => {
        keys.sort((a, b) => a.t - b.t);
        paint();
        commit(false);
      });
      v.addEventListener('input', () => {
        const n = parseFloat(v.value);
        if (!Number.isFinite(n)) return;
        keys[i].v = n;
        paint();
        commit(true);
      });
      ease.addEventListener('change', () => {
        keys[i].ease = KEY_EASES.includes(ease.value) ? ease.value : 'linear';
        paint();
        commit(false);
      });
      rm.addEventListener('click', () => {
        if (keys.length <= 2) return;
        keys = keys.filter((_, j) => j !== i);
        paint();
        commit(false);
      });

      row.appendChild(t);
      row.appendChild(v);
      row.appendChild(ease);
      row.appendChild(rm);
      list.appendChild(row);
      return { row, t, v, ease };
    });
  }

  function paint() {
    const { tMax, lo, hi } = view || computeView();
    const span = hi - lo || 1;
    const xOf = (t) => clamp(t / tMax, 0, 1) * 100;
    const yOf = (val) => (1 - (clamp(val, lo, hi) - lo) / span) * 100;
    const sorted = keys.slice().sort((a, b) => a.t - b.t);

    // Dashed reference lines: value zero (when visible) and the window the
    // keys occupy on the timeline.
    let d = '';
    if (0 >= lo && 0 <= hi) d = `M0,${yOf(0)} H100`;
    if (sorted.length) {
      const first = xOf(sorted[0].t);
      const last = xOf(sorted[sorted.length - 1].t);
      d += `${d ? ' ' : ''}M${first},0 V100`;
      if (last !== first) d += ` M${last},0 V100`;
    }
    grid.setAttribute('d', d);

    // The curve itself: walk the segments so corners land exactly on keys.
    const pts = [`0,${yOf(sampleCurve(sorted, 0))}`];
    for (let s = 0; s < sorted.length - 1; s++) {
      const a = sorted[s];
      const b = sorted[s + 1];
      for (let j = 0; j <= 8; j++) {
        const t = a.t + ((b.t - a.t) * j) / 8;
        pts.push(`${xOf(t)},${yOf(sampleCurve(sorted, t))}`);
      }
    }
    pts.push(`${xOf(tMax)},${yOf(sampleCurve(sorted, tMax))}`);
    line.setAttribute('points', pts.join(' '));

    syncHandles();
    keys.forEach((k, i) => {
      const dot = handleEls[i];
      if (!dot) return;
      dot.style.left = `${xOf(k.t)}%`;
      dot.style.top = `${yOf(k.v)}%`;
    });

    if (!list) return;
    syncRows();
    keys.forEach((k, i) => {
      const r = rowEls[i];
      if (!r) return;
      if (document.activeElement !== r.t) r.t.value = fmtNum(k.t);
      if (document.activeElement !== r.v) r.v.value = fmtNum(k.v);
      r.ease.value = KEY_EASES.includes(k.ease) ? k.ease : 'linear';
    });
  }

  function posFromEvent(clientX, clientY) {
    const r = plot.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const { tMax, lo, hi } = view || computeView();
    const fx = clamp((clientX - r.left) / r.width, 0, 1);
    const fy = clamp((clientY - r.top) / r.height, 0, 1);
    return { t: fx * tMax, v: hi - fy * (hi - lo) };
  }

  function startKeyDrag(e, index, dot) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dot.setPointerCapture(e.pointerId);
    view = computeView(); // freeze — no rescaling under the cursor
    let moved = false;
    const move = (ev) => {
      const p = posFromEvent(ev.clientX, ev.clientY);
      if (!p) return;
      moved = true;
      keys[index].t = p.t;
      keys[index].v = p.v;
      paint();
      commit(true);
    };
    const up = (ev) => {
      dot.removeEventListener('pointermove', move);
      dot.removeEventListener('pointerup', up);
      dot.removeEventListener('pointercancel', up);
      try {
        dot.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      view = null;
      if (moved) {
        keys.sort((a, b) => a.t - b.t);
        paint();
        commit(false);
      }
    };
    dot.addEventListener('pointermove', move);
    dot.addEventListener('pointerup', up);
    dot.addEventListener('pointercancel', up);
  }

  plot.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    if (e.target !== plot && e.target !== handles) return;
    const p = posFromEvent(e.clientX, e.clientY);
    if (!p) return;
    keys.push({ t: p.t, v: p.v, ease: 'smooth' });
    keys.sort((a, b) => a.t - b.t);
    paint();
    commit(false);
  });

  plot.title = 'Click to add a key · drag a handle to shape · double-click a handle to remove';
  paint();

  return {
    el: wrap,
    set: (v) => {
      keys = normKeys(v, fallback);
      view = null;
      paint();
    },
    setDisabled: (b) => {
      disabled = !!b;
      wrap.classList.toggle('disabled', !!b);
      plot.style.pointerEvents = b ? 'none' : '';
      for (const r of rowEls) {
        r.t.disabled = !!b;
        r.v.disabled = !!b;
        r.ease.disabled = !!b;
      }
    },
  };
}

// --------------------------------------------------------------------- shared

function describeFile(value) {
  const s = String(value ?? '');
  if (!s) return 'No file yet';
  if (s.length < 400 && !s.startsWith('data:')) return s.slice(0, 40);
  const kb = Math.round((s.length * 3) / 4 / 1024);
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB ✓` : `${kb} KB ✓`;
}

/**
 * File picker for the external-input nodes (image / video / data file).
 * Images are downscaled to 1024px before they enter the document so
 * save files and undo history stay light; everything else is stored as-is.
 */
function fileWidget(input, value, onChange, size) {
  const wrap = el('div', `wg wg-file ${size}`);
  const btn = el('button', 'file-btn', 'Choose file…');
  btn.type = 'button';
  btn.title = 'Load a file from your computer into this node';
  const info = el('span', 'file-info', describeFile(value));
  const picker = el('input');
  picker.type = 'file';
  if (input.accept) picker.accept = input.accept;
  picker.style.display = 'none';
  wrap.appendChild(btn);
  wrap.appendChild(info);
  wrap.appendChild(picker);

  const full = size === 'full';
  const preview = full ? el('div', 'file-preview') : null;
  if (preview) wrap.appendChild(preview);

  const paint = (v) => {
    info.textContent = describeFile(v);
    if (!preview) return;
    preview.textContent = '';
    const s = String(v ?? '');
    if (!s) {
      preview.appendChild(el('span', 'file-empty', 'Nothing loaded — the node errors until you pick a file.'));
      return;
    }
    const kind = input.fileKind || 'image';
    if (kind === 'video') {
      const vid = el('video');
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.controls = true;
      vid.src = s;
      preview.appendChild(vid);
    } else if (kind === 'data') {
      preview.appendChild(el('pre', 'file-snippet', s.slice(0, 240)));
    } else {
      const img = el('img');
      img.alt = 'Loaded image preview';
      img.src = s;
      preview.appendChild(img);
    }
  };
  paint(value);

  const readChosen = (f) => {
    info.textContent = f.name;
    if ((input.fileKind || 'image') === 'data') {
      const reader = new FileReader();
      reader.onload = () => onChange(String(reader.result ?? ''), false);
      reader.readAsText(f);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      if ((input.fileKind || 'image') === 'image') downscaleImage(url).then((small) => onChange(small, false));
      else onChange(url, false);
    };
    reader.readAsDataURL(f);
  };

  btn.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const f = picker.files && picker.files[0];
    picker.value = '';
    if (f) readChosen(f);
  });

  return { el: wrap, set: guardSet(wrap, paint), setDisabled: (b) => setDisabled(wrap, btn, b) };
}

/** Shrink an image data-URL to 1024px (keeping PNG for alpha, JPEG else). */
function downscaleImage(dataURL) {
  return new Promise((resolve) => {
    const done = (url) => resolve(url);
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const longest = Math.max(img.width, img.height);
          if (longest <= 1024 && dataURL.length < 512 * 1024) return done(dataURL);
          const s = Math.min(1, 1024 / longest);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s));
          c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          done(c.toDataURL(dataURL.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.85));
        } catch {
          done(dataURL);
        }
      };
      img.onerror = () => done(dataURL);
      img.src = dataURL;
    } catch {
      done(dataURL);
    }
  });
}

function setDisabled(wrap, control, disabled) {
  wrap.classList.toggle('disabled', !!disabled);
  control.disabled = !!disabled;
}
