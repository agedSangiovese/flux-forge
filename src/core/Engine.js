/**
 * Graph evaluation engine.
 *
 * Walks backwards from the output node, resolves each input against the
 * receiving port's declared type (see portTypes.js), runs the node, and caches
 * the result against a structural hash so unchanged branches are free.
 *
 * Time-dependent branches (anything downstream of a node whose def declares
 * `dynamic: true`) are never cached — they re-run every frame while the
 * animation plays. Everything else only re-runs when its structure or its
 * parameters actually change.
 *
 * evaluate() -> {
 *   scene, changed, errors, warnings, evaluated, cached, duration, dynamicCount
 * }
 */

import { safeDef } from './registry.js';
import { coerce, isFn, sample, sampleColor, toField, toColorField, toHex, isConstField, constValueOf, makeColor, srgbToLinear } from './values.js';
import { accepts } from './portTypes.js';
import { makeNoise, makeNoise4, makeRng, hashString, hash3, fbm, voronoi, smoothstep, clampNum, lerpNum, fract, TAU } from './noise.js';

export class Engine {
  constructor() {
    this.cache = new Map(); // nodeId -> { hash, value }
    this.dynamicMemo = new Map(); // nodeId -> bool
    this.lastStats = { evaluated: 0, cached: 0, duration: 0 };
  }

  invalidate() {
    this.cache.clear();
    this.dynamicMemo.clear();
  }

  /** Force one node (and therefore its dependents) to recompute next time. */
  touch(nodeId) {
    this.cache.delete(nodeId);
    this.dynamicMemo.clear();
  }

  // ------------------------------------------------------------- dynamic

  isDynamic(graph, nodeId, seen = new Set()) {
    if (this.dynamicMemo.has(nodeId)) return this.dynamicMemo.get(nodeId);
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);

