/**
 * Tool-app prompt composer (convergence plan Stage 0).
 *
 * Single-pass interpolation of a prompt template, failing loud if any `{{slot}}`
 * remains unfilled. When `nonces` is an array (even empty) the code-owned A7
 * untrusted-content preamble is PREPENDED; it is never stored in a prompt row
 * (prompt-validators rejects it there), so staff cannot remove it. Pass `null`
 * for calls that carry no untrusted content.
 *
 * A template may instead carry a reserved `{{a7_preamble}}` slot (peer-review
 * precedent); the composer then interpolates the preamble in place and does not
 * prepend. Callers must not supply `a7_preamble` themselves, and a slot with
 * null nonces throws.
 */
import { interpolate } from './prompt-store.js';
import { buildUntrustedContentPreamble } from '../utils/ai-payload-boundary.js';

/** Reserved slot: when present, the preamble is interpolated there instead of prepended. */
const A7_SLOT = 'a7_preamble';

/**
 * @param {string} template
 * @param {Record<string, unknown>} variables
 * @param {{ nonces?: string[]|null, separator?: string }} [opts]
 * @returns {string}
 */
export function composeToolPrompt(template, variables, { nonces = null, separator = '\n\n' } = {}) {
  const vars = variables || {};
  if (Object.prototype.hasOwnProperty.call(vars, A7_SLOT)) {
    throw new Error(`composeToolPrompt: "${A7_SLOT}" is reserved for the composer; do not pass it as a variable`);
  }
  const hasSlot = new RegExp(`\\{\\{\\s*${A7_SLOT}\\s*\\}\\}`).test(template);
  if (hasSlot && !Array.isArray(nonces)) {
    throw new Error(`composeToolPrompt: template has a {{${A7_SLOT}}} slot but no nonces array was supplied`);
  }
  const preamble = Array.isArray(nonces) ? buildUntrustedContentPreamble(nonces) : null;
  const all = hasSlot ? { ...vars, [A7_SLOT]: preamble } : vars;
  const text = interpolate(template, all);
  // Re-scan the TEMPLATE (not the output) for leftover slots: a variable value
  // that happens to contain `{{x}}` is data, not an unfilled slot.
  const unfilled = [];
  const slotRe = /\{\{\s*(\w+)\s*\}\}/g;
  let m;
  while ((m = slotRe.exec(template)) !== null) {
    if (!Object.prototype.hasOwnProperty.call(all, m[1])) unfilled.push(m[1]);
  }
  if (unfilled.length > 0) {
    throw new Error(`composeToolPrompt: unfilled template slot(s): ${[...new Set(unfilled)].join(', ')}`);
  }
  if (hasSlot || preamble === null) return text;
  return `${preamble}${separator}${text}`;
}

/**
 * Compose a system + body pair from ONE merged variable map.
 *
 * /admin validates the pair as a whole (a `{{var}}` may live in either template),
 * so composition must too: every slot is filled from the same map and the unfilled
 * check spans both templates. When `nonces` is an array, every `{{a7_preamble}}`
 * slot, wherever it appears, receives the preamble. If neither template has a
 * slot the preamble is prepended to the body when the body is non-empty, else to
 * the system prompt: the untrusted content a caller wraps normally travels in the
 * body, and the preamble must stay in the same request. When `nonces` is null a
 * slot anywhere throws.
 *
 * @param {{ systemPrompt?: string, body?: string }} templates
 * @param {Record<string, unknown>} variables
 * @param {{ nonces?: string[]|null }} [opts]
 * @returns {{ systemPrompt: string, body: string }}
 */
export function composeToolPromptPair({ systemPrompt = '', body = '' }, variables, { nonces = null } = {}) {
  const vars = variables || {};
  if (Object.prototype.hasOwnProperty.call(vars, A7_SLOT)) {
    throw new Error(`composeToolPromptPair: "${A7_SLOT}" is reserved for the composer; do not pass it as a variable`);
  }
  const slotTest = new RegExp(`\\{\\{\\s*${A7_SLOT}\\s*\\}\\}`);
  const hasSlot = slotTest.test(systemPrompt) || slotTest.test(body);
  if (hasSlot && !Array.isArray(nonces)) {
    throw new Error(`composeToolPromptPair: a template has a {{${A7_SLOT}}} slot but no nonces array was supplied`);
  }
  const preamble = Array.isArray(nonces) ? buildUntrustedContentPreamble(nonces) : null;
  const all = hasSlot ? { ...vars, [A7_SLOT]: preamble } : vars;

  const unfilled = new Set();
  for (const template of [systemPrompt, body]) {
    const slotRe = /\{\{\s*(\w+)\s*\}\}/g;
    let m;
    while ((m = slotRe.exec(template)) !== null) {
      if (!Object.prototype.hasOwnProperty.call(all, m[1])) unfilled.add(m[1]);
    }
  }
  if (unfilled.size > 0) {
    throw new Error(`composeToolPromptPair: unfilled template slot(s): ${[...unfilled].join(', ')}`);
  }

  let outSystem = interpolate(systemPrompt, all);
  let outBody = interpolate(body, all);
  if (preamble !== null && !hasSlot) {
    if (outBody) outBody = `${preamble}\n\n${outBody}`;
    else outSystem = `${preamble}\n\n${outSystem}`;
  }
  return { systemPrompt: outSystem, body: outBody };
}
