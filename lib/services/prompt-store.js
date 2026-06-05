/**
 * Prompt store — dependency-free leaf over the `wmkf_ai_prompt` Dataverse table.
 *
 * Holds the two primitives the Executor (`lib/services/execute-prompt.js`) and
 * the reviewer-finder resolver (`lib/services/reviewer-prompt-resolver.js`) both
 * need:
 *   - `fetchCurrentPrompt(name)` → the single `iscurrent` row for a prompt name
 *   - `interpolate(template, vars)` → `{{var}}` substitution
 *
 * Extracted from `execute-prompt.js` (S222) so the streaming reviewer routes can
 * resolve prompt bodies without importing the (non-streaming) Executor. To avoid
 * an import cycle this module imports ONLY `DynamicsService`.
 *
 * NOTE on Dynamics restriction context: like the Executor, callers must run the
 * fetch inside `bypassDynamicsRestrictions(...)` — this leaf does not wrap it.
 *
 * Typed errors: callers distinguish transient/unreachable failures (fall back to
 * a code template) from structural store corruption (fail loud). The 0-current
 * and >1-current cases carry stable `error.code` values; an underlying Dynamics
 * fetch failure surfaces as-is (no `code`) so the caller treats it as transient.
 */
import { DynamicsService } from './dynamics-service.js';

const PROMPTS_ENTITY = 'wmkf_ai_prompts';

export const PROMPT_STORE_ERROR_CODES = {
  NOT_FOUND: 'PROMPT_NOT_FOUND',
  DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT',
};

function promptStoreError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Fetch the single `iscurrent` row for a prompt name. Selects exactly the fields
 * the Executor reads. Throws typed errors (with stable `.code`) on 0 / >1 rows.
 * Message text is preserved verbatim from the former Executor implementation for
 * backward compatibility.
 *
 * @param {string} promptName
 * @returns {Promise<object>} the prompt row
 */
export async function fetchCurrentPrompt(promptName) {
  const r = await DynamicsService.queryRecords(PROMPTS_ENTITY, {
    select: [
      'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_ai_systemprompt',
      'wmkf_ai_promptbody', 'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema',
      'wmkf_ai_model', 'wmkf_ai_temperature', 'wmkf_ai_maxtokens', 'wmkf_promptversion',
    ].join(','),
    filter: `wmkf_ai_promptname eq '${promptName.replace(/'/g, "''")}' and wmkf_ai_iscurrent eq true`,
    top: 2,
  });
  const rows = r.records || [];
  if (rows.length === 0) {
    throw promptStoreError(`No current prompt found for name "${promptName}"`, PROMPT_STORE_ERROR_CODES.NOT_FOUND);
  }
  if (rows.length > 1) {
    throw promptStoreError(`Multiple current prompts for name "${promptName}" — resolve in Dynamics`, PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT);
  }
  return rows[0];
}

/**
 * `{{var}}` substitution. Unresolved slots are left visible (easier to spot
 * bugs), matching the former Executor behavior.
 *
 * @param {string} template
 * @param {Record<string, unknown>} vars
 * @returns {string}
 */
export function interpolate(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name]);
    return m; // leave unresolved slots visible — easier to spot bugs
  });
}
