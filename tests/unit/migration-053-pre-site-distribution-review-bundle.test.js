import fs from 'node:fs';
import path from 'node:path';

/**
 * Migration 053 (lib/db/migrations/053_pre_site_distribution_review_bundle.sql)
 * adds two CHECK constraints enforced by live Postgres, not application
 * code. This repo has no live/in-memory Postgres harness for exercising
 * CHECK constraint behavior directly (see
 * tests/unit/migration-052-pre-site-distribution-brief-inputs.test.js for
 * the precedent this file mirrors). So this test is a pure-JS mirror of
 * both constraints' boolean logic, kept byte-for-byte equivalent to the SQL
 * in `pre_site_distribution_review_bundle_shape` and
 * `pre_site_distribution_review_bundle_coherence` — if the SQL and this
 * mirror diverge, both must be re-checked together.
 */

function isLowercaseHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Mirrors pre_site_distribution_review_bundle_shape. */
function satisfiesShape({ byteHash = null, setFingerprint = null }) {
  if (byteHash !== null && !isLowercaseHex64(byteHash)) return false;
  if (setFingerprint !== null && !isLowercaseHex64(setFingerprint)) return false;
  return true;
}

/** Mirrors pre_site_distribution_review_bundle_coherence. */
function satisfiesCoherence({
  documentId = null,
  driveId = null,
  itemId = null,
  filename = null,
  byteHash = null,
  setFingerprint = null,
  reviewCount = null,
}) {
  const allNull = documentId === null && driveId === null && itemId === null
    && filename === null && byteHash === null && setFingerprint === null && reviewCount === null;
  if (allNull) return true;

  return documentId !== null && driveId !== null && itemId !== null
    && filename !== null && byteHash !== null && setFingerprint !== null
    && reviewCount !== null && reviewCount >= 1;
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const FULL_FAMILY = {
  documentId: '11111111-1111-1111-1111-111111111111',
  driveId: 'drive-1',
  itemId: 'item-1',
  filename: 'Test Institution - Reviews - aaaaaaaa.pdf',
  byteHash: HASH_A,
  setFingerprint: HASH_B,
  reviewCount: 2,
};

describe('migration 053 CHECK constraints (pure-JS mirror)', () => {
  describe('pre_site_distribution_review_bundle_shape', () => {
    it('accepts both hashes null', () => {
      expect(satisfiesShape({})).toBe(true);
    });

    it('accepts two valid lowercase hex64 hashes', () => {
      expect(satisfiesShape({ byteHash: HASH_A, setFingerprint: HASH_B })).toBe(true);
    });

    it('rejects a malformed byte hash', () => {
      expect(satisfiesShape({ byteHash: 'not-hex', setFingerprint: HASH_B })).toBe(false);
      expect(satisfiesShape({ byteHash: HASH_A.slice(0, 63), setFingerprint: HASH_B })).toBe(false);
      expect(satisfiesShape({ byteHash: HASH_A.toUpperCase(), setFingerprint: HASH_B })).toBe(false);
    });

    it('rejects a malformed set fingerprint', () => {
      expect(satisfiesShape({ byteHash: HASH_A, setFingerprint: 'not-hex' })).toBe(false);
    });
  });

  describe('pre_site_distribution_review_bundle_coherence', () => {
    it('accepts a legacy attempt: all seven columns null', () => {
      expect(satisfiesCoherence({})).toBe(true);
    });

    it('accepts a fully populated review-bundle attempt', () => {
      expect(satisfiesCoherence(FULL_FAMILY)).toBe(true);
    });

    it('rejects a partial family (only some columns set)', () => {
      expect(satisfiesCoherence({ ...FULL_FAMILY, itemId: null })).toBe(false);
      expect(satisfiesCoherence({ documentId: FULL_FAMILY.documentId })).toBe(false);
    });

    it('rejects reviewCount of zero even when the rest of the family is present', () => {
      expect(satisfiesCoherence({ ...FULL_FAMILY, reviewCount: 0 })).toBe(false);
    });

    it('rejects a negative reviewCount', () => {
      expect(satisfiesCoherence({ ...FULL_FAMILY, reviewCount: -1 })).toBe(false);
    });
  });
});

describe('migration 053 real SQL contains the load-bearing predicates the pure-JS mirror assumes', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'lib/db/migrations/053_pre_site_distribution_review_bundle.sql'),
    'utf8',
  );

  it('requires review_bundle_review_count >= 1 in the populated branch', () => {
    expect(migration).toContain('review_bundle_review_count >= 1');
  });

  it('keeps the legacy branch requiring all seven identity columns null plus the rebuild timestamp', () => {
    expect(migration).toMatch(
      /review_bundle_document_id IS NULL\s*\n\s*AND review_bundle_drive_id IS NULL\s*\n\s*AND review_bundle_item_id IS NULL\s*\n\s*AND review_bundle_filename IS NULL\s*\n\s*AND review_bundle_byte_hash IS NULL\s*\n\s*AND review_bundle_set_fingerprint IS NULL\s*\n\s*AND review_bundle_review_count IS NULL\s*\n\s*AND review_bundle_rebuilt_at IS NULL/,
    );
  });

  it('does not require review_bundle_version_id or review_bundle_size in the coherence check (metadata, not identity)', () => {
    const coherenceStart = migration.indexOf('pre_site_distribution_review_bundle_coherence');
    const coherenceBody = migration.slice(coherenceStart);
    expect(coherenceBody).not.toContain('review_bundle_version_id IS');
    expect(coherenceBody).not.toContain('review_bundle_size IS');
  });

  it('uses IF NOT EXISTS for every ADD COLUMN and IF EXISTS for every DROP CONSTRAINT', () => {
    const addColumnLines = migration.match(/ADD COLUMN[^\n,]*/g) || [];
    expect(addColumnLines.length).toBeGreaterThan(0);
    for (const line of addColumnLines) {
      expect(line).toContain('IF NOT EXISTS');
    }
    const dropConstraintLines = migration.match(/DROP CONSTRAINT[^\n,]*/g) || [];
    expect(dropConstraintLines.length).toBeGreaterThan(0);
    for (const line of dropConstraintLines) {
      expect(line).toContain('IF EXISTS');
    }
  });
});
