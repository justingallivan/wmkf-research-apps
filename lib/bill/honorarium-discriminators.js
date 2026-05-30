/**
 * Dataverse discriminator GUIDs for the honorarium akoya_request create body.
 *
 * A honorarium request is an `akoya_request` row identified by the composite:
 *   akoya_program     = "Research Reviewer"   (lookup → akoya_programs)
 *   wmkf_grantprogram = "Honorarium"          (lookup → wmkf_grantprograms)
 *   wmkf_type         = "Individual"          (lookup → wmkf_types)
 *   wmkf_request_type = Individual (682090001) (picklist; GOapply Q7a default)
 *
 * The three lookup GUIDs are environment-specific and are supplied via env
 * vars — same pattern as lib/bill/option-set-values.js. We deliberately do NOT
 * resolve them by name at runtime: `akoya_program` resolves by its `akoya_program`
 * name attribute (verified probe), but the `wmkf_grantprograms` / `wmkf_types`
 * primary-name attributes are not verified, and `akoya_program` carries a known
 * duplicate-name hazard (atlas: `Law and Legal Administration` ×2). GUID-keyed
 * env vars sidestep both. Resolve once per environment with
 * scripts/probe-honorarium-discriminators.js.
 *
 * Fail-loud: assertHonorariumDiscriminatorsConfigured() throws if any GUID is
 * unset, so the honorarium-create path refuses to mint a malformed row. The
 * BILL flow only reaches here when a reviewer accepts without opting out, so an
 * unconfigured env surfaces as an alert + skipped create (accept still succeeds).
 */

// wmkf_request_type picklist value for "Individual" (stable across envs — it's
// a global option-set int, not a row GUID). Per umbrella doc Q7a.
export const HONORARIUM_REQUEST_TYPE_INDIVIDUAL = 682090001;

export const HONORARIUM_PROGRAM_ID = orNull(process.env.HONORARIUM_PROGRAM_ID);              // akoya_program "Research Reviewer"
export const HONORARIUM_GRANTPROGRAM_ID = orNull(process.env.HONORARIUM_GRANTPROGRAM_ID);    // wmkf_grantprogram "Honorarium"
export const HONORARIUM_TYPE_ID = orNull(process.env.HONORARIUM_TYPE_ID);                     // wmkf_type "Individual"

export function assertHonorariumDiscriminatorsConfigured() {
  const missing = [];
  if (!HONORARIUM_PROGRAM_ID) missing.push('HONORARIUM_PROGRAM_ID');
  if (!HONORARIUM_GRANTPROGRAM_ID) missing.push('HONORARIUM_GRANTPROGRAM_ID');
  if (!HONORARIUM_TYPE_ID) missing.push('HONORARIUM_TYPE_ID');
  if (missing.length) {
    throw new Error(
      `Honorarium discriminator GUIDs not configured: ${missing.join(', ')}. ` +
      'Run scripts/probe-honorarium-discriminators.js against the target Dataverse ' +
      'environment and set the env vars.',
    );
  }
}

function orNull(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
