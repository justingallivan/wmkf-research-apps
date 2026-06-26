/**
 * Dataverse alternate-key (412) error translation.
 *
 * Extracted from pages/api/reviewer-finder/my-candidates.js (S290 chunk-5) so the
 * exact same translation is the single source of truth for BOTH the my-candidates
 * PATCH 409 path AND the non-mocked alt-key ordering probe
 * (scripts/probe-merge-altkey-ordering.mjs). The probe calls THIS helper on the
 * real Dataverse 412 body so a regex drift here can't pass the probe while the
 * route silently falls through to a 500.
 *
 * Pure: depends only on `error.status` and `error.message`. No module-local state,
 * logger, or Dataverse client — safe to import from a CLI script.
 */

// Extracts a usable shape from a Dataverse 412 "Entity Key violated" error.
// Returns null for any other error. The Id in the DuplicateEntity XML is the
// row that ALREADY holds the conflicting value — i.e. the merge target.
export function translateDuplicateKeyError(error) {
  if (!error || error.status !== 412) return null;
  const msg = String(error.message || '');
  if (!/Entity Key|0x80060892/.test(msg)) return null;
  const fieldMatch = msg.match(/DuplicateAttributes>[\s\S]*?<([a-z0-9_]+)>([^<]+)</);
  const idMatch = msg.match(/<Id>([0-9a-f-]{36})<\/Id>/i);
  return {
    error: 'duplicate_key',
    message: fieldMatch
      ? `Another reviewer record already has ${fieldMatch[1]} = "${fieldMatch[2]}". Edit blocked — the two records need to be merged before this field can move.`
      : 'A Dataverse alternate-key constraint blocked this update.',
    field: fieldMatch?.[1] || null,
    value: fieldMatch?.[2] || null,
    conflictingRecordId: idMatch?.[1] || null,
  };
}