    const node = graph.getNode(nodeId);
    let result = false;
    if (node) {
      const def = safeDef(node.type);
      if (def.dynamic) result = true;
      else {
        for (const inp of def.inputs) {
          for (const link of graph.incoming(nodeId, inp.key)) {
            if (this.isDynamic(graph, link.from, seen)) {
              result = true;
              break;
            }
          }
          if (result) break;
        }
      }
    }
    this.dynamicMemo.set(nodeId, result);
    return result;
  }

  // ------------------------------------------------------------ hashing

  /**
   * Structural hash for a node, incorporating the hashes of everything it
   * depends on. Without the recursion a parameter change would only invalidate
   * the node that owns it and every downstream node would keep serving a stale
   * cached value.
   */
  #hashNode(graph, nodeId, memo, inProgress) {
    const hit = memo.get(nodeId);
    if (hit !== undefined) return hit;
    if (inProgress.has(nodeId)) return 'cycle';
    const node = graph.getNode(nodeId);
    if (!node) return 'missing';

    inProgress.add(nodeId);
    const def = safeDef(node.type);
    let h = `${node.type}|${node.bypass ? 1 : 0}|`;
    try {
      h += JSON.stringify(node.params || {});
    } catch {
      h += 'unserialisable';
    }
    for (const inp of def.inputs) {
      const links = graph.incoming(nodeId, inp.key);
      if (inp.multi) {
        h += `|${inp.key}:[${links
          .map((l) => `${this.#hashNode(graph, l.from, memo, inProgress)}#${l.fromPort}`)
          .join(',')}]`;
      } else if (links.length) {
        const l = links[0];
        h += `|${inp.key}:${this.#hashNode(graph, l.from, memo, inProgress)}#${l.fromPort}`;
      }
    }
    inProgress.delete(nodeId);
    memo.set(nodeId, h);
    return h;
  }

  // -------------------------------------------------------------- evaluate

  /**
   * @param {import('./Graph.js').Graph} graph
   * @param {{ time?: number, seed?: number }} options
   */
  evaluate(graph, options = {}) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const time = options.time ?? 0;
    const seed = options.seed ?? 0;

    const errors = new Map();
    const warnings = new Map();
    const results = new Map();
    const visiting = new Set();
    const recomputed = new Set();
    const hashMemo = new Map();
    const hashProgress = new Set();
    // Structure may have changed since the last frame; the dynamic flags are
    // cheap to derive, so always start from a clean slate.
    this.dynamicMemo.clear();
    let evaluated = 0;
    let cachedCount = 0;
    let dynamicCount = 0;

    const root = graph.outputNode();
    if (!root) {
      return {
        scene: null,
        changed: false,
        errors,
        warnings,
        evaluated: 0,
        cached: 0,
        duration: 0,
        dynamicCount: 0,
        reason: 'no-output',
      };
    }

    const fieldCtx = { time, seed, nodeId: '', min: [0, 0, 0], max: [0, 0, 0] };

    const evalNode = (node, depth) => {
      if (results.has(node.id)) return results.get(node.id);
      if (visiting.has(node.id)) {
        errors.set(node.id, 'Circular connection — this node feeds itself.');
        return {};
      }
      if (depth > 512) {
        errors.set(node.id, 'Graph is too deep to evaluate.');
        return {};
      }

      const def = safeDef(node.type);
      const dyn = this.isDynamic(graph, node.id);
      if (dyn) dynamicCount++;

      const hash = this.#hashNode(graph, node.id, hashMemo, hashProgress);
      const hit = this.cache.get(node.id);
      if (!dyn && hit && hit.hash === hash) {
        // Serve the cached value, but still walk upstream so every node is
        // visited: this keeps the cached/evaluated counts honest and lets each
        // ancestor restore its own cached diagnostics.
        results.set(node.id, hit.value);
        cachedCount++;
        for (const inp of def.inputs) {
          for (const link of graph.incoming(node.id, inp.key)) {
            const src = graph.getNode(link.from);
            if (src) evalNode(src, depth + 1);
          }
        }
        if (hit.error) errors.set(node.id, hit.error);
        if (hit.warning) warnings.set(node.id, hit.warning);
        return hit.value;
      }

      visiting.add(node.id);

      const inputs = {};
      for (const inp of def.inputs) {
        inputs[inp.key] = this.#resolveInput(graph, node, inp, evalNode, depth, errors, warnings, def);
      }

      let value;
      if (node.bypass && def.bypassInput) {
        const raw = inputs[def.bypassInput];
        const passthrough = Array.isArray(raw) ? raw[0] : raw;
        if (passthrough !== undefined && passthrough !== null) {
          const outKey = def.outputs.length ? def.outputs[0].key : 'out';
          value = { [outKey]: passthrough };
        }
      }

      if (value === undefined) {
        try {
          const ctx = this.#makeCtx(graph, node, def, time, seed, fieldCtx, errors, warnings);
          const out = def.eval(ctx, inputs);
          value = out && typeof out === 'object' ? out : {};
        } catch (err) {
          errors.set(node.id, err && err.message ? err.message : String(err));
          value = {};
        }
      }

      visiting.delete(node.id);
      results.set(node.id, value);
      if (dyn) this.cache.delete(node.id);
      else this.cache.set(node.id, { hash, value });
      recomputed.add(node.id);
      evaluated++;
      return value;
    };

    const rootResult = evalNode(root, 0);
    const scene = rootResult && rootResult.scene ? rootResult.scene : null;
    const changed = scene ? recomputed.has(root.id) : false;

    const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    this.lastStats = { evaluated, cached: cachedCount, duration };

    if (!scene) {
      if (!errors.has(root.id)) {
        errors.set(root.id, 'The output node produced nothing.');
      }
    }

    return {
      scene,
      changed: scene ? changed : false,
      errors,
      warnings,
      evaluated,
      cached: cachedCount,
      duration,
      dynamicCount,
      reason: scene ? null : errors.get(root.id) || 'no-output',
    };
  }

  // --------------------------------------------------------------- inputs

  #resolveInput(graph, node, inp, evalNode, depth, errors, warnings, def) {
    const links = graph.incoming(node.id, inp.key);
    const paramValue = node.params && Object.prototype.hasOwnProperty.call(node.params, inp.key)
      ? node.params[inp.key]
      : undefined;

    if (inp.multi) {
      const values = [];
      for (const link of links) {
        const src = graph.getNode(link.from);
        if (!src) continue;
        const srcType = this.#portType(src, link.fromPort);
        const res = evalNode(src, depth + 1);
        const raw = res ? res[link.fromPort] : undefined;
        if (raw === undefined) {
          warnings.set(node.id, `Input "${inp.label || inp.key}" received nothing from upstream.`);
          continue;
        }
        if (!accepts(inp.type, srcType)) {
          errors.set(node.id, `Input "${inp.label || inp.key}" cannot accept ${srcType || 'that'} output.`);
          continue;
        }
        values.push(coerce(raw, inp.type, srcType, inp.default));
      }
      return values;
    }

    if (links.length) {
      const link = links[0];
      const src = graph.getNode(link.from);
      if (!src) return this.#defaultInput(inp, paramValue);
      const srcType = this.#portType(src, link.fromPort);
      const res = evalNode(src, depth + 1);
      const raw = res ? res[link.fromPort] : undefined;
      if (raw === undefined) return this.#defaultInput(inp, paramValue);
      if (!accepts(inp.type, srcType)) {
        errors.set(node.id, `Input "${inp.label || inp.key}" cannot accept a ${srcType || 'unknown'} output.`);
        return this.#defaultInput(inp, paramValue);
      }
      return coerce(raw, inp.type, srcType, inp.default);
    }

    return this.#defaultInput(inp, paramValue);
  }

  #defaultInput(inp, paramValue) {
    const raw = paramValue !== undefined ? paramValue : inp.default;
    return coerce(raw, inp.type, inp.type, inp.default);
  }

  #portType(node, portKey) {
    const def = safeDef(node.type);
    const out = def.outputs.find((o) => o.key === portKey);
    return out ? out.type : null;
  }

  // ------------------------------------------------------------------ ctx

  #makeCtx(graph, node, def, time, seed, fieldCtx, errors, warnings) {
    const nodeSeed = (hashString(node.id) ^ Math.imul(seed || 0, 0x9e3779b9)) >>> 0;
    const noiseCache = new Map();
    const noise4Cache = new Map();
    const rng = makeRng(nodeSeed || 1);

    const ctx = {
      node,
      type: node.type,
      graph,
      time,
      seed: nodeSeed,
      fieldCtx: { ...fieldCtx, nodeId: node.id, seed: nodeSeed, time },

      error(msg) {
        errors.set(node.id, String(msg));
      },
      warn(msg) {
        warnings.set(node.id, String(msg));
      },

      // value helpers
      coerce,
      sample,
      sampleColor,
      toField,
      toColorField,
      toHex,
      isConstField,
      constValueOf,
      isFn,
      makeColor,
      srgbToLinear,

      // noise helpers — memoised per seed so a node can ask for several
      noise(s = 0) {
        const k = s | 0;
        if (!noiseCache.has(k)) noiseCache.set(k, makeNoise((nodeSeed ^ Math.imul(k, 0x9e3779b9)) >>> 0));
        return noiseCache.get(k);
      },
      // Same recipe as noise(), but a separate cache: the 4-D sampler is a
      // different function and the two must not collide.
      noise4(s = 0) {
        const k = s | 0;
        if (!noise4Cache.has(k)) noise4Cache.set(k, makeNoise4((nodeSeed ^ Math.imul(k, 0x9e3779b9)) >>> 0));
        return noise4Cache.get(k);
      },
      fbm,
      voronoi,
      hash3,
      hashString,
      smoothstep,
      clampNum,
      lerpNum,
      fract,
      TAU,
      rng,

      /** Deterministic random stream restarted from a seed. */
      rngFor(s) {
        return makeRng(((nodeSeed ^ Math.imul(s | 0, 0x85ebca6b)) >>> 0) || 1);
      },
    };

    return ctx;
  }
}

export const engine = new Engine();
