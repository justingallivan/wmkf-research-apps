import fs from 'node:fs';
import path from 'node:path';

/**
 * Migration 052 (lib/db/migrations/052_pre_site_distribution_brief_inputs.sql)
 * adds a CHECK constraint enforced by live Postgres, not application code.
 * This repo has no live/in-memory Postgres harness for exercising CHECK
 * constraint behavior directly (checked: no pg-mem or equivalent precedent
 * under tests/; tests/unit/reconcile-migration-051.test.js tests a
 * migration-cleanup *script*, not constraint enforcement). So this test is a
 * pure-JS mirror of the constraint's boolean logic, kept byte-for-byte
 * equivalent to the SQL in `pre_site_distribution_brief_fingerprint_shape`
 * and `pre_site_distribution_brief_inputs_coherence` — if the SQL and this
 * mirror diverge, both must be re-checked together.
 */

function isLowercaseHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Mirrors both CHECK constraints migration 052 adds. */
function satisfiesBriefInputsConstraints({
  generated = null,
  live = null,
  delta = null,
  ackAt = null,
  ackBy = null,
}) {
  // pre_site_distribution_brief_fingerprint_shape
  if (generated !== null && !isLowercaseHex64(generated)) return false;
  if (live !== null && !isLowercaseHex64(live)) return false;

  // pre_site_distribution_brief_inputs_coherence
  const allNull = generated === null && live === null && delta === null && ackAt === null && ackBy === null;
  if (allNull) return true;

  if (generated === null || live === null) return false;

  if (generated === live) {
    return delta === null && ackAt === null && ackBy === null;
  }
  return isJsonObject(delta) && ackAt !== null && ackBy !== null;
}

const GEN = 'a'.repeat(64);
const LIVE_DIFFERENT = 'b'.repeat(64);
const NOW = '2026-09-16T12:00:00Z';
const ACTOR = '11111111-1111-1111-1111-111111111111';

describe('migration 052 CHECK constraints (pure-JS mirror)', () => {
  it('accepts a legacy (non-brief) attempt: all five columns null', () => {
    expect(satisfiesBriefInputsConstraints({})).toBe(true);
  });

  it('accepts equal fingerprints with no delta/acknowledgement (no drift)', () => {
    expect(satisfiesBriefInputsConstraints({ generated: GEN, live: GEN })).toBe(true);
  });

  it('accepts unequal fingerprints with a valid object delta and both acknowledgement fields (acknowledged drift)', () => {
    expect(satisfiesBriefInputsConstraints({
      generated: GEN,
      live: LIVE_DIFFERENT,
      delta: { abstractChanged: true },
      ackAt: NOW,
      ackBy: ACTOR,
    })).toBe(true);
  });

  it('rejects a malformed (non-hex or wrong-length) fingerprint', () => {
    expect(satisfiesBriefInputsConstraints({ generated: 'not-hex', live: GEN })).toBe(false);
    expect(satisfiesBriefInputsConstraints({ generated: GEN.slice(0, 63), live: GEN })).toBe(false);
    expect(satisfiesBriefInputsConstraints({ generated: GEN.toUpperCase(), live: GEN.toUpperCase() })).toBe(false);
  });

  it('rejects half-acknowledged drift (only one of ackAt/ackBy set)', () => {
    expect(satisfiesBriefInputsConstraints({
      generated: GEN,
      live: LIVE_DIFFERENT,
      delta: { abstractChanged: true },
      ackAt: NOW,
      ackBy: null,
    })).toBe(false);
    expect(satisfiesBriefInputsConstraints({
      generated: GEN,
      live: LIVE_DIFFERENT,
      delta: { abstractChanged: true },
      ackAt: null,
      ackBy: ACTOR,
    })).toBe(false);
  });

  it('rejects a delta present without drift (equal fingerprints but a non-null delta)', () => {
    expect(satisfiesBriefInputsConstraints({
      generated: GEN,
      live: GEN,
      delta: { abstractChanged: true },
    })).toBe(false);
  });

  it('rejects one fingerprint present without the other', () => {
    expect(satisfiesBriefInputsConstraints({ generated: GEN, live: null })).toBe(false);
    expect(satisfiesBriefInputsConstraints({ generated: null, live: GEN })).toBe(false);
  });

  it('rejects a non-object delta (e.g. an array) even with full acknowledgement', () => {
    expect(satisfiesBriefInputsConstraints({
      generated: GEN,
      live: LIVE_DIFFERENT,
      delta: ['not', 'an', 'object'],
      ackAt: NOW,
      ackBy: ACTOR,
    })).toBe(false);
  });
});

describe('migration 052 real SQL contains the load-bearing predicates the pure-JS mirror assumes', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'lib/db/migrations/052_pre_site_distribution_brief_inputs.sql'),
    'utf8',
  );

  it('uses <> (not =) to detect drift between the two fingerprints', () => {
    expect(migration).toContain('input_fingerprint_generated <> input_fingerprint_live');
  });

  it('requires the delta to be a JSON object', () => {
    expect(migration).toContain("jsonb_typeof(stale_inputs_delta) = 'object'");
  });

  it('keeps the legacy (pre-brief) branch requiring all five columns null', () => {
    expect(migration).toMatch(
      /input_fingerprint_generated IS NULL\s*\n\s*AND input_fingerprint_live IS NULL\s*\n\s*AND stale_inputs_delta IS NULL\s*\n\s*AND stale_inputs_acknowledged_at IS NULL\s*\n\s*AND stale_inputs_acknowledged_by IS NULL/,
    );
  });

  it('requires both acknowledgement fields in the acknowledged-drift branch', () => {
    const acknowledgedBranch = migration.slice(migration.indexOf('Acknowledged drift'));
    expect(acknowledgedBranch).toMatch(/AND stale_inputs_acknowledged_at IS NOT NULL\s*\n\s*AND stale_inputs_acknowledged_by IS NOT NULL/);
  });
});
