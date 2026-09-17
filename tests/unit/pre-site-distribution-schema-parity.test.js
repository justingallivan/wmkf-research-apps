import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/034_pre_site_distribution_attempts.sql'),
  'utf8',
);
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');
const logisticsMigration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/035_site_visit_logistics.sql'),
  'utf8',
);
const noAttachmentMigration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/039_pre_site_distribution_no_attachment.sql'),
  'utf8',
);
const sessionMigration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/040_pre_site_distribution_session_snapshot.sql'),
  'utf8',
);
const briefInputsMigration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/052_pre_site_distribution_brief_inputs.sql'),
  'utf8',
);
const reviewBundleMigration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/053_pre_site_distribution_review_bundle.sql'),
  'utf8',
);

const CONSTRAINT_NAMES = [
  'pre_site_distribution_mode_check',
  'pre_site_distribution_state_check',
  'pre_site_distribution_recipient_shape',
  'pre_site_distribution_hash_shape',
  'pre_site_distribution_attempt_count_nonnegative',
  'pre_site_distribution_prepared_shape',
  'pre_site_distribution_lease_shape',
  'pre_site_distribution_sent_shape',
];

test('fresh-install and migration sources declare the same named distribution constraints', () => {
  for (const name of CONSTRAINT_NAMES) {
    expect(migration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
});

test('migration 034 reconciles the legacy anonymous fresh-install constraint names', () => {
  expect(migration).toContain('pre_site_distribution_attempts_attachment_mode_check');
  expect(migration).toContain('pre_site_distribution_attempts_attempt_count_check');
  for (let suffix = 0; suffix <= 4; suffix += 1) {
    const name = suffix === 0
      ? 'pre_site_distribution_attempts_check'
      : `pre_site_distribution_attempts_check${suffix}`;
    expect(migration).toContain(name);
  }
  expect(migration).toContain('RENAME CONSTRAINT');
});

test('migration 035 and fresh install declare the same calendar/link extension constraints', () => {
  for (const name of [
    'pre_site_distribution_hash_shape',
    'pre_site_distribution_material_links_shape',
    'pre_site_distribution_calendar_shape',
  ]) {
    expect(logisticsMigration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
  for (const column of [
    'preferred_email',
    'calendar_enabled',
    'site_visit_id',
    'site_visit_etag',
    'site_visit_snapshot',
    'material_links',
    'calendar_byte_hash',
    'calendar_attached_at',
  ]) {
    expect(logisticsMigration).toContain(column);
    expect(setup).toContain(column);
  }
});

test("migration 039 and fresh install both admit attachment_mode 'none' under the same constraint name", () => {
  const admitsNone = /CHECK \(attachment_mode IN \('none', 'docx', 'pdf', 'both'\)\)/;
  expect(noAttachmentMigration).toContain('DROP CONSTRAINT IF EXISTS pre_site_distribution_mode_check');
  expect(noAttachmentMigration).toContain('ADD CONSTRAINT pre_site_distribution_mode_check');
  expect(noAttachmentMigration).toMatch(admitsNone);
  expect(setup).toMatch(admitsNone);
  // The prepared-shape constraint requires the PDF snapshot whenever the mode is
  // not 'docx', so a 'none' row must carry both snapshots (the briefing page serves them).
  expect(setup).toContain("attachment_mode = 'docx' OR (");
});

test('migration 040 and fresh install declare the session snapshot column and its shape constraint', () => {
  expect(sessionMigration).toContain('ADD COLUMN IF NOT EXISTS session_snapshot JSONB');
  expect(sessionMigration).toContain('CONSTRAINT pre_site_distribution_session_shape');
  expect(setup).toContain('session_snapshot JSONB');
  expect(setup).toContain('CONSTRAINT pre_site_distribution_session_shape');
});

test('migration 052 and fresh install declare the same Pre-RP Brief prepare-gate audit columns and constraints', () => {
  for (const column of [
    'input_fingerprint_generated',
    'input_fingerprint_live',
    'stale_inputs_delta',
    'stale_inputs_acknowledged_at',
    'stale_inputs_acknowledged_by',
  ]) {
    expect(briefInputsMigration).toContain(column);
    expect(setup).toContain(column);
  }
  for (const name of [
    'pre_site_distribution_brief_fingerprint_shape',
    'pre_site_distribution_brief_inputs_coherence',
  ]) {
    expect(briefInputsMigration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
});

test('migration 053 and fresh install declare the same review bundle retention columns and constraints', () => {
  for (const column of [
    'review_bundle_document_id',
    'review_bundle_drive_id',
    'review_bundle_item_id',
    'review_bundle_version_id',
    'review_bundle_filename',
    'review_bundle_size',
    'review_bundle_byte_hash',
    'review_bundle_set_fingerprint',
    'review_bundle_review_count',
    'review_bundle_rebuilt_at',
  ]) {
    expect(reviewBundleMigration).toContain(column);
    expect(setup).toContain(column);
  }
  for (const name of [
    'pre_site_distribution_review_bundle_shape',
    'pre_site_distribution_review_bundle_coherence',
  ]) {
    expect(reviewBundleMigration).toContain(`CONSTRAINT ${name}`);
    expect(setup).toContain(`CONSTRAINT ${name}`);
  }
});

function extractCheckBody(source, constraintName) {
  const marker = `CONSTRAINT ${constraintName} CHECK (`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Constraint ${constraintName} not found`);
  }
  let depth = 1;
  let i = start + marker.length;
  const bodyStart = i;
  while (depth > 0) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') depth -= 1;
    i += 1;
    if (i > source.length) {
      throw new Error(`Unbalanced parentheses for ${constraintName}`);
    }
  }
  return source.slice(bodyStart, i - 1);
}

function normalizeSql(text) {
  return text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('migration 052 and fresh install declare byte-identical CHECK predicates for the brief prepare-gate constraints', () => {
  for (const name of [
    'pre_site_distribution_brief_fingerprint_shape',
    'pre_site_distribution_brief_inputs_coherence',
  ]) {
    const migrationBody = normalizeSql(extractCheckBody(briefInputsMigration, name));
    const setupBody = normalizeSql(extractCheckBody(setup, name));
    expect(setupBody).toEqual(migrationBody);
  }
});

test('migration 053 and fresh install declare byte-identical CHECK predicates for the review bundle constraints', () => {
  for (const name of [
    'pre_site_distribution_review_bundle_shape',
    'pre_site_distribution_review_bundle_coherence',
  ]) {
    const migrationBody = normalizeSql(extractCheckBody(reviewBundleMigration, name));
    const setupBody = normalizeSql(extractCheckBody(setup, name));
    expect(setupBody).toEqual(migrationBody);
  }
});
