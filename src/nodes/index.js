/**
 * Node library entry point.
 *
 * Importing this module registers every node in the catalogue: each family
 * module runs its `define(...)` calls as a side effect, and `define` pulls the
 * schema straight from the manifest, so import order is irrelevant. The
 * Engine caches results against structural hashes and only re-evaluates what
 * actually changed.
 */
import { MANIFEST } from '../core/manifest.js';
import { hasDef } from '../core/registry.js';

import './input.js';
import './fields.js';
import './math.js';
import './color.js';
import './shapes.js';
import './deform.js';
import './points.js';
import './material.js';
import './scene.js';
import './output.js';
import './media.js';
import './shader.js';

/** Verify every manifest entry got an implementation. */
export function installNodes() {
  const missing = MANIFEST.filter((d) => !hasDef(d.type)).map((d) => d.type);
  if (missing.length) console.error('[nodes] unimplemented node types:', missing);
  return missing.length === 0;
}
