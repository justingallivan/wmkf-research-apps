/**
 * Tool-app prompt composer (convergence plan Stage 0).
 *
 * Single-pass interpolation of a prompt template, failing loud if any `{{slot}}`
 * remains unfilled. When `nonces` is an array (even empty) the code-owned A7
 * untrusted-content preamble is PREPENDED; it is never stored in a prompt row
 * (prompt-validators rejects it there), so staff cannot remove it. Pass `null`
 * for calls that carry no untrusted content.
 */
import { interpolate } from './prompt-store.js';
import { buildUntrustedContentPreamble } from '../utils/ai-payload-boundary.js';

/**
 * @param {string} template
 * @param {Record<string, unknown>} variables
 * @param {{ nonces?: string[]|null, separator?: string }} [opts]
 * @returns {string}
 */
export function composeToolPrompt(template, variables, { nonces = null, separator = '\n\n' } = {}) {
  const text = interpolate(template, variables || {});
  // Re-scan the TEMPLATE (not the output) for leftover slots: a variable value
  // that happens to contain `{{x}}` is data, not an unfilled slot.
  const unfilled = [];
  const slotRe = /\{\{\s*(\w+)\s*\}\}/g;
  let m;
  while ((m = slotRe.exec(template)) !== null) {
    if (!Object.prototype.hasOwnProperty.call(variables || {}, m[1])) unfilled.push(m[1]);
  }
  if (unfilled.length > 0) {
    throw new Error(`composeToolPrompt: unfilled template slot(s): ${[...new Set(unfilled)].join(', ')}`);
  }
  return Array.isArray(nonces) ? `${buildUntrustedContentPreamble(nonces)}${separator}${text}` : text;
}
