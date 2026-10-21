/**
 * Node definition helper.
 *
 * Every entry in src/core/manifest.js needs an `eval` implementation. This
 * pulls the schema (label, category, desc, inputs, outputs) straight from the
 * manifest so the catalogue and the code can never drift apart — authors only
 * write behaviour, and any override (e.g. `dynamic: true`) is passed through
 * `extra`.
 */
import { manifestDef } from '../core/manifest.js';
import { register } from '../core/registry.js';

export function define(type, evalFn, extra = {}) {
  const base = manifestDef(type);
  if (!base) throw new Error(`Node "${type}" is missing from src/core/manifest.js`);
  register({ ...base, ...extra, eval: evalFn });
}
