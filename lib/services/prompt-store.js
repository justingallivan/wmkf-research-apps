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
 * fetch inside `withDalContext(...)` — this leaf does not wrap it.
 *
 * Typed errors: callers distinguish transient/unreachable failures (fall back to
 * a code template) from structural store corruption (fail loud). The 0-current
 * and >1-current cases carry stable `error.code` values; an underlying Dynamics
 * fetch failure surfaces as-is (no `code`) so the caller treats it as transient.
 *
 * Query + error-contract are delegated to the wmkf_ai_prompts adapter
 * (`lib/dataverse/adapters/ai-prompt.js#getCurrentForExecutor`), which mirrors
 * this leaf's call shape and typed errors verbatim (Stage-3 conversion, S329
 * plan). Callers still own the Dynamics restriction context — this leaf does
 * not wrap `withDalContext(...)`.
 */
import { getCurrentForExecutor, listVersions, PROMPT_STORE_ERROR_CODES } from '../dataverse/adapters/ai-prompt.js';

export { PROMPT_STORE_ERROR_CODES };

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
  return getCurrentForExecutor(promptName);
}

/**
 * Resolve one immutable historical prompt row for a generation snapshot.
 * Callers must still establish the trusted DAL context.
 */
export async function fetchPromptVersion(promptName, { promptId = null, version = null } = {}) {
  if (!promptName || (!promptId && version == null)) {
    throw new Error('fetchPromptVersion requires promptName and promptId or version');
  }
  const result = await listVersions(promptName);
  const rows = (result?.records || []).filter((row) => (
    row.wmkf_ai_promptname === promptName
    && (promptId == null || row.wmkf_ai_promptid === promptId)
    && (version == null || Number(row.wmkf_promptversion) === Number(version))
  ));
  if (rows.length !== 1) {
    throw new Error(`Expected one historical prompt for "${promptName}" (found ${rows.length})`);
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
