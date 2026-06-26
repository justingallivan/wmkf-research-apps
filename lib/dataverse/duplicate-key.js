/**
 * Dataverse alternate-key (412) error translation.
 *
 * Extracted from pages/api/reviewer-finder/my-candidates.js (S290 chunk-5) so the
 * exact same translation is the single source of truth for BOTH the my-candidates
 * PATCH 409 path AND the non-mocked alt-key ordering probe
 * (scripts/probe-merge-altkey-ordering.mjs).
 *
 * WHAT THE REAL 412 ACTUALLY CONTAINS (verified S290 against prod via the chunk-5
 * probe — see scripts/.merge-probe-412-email.txt). A `0x80060892` "Entity Key …
 * violated" error carries:
 *   - `@Microsoft.PowerApps.CDS.ErrorDetails.DuplicateAttributes` →
 *     `<DuplicateAttributes><wmkf_emailaddress>VALUE</wmkf_emailaddress></DuplicateAttributes>`
 *     — the duplicate FIELD (logical name) and VALUE. This is what we extract.
 *   - `@Microsoft.PowerApps.CDS.ErrorDetails.DuplicateEntity` → a serialized Entity
 *     that is the record BEING WRITTEN (not the existing owner), and whose first
 *     `<Id>` is the `modifiedby` systemuser. **The existing conflicting record is
 *     NOT present anywhere in the error.** So this helper deliberately does NOT
 *     return a `conflictingRecordId` — an earlier version extracted the first
 *     `<Id>` and returned a systemuser GUID, which broke merge mode in prod.
 *
 * Callers that need the conflicting record's id must RESOLVE it from `value`
 * (e.g. potential-reviewer.findByEmailCandidates) — see my-candidates handlePatch.
 *
 * Pure: depends only on `error.status` and `error.message`. No module-local state,
 * logger, or Dataverse client — safe to import from a CLI script.
 */

// Returns null for any non-412 / non-alternate-key error. On a duplicate-key 412,
// returns the duplicate FIELD (logical name) and VALUE only.
export function translateDuplicateKeyError(error) {
  if (!error || error.status !== 412) return null;
  const msg = String(error.message || '');
  if (!/Entity Key|0x80060892/.test(msg)) return null;
  const fieldMatch = msg.match(/DuplicateAttributes>[\s\S]*?<([a-z0-9_]+)>([^<]+)</);
  return {
    error: 'duplicate_key',
    message: fieldMatch
      ? `Another reviewer record already has ${fieldMatch[1]} = "${fieldMatch[2]}". Edit blocked — the two records need to be merged before this field can move.`
      : 'A Dataverse alternate-key constraint blocked this update.',
    field: fieldMatch?.[1] || null,
    value: fieldMatch?.[2] || null,
  };
}
