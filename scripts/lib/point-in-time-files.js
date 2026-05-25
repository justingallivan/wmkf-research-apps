/**
 * Shared classifier for "point-in-time" docs across the 4 doc/memory
 * fan-in gates (check-fact-consistency, check-canonical-pointers,
 * check-drain-table-mentions, check-prompt-storage-mentions).
 *
 * Point-in-time docs are dated snapshots — audit reports, codex handoff
 * reports, reconciliation reports, one-off triage docs. They legitimately
 * contain stale claims and old scalars; the gates exclude them from
 * "live doc" coverage so those don't fail the consistency checks.
 *
 * Single source of truth so a new audit-doc naming convention only needs
 * to be added in one place. Prior to extraction (S185 Codex review), each
 * gate maintained its own copy of POINT_IN_TIME_BASENAMES + PREFIXES, and
 * adding the new `AUDIT_DOCS_GROUND_TRUTH_*` style required touching all
 * four files in lockstep.
 *
 * Conventions:
 *   - POINT_IN_TIME_BASENAMES: exact-match dated docs whose names don't
 *     follow a current prefix convention (legacy / one-offs).
 *   - POINT_IN_TIME_PREFIXES: any file in scope whose basename starts
 *     with one of these prefixes is treated as point-in-time. Covers
 *     the standardized `AUDIT_*` convention, the legacy
 *     `DOCS_GROUND_TRUTH_AUDIT_*` convention, and Codex handoff reports.
 *
 * Adding a new naming convention: append the prefix here (not in every
 * gate). Adding a one-off legacy doc: add the exact basename here.
 */

const POINT_IN_TIME_BASENAMES = new Set([
  'DOC_TRIAGE_2026-05-07.md',
  'RECONCILIATION_REPORT.md',
]);

const POINT_IN_TIME_PREFIXES = [
  'AUDIT_',
  'DOCS_GROUND_TRUTH_AUDIT_',
  'CODEX_HANDOFF_REPORT_',
];

/**
 * Test whether a basename (not a full path) names a point-in-time doc.
 * Callers should pass `path.basename(filePath)` — the test is purely
 * lexical on the basename, not on enclosing directories.
 */
function isPointInTimeBasename(basename) {
  if (POINT_IN_TIME_BASENAMES.has(basename)) return true;
  for (const prefix of POINT_IN_TIME_PREFIXES) {
    if (basename.startsWith(prefix)) return true;
  }
  return false;
}

module.exports = {
  POINT_IN_TIME_BASENAMES,
  POINT_IN_TIME_PREFIXES,
  isPointInTimeBasename,
};
