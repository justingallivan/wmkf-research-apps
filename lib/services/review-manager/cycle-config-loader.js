/**
 * Review Manager — shared cycle-config loader
 * (Route→Service Consolidation Plan, stage 2b shared-helper extraction).
 *
 * ONE Dataverse `wmkf_appgrantcycle` config loader for the two callers that
 * previously carried duplicate copies of this algorithm:
 *   - render-emails-service.js (projects name / program_name /
 *     review_deadline / custom_fields), and
 *   - send-emails-service.js (projects review_template_blob_url /
 *     additional_attachments).
 *
 * Projection is PER-CALLER via the `fields` map — snake_case output key →
 * camelCase cycle property — so each caller keeps exactly its historical
 * snake_case shape (`short_code` is always included). Do NOT collapse the
 * callers onto one superset projection; the shapes are consumed downstream
 * as-is (W3-cutover backwards compatibility).
 *
 * Duplicate-shortcode resolution is enforced by the wmkf_shortcode alt-key —
 * there can only be one match per code. Transport errors propagate to the
 * caller (parity with pre-cutover SQL behavior); only row-not-found stays
 * silent. Runs inside the caller's trusted DAL context — never establishes
 * one.
 */

import { findByShortCode } from '../grant-cycles-dataverse';

/**
 * Load cycle configs keyed by short code.
 *
 * @param {string[]} cycleCodes - distinct cycle short codes
 * @param {Object} options
 * @param {Object<string,string>} options.fields - snake_case output key →
 *   camelCase property on the cycle record returned by findByShortCode
 * @returns {Promise<Object<string, Object>>} shortCode → { short_code, ...projected fields }
 */
export async function loadCycleConfigs(cycleCodes, { fields }) {
  const out = {};
  if (!cycleCodes.length) return out;
  const results = await Promise.all(cycleCodes.map((code) => findByShortCode(code)));
  for (const cycle of results) {
    if (!cycle || !cycle.shortCode) continue;
    if (out[cycle.shortCode]) continue;
    const row = { short_code: cycle.shortCode };
    for (const [outKey, prop] of Object.entries(fields)) {
      row[outKey] = cycle[prop];
    }
    out[cycle.shortCode] = row;
  }
  return out;
}
