/**
 * Tests for scripts/lib/point-in-time-files.js — the shared point-in-time
 * doc classifier used by the 4 doc-fan-in gates. Owns the basename + prefix
 * sets that previously lived duplicated across check-fact-consistency,
 * check-canonical-pointers, check-drain-table-mentions, and
 * check-prompt-storage-mentions.
 */

const {
  POINT_IN_TIME_BASENAMES,
  POINT_IN_TIME_PREFIXES,
  isPointInTimeBasename,
} = require('../../scripts/lib/point-in-time-files');

describe('isPointInTimeBasename', () => {
  test('matches exact basenames from the legacy set', () => {
    expect(isPointInTimeBasename('DOC_TRIAGE_2026-05-07.md')).toBe(true);
    expect(isPointInTimeBasename('RECONCILIATION_REPORT.md')).toBe(true);
  });

  test('matches the standardized AUDIT_ prefix', () => {
    expect(isPointInTimeBasename('AUDIT_DOCS_GROUND_TRUTH_2026-05-25.md')).toBe(true);
    expect(isPointInTimeBasename('AUDIT_REVIEWER_INTAKE_2025-12-01.md')).toBe(true);
  });

  test('matches the legacy DOCS_GROUND_TRUTH_AUDIT_ prefix', () => {
    expect(isPointInTimeBasename('DOCS_GROUND_TRUTH_AUDIT_2026-05-19.md')).toBe(true);
  });

  test('matches the CODEX_HANDOFF_REPORT_ prefix', () => {
    expect(isPointInTimeBasename('CODEX_HANDOFF_REPORT_2026-04-30.md')).toBe(true);
  });

  test('does NOT match live docs that happen to contain "AUDIT" mid-name', () => {
    // Live security-audit docs use directory scoping + non-prefix naming, e.g.
    // docs/security-audit/SECURITY_AUDIT_2026-05-21.md. Classifier works on
    // basename only, so the directory scoping is the caller's responsibility,
    // but the basename SECURITY_AUDIT_... must not match — it starts with
    // "SECURITY_", not "AUDIT_".
    expect(isPointInTimeBasename('SECURITY_AUDIT_2026-05-21.md')).toBe(false);
  });

  test('does NOT match arbitrary live docs', () => {
    expect(isPointInTimeBasename('CLAUDE.md')).toBe(false);
    expect(isPointInTimeBasename('STRATEGY.md')).toBe(false);
    expect(isPointInTimeBasename('INTAKE_PORTAL_DESIGN.md')).toBe(false);
    expect(isPointInTimeBasename('DEVELOPMENT_LOG.md')).toBe(false);
  });

  test('is case-sensitive (prefixes are uppercase by convention)', () => {
    expect(isPointInTimeBasename('audit_DOCS_GROUND_TRUTH_2026-05-25.md')).toBe(false);
  });
});

describe('exported sets', () => {
  test('POINT_IN_TIME_BASENAMES is a Set', () => {
    expect(POINT_IN_TIME_BASENAMES).toBeInstanceOf(Set);
    expect(POINT_IN_TIME_BASENAMES.size).toBeGreaterThan(0);
  });

  test('POINT_IN_TIME_PREFIXES includes both audit-doc naming conventions', () => {
    expect(POINT_IN_TIME_PREFIXES).toContain('AUDIT_');
    expect(POINT_IN_TIME_PREFIXES).toContain('DOCS_GROUND_TRUTH_AUDIT_');
    expect(POINT_IN_TIME_PREFIXES).toContain('CODEX_HANDOFF_REPORT_');
  });
});
