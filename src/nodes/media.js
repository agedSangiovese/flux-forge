/**
 * External file inputs for the 2D workspace — image, text, video and data.
 *
 * Every node returns a texture value: `{ kind: 'texture', texture, width,
 * height }` where `texture` is a real THREE.Texture in the browser and null
 * headless (tests) or until the file finishes loading. The graph never waits:
 * loading fills the texture in place and the preview picks it up on the next
 * frame. An empty File socket is a hard error, like Render with no geometry.
 *
 * Textures are memoised per source in module-level caches (the same recipe as
 * the engine's noise memoisation), so re-evaluation never re-decodes a file.
 */
import * as THREE from 'three';
import { define } from './define.js';

const hasDOM = typeof document !== 'undefined' && typeof Image !== 'undefined';

function describe(src) {
  if (!src) return 'empty';
  const kb = Math.round((String(src).length * 3) / 4 / 1024);
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

// ------------------------------------------------------------------ image

const imageCache = new Map(); // src -> { texture, width, height }

function imageTexture(src) {
  let rec = imageCache.get(src);
  if (!rec) {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    rec = { texture, width: 0, height: 0 };
    imageCache.set(src, rec);
    if (hasDOM) {
      const img = new Image();
      img.onload = () => {
        rec.width = img.width;
        rec.height = img.height;
        texture.image = img;
        texture.needsUpdate = true;
      };
      img.src = src;
    }
  }
  return rec;
}

define('input.image', (ctx, inputs) => {
  const src = String(inputs.src ?? '');
  if (!src) {
    ctx.error('Image has no file yet — pick one with Choose file.');
    return { out: { kind: 'texture', texture: null, width: 0, height: 0, label: 'empty' } };
  }
  const rec = imageTexture(src);
  return { out: { kind: 'texture', texture: rec.texture, width: rec.width, height: rec.height, label: describe(src) } };
});

// ------------------------------------------------------------------- text

const textCache = new Map(); // key -> record (capped below)

function textTexture(text, size, color) {
  const key = JSON.stringify([text, size, color]);
  let rec = textCache.get(key);
  if (!rec) {
    if (textCache.size > 64) textCache.delete(textCache.keys().next().value);
    const texture = hasDOM ? new THREE.CanvasTexture(document.createElement('canvas')) : new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    rec = { texture, width: 0, height: 0 };
    textCache.set(key, rec);
    if (hasDOM) {
      const px = Math.max(8, Math.min(512, Math.round(Number(size) || 128)));
      const cv = texture.image;
      const measure = cv.getContext('2d');
      measure.font = `900 ${px}px system-ui, sans-serif`;
      const w = Math.ceil(measure.measureText(text).width) + px;
      const h = Math.ceil(px * 1.3);
      cv.width = Math.max(2, w);
      cv.height = Math.max(2, h);
      const g = cv.getContext('2d');
      g.font = `900 ${px}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = String(color || '#ffffff');
      g.fillText(text, cv.width / 2, cv.height / 2);
      rec.width = cv.width;
      rec.height = cv.height;
      texture.needsUpdate = true;
    }
  }
  return rec;
}

define('input.text', (ctx, inputs) => {
  const text = String(inputs.text ?? '');
  if (!text) {
    ctx.error('Text Plate is blank — type something into Text.');
    return { out: { kind: 'texture', texture: null, width: 0, height: 0, label: 'empty' } };
  }
  const rec = textTexture(text, inputs.size, ctx.toHex(inputs.color));
  return { out: { kind: 'texture', texture: rec.texture, width: rec.width, height: rec.height, label: `“${text}”` } };
});

// ------------------------------------------------------------------ video

const videoCache = new Map(); // nodeId -> { src, texture, el }

function videoTexture(nodeId, src, loop, muted) {
  let rec = videoCache.get(nodeId);
  if (!rec || rec.src !== src) {
    rec = { src, texture: new THREE.Texture(), el: null };
    videoCache.set(nodeId, rec);
    if (hasDOM) {
      const el = document.createElement('video');
      el.muted = muted !== false;
      el.loop = loop !== false;
      el.playsInline = true;
      el.preload = 'auto';
      el.src = src;
      const play = () => el.play().catch(() => {});
      el.addEventListener('loadeddata', play, { once: true });
      play();
      const texture = new THREE.VideoTexture(el);
      texture.colorSpace = THREE.SRGBColorSpace;
      rec.texture = texture;
      rec.el = el;
    }
  }
  return rec;
}

define('input.video', (ctx, inputs) => {
  const src = String(inputs.src ?? '');
  if (!src) {
    ctx.error('Video has no file yet — pick one with Choose file.');
    return { out: { kind: 'texture', texture: null, width: 0, height: 0, label: 'empty' } };
  }
  if (src.length * 0.75 > 12 * 1024 * 1024) {
    ctx.warn('That video is over 12 MB — the document will be heavy to save.');
  }
  const rec = videoTexture(ctx.node.id, src, inputs.loop, inputs.muted);
  const el = rec.el;
  return {
    out: {
      kind: 'texture',
      texture: rec.texture,
      width: el && el.videoWidth ? el.videoWidth : 0,
      height: el && el.videoHeight ? el.videoHeight : 0,
      label: describe(src),
    },
  };
});

// ------------------------------------------------------------------- data

/**
 * Parse a JSON or CSV/TSV document of numbers into a float RGBA buffer.
 * Values land in the R channel row by row (G is 0, B is 0, A is 1); nested
 * arrays and CSV rows set the width/height, a flat list becomes width × 1.
 */
export function parseDataTable(src) {
  const text = String(src ?? '').trim();
  if (!text) return { error: 'empty' };
  let nums = [];
  let width = 0;
  let height = 0;
  const finish = (flat, w, h) => ({ data: flat, width: w, height: h });

  if (/^[[{]/.test(text)) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: 'not JSON' };
    }
    const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.data ?? parsed.values ?? [] : parsed;
    if (!Array.isArray(root) || !root.length) return { error: 'no numbers' };
    if (Array.isArray(root[0])) {
      height = root.length;
      width = Math.max(...root.map((r) => (Array.isArray(r) ? r.length : 0)));
      if (!width) return { error: 'no numbers' };
      const flat = new Float32Array(width * height);
      root.forEach((row, y) => {
        for (let x = 0; x < width; x++) {
          const n = Number(Array.isArray(row) ? row[x] : NaN);
          flat[y * width + x] = Number.isFinite(n) ? n : 0;
        }
      });
      return finish(flat, width, height);
    }
    width = root.length;
    height = 1;
    const flat = new Float32Array(width);
    root.forEach((n, i) => {
      flat[i] = Number.isFinite(Number(n)) ? Number(n) : 0;
    });
    nums = flat;
  } else {
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.split(/[,\t;]/).map((c) => Number(c.trim())).filter((n) => Number.isFinite(n)))
      .filter((r) => r.length);
    if (!rows.length) return { error: 'no numbers' };
    height = rows.length;
    width = Math.max(...rows.map((r) => r.length));
    const flat = new Float32Array(width * height);
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x++) flat[y * width + x] = x < row.length ? row[x] : 0;
    });
    nums = flat;
  }

  if (width < 1 || height < 1 || width > 2048 || height > 2048) return { error: 'bad shape' };
  return finish(nums, width, height);
}

define('input.data', (ctx, inputs) => {
  const src = String(inputs.src ?? '');
  if (!src) {
    ctx.error('Data Table has no file yet — pick a .json or .csv file.');
    return { out: { kind: 'texture', texture: null, width: 0, height: 0, label: 'empty' } };
  }
  const parsed = parseDataTable(src);
  if (parsed.error || !parsed.data) {
    ctx.error(`Data Table could not read that file (${parsed.error || 'unknown'}).`);
    return { out: { kind: 'texture', texture: null, width: 0, height: 0, label: 'unreadable' } };
  }
  const { data, width, height } = parsed;
  const rgba = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = data[i];
    rgba[i * 4 + 1] = 0;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 1;
  }
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return { out: { kind: 'texture', texture, width, height, label: `${width}×${height}` } };
});
