#!/usr/bin/env node
/**
 * Guarded production reconciliation for migration 051 and the obsolete
 * 038_cycle_dossiers.sql tracker alias. This script never enables reviewer
 * institution measurement and never changes application tables other than
 * applying migration 051 through the separate canonical migration runner.
 *
 * Usage (with the intended environment already loaded):
 *   node scripts/reconcile-migration-051.js --preflight
 *   node scripts/reconcile-migration-051.js --post-apply
 *   node scripts/reconcile-migration-051.js --cleanup-038
 *   node scripts/reconcile-migration-051.js --final
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const MANIFEST = require('../lib/db/migrations-manifest.json');
const MIGRATION_038 = '038_cycle_dossiers.sql';
const MIGRATION_045 = '045_cycle_dossiers.sql';
const MIGRATION_051 = '051_reviewer_institution_measurement_events.sql';
const CYCLE_DOSSIER_MIGRATION_SHA256 = '73c3d6643b523de36edf72f7cc3f30cee13a807ebb6aa5e72709b1053c888fca';
const TABLE = 'reviewer_institution_measurement_events';

const EXPECTED_COLUMNS = [
  ['id', 'bigint', 'NO', null, 'nextval'],
  ['case_key', 'character', 'NO', 64, null],
  ['card_snapshot_digest', 'character', 'NO', 64, null],
  ['event_type', 'text', 'NO', null, null],
  ['capture_source', 'text', 'NO', null, null],
  ['source_kind', 'text', 'YES', null, null],
  ['legacy_hold', 'boolean', 'YES', null, null],
  ['relationship', 'text', 'YES', null, null],
  ['evidence_context', 'text', 'YES', null, null],
  ['evidence_source_type', 'text', 'YES', null, null],
  ['evidence_currentness', 'text', 'YES', null, null],
  ['evidence_author_specific', 'text', 'YES', null, null],
  ['recorded_source_type', 'text', 'YES', null, null],
  ['recorded_currentness', 'text', 'YES', null, null],
  ['additional_affiliation_count', 'smallint', 'YES', null, null],
  ['independent_identity', 'text', 'NO', null, null],
  ['additional_coi', 'text', 'NO', null, null],
  ['proposed_action', 'text', 'NO', null, null],
  ['outcome_category', 'text', 'YES', null, null],
  ['created_at', 'timestamp with time zone', 'NO', null, 'now()'],
];

const EXPECTED_CHECK_LITERALS = {
  event_type: [
    'roster_upsert', 'staff_excluded', 'staff_restored',
    'staff_identity_confirmed', 'staff_contact_edited',
    'save_saved', 'save_rejected',
  ],
  capture_source: ['server_applicant', 'roster_unverified', 'stored_roster'],
  independent_identity: ['not_evaluable'],
  additional_coi: ['not_screened'],
  proposed_action: ['not_evaluable'],
};

function trackerDiff(rows, manifestFiles = MANIFEST.files) {
  const names = rows.map((row) => row.name);
  const tracked = new Set(names);
  const manifest = new Set(manifestFiles);
  return {
    missing: manifestFiles.filter((name) => !tracked.has(name)),
    extra: names.filter((name) => !manifest.has(name)),
    trackedCount: tracked.size,
    manifestCount: manifest.size,
  };
}

function sameStrings(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function assertTrackerStage(stage, rows, manifestFiles = MANIFEST.files) {
  const diff = trackerDiff(rows, manifestFiles);
  const names = new Set(rows.map((row) => row.name));
  const failures = [];
  if (stage === 'preflight') {
    if (!sameStrings(diff.missing, [MIGRATION_051])) failures.push(`missing=${diff.missing.join(',') || 'none'}`);
    if (!sameStrings(diff.extra, [MIGRATION_038])) failures.push(`extra=${diff.extra.join(',') || 'none'}`);
    if (!names.has(MIGRATION_045)) failures.push(`${MIGRATION_045} is not tracked`);
  } else if (stage === 'post-apply') {
    if (diff.missing.length !== 0) failures.push(`missing=${diff.missing.join(',')}`);
    if (!sameStrings(diff.extra, [MIGRATION_038])) failures.push(`extra=${diff.extra.join(',') || 'none'}`);
    if (!names.has(MIGRATION_045) || !names.has(MIGRATION_051)) failures.push('045 and 051 must both be tracked');
  } else if (stage === 'final') {
    if (diff.missing.length !== 0 || diff.extra.length !== 0) {
      failures.push(`missing=${diff.missing.join(',') || 'none'} extra=${diff.extra.join(',') || 'none'}`);
    }
    if (!names.has(MIGRATION_045) || !names.has(MIGRATION_051) || names.has(MIGRATION_038)) {
      failures.push('final tracker identity is not exact');
    }
  } else {
    failures.push(`unknown tracker stage ${stage}`);
  }
  if (failures.length > 0) throw new Error(`Tracker ${stage} precondition failed: ${failures.join('; ')}`);
  return diff;
}

function quotedLiterals(definition) {
  return [...String(definition).matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function validateMeasurementSchema({ columns, constraints, indexes, rowCount }) {
  const errors = [];
  const actualColumns = columns.map((column) => [
    column.column_name,
    column.data_type,
    column.is_nullable,
    column.character_maximum_length == null ? null : Number(column.character_maximum_length),
    column.column_default || null,
  ]);
  if (actualColumns.length !== EXPECTED_COLUMNS.length) {
    errors.push(`expected ${EXPECTED_COLUMNS.length} columns, found ${actualColumns.length}`);
  }
  EXPECTED_COLUMNS.forEach(([name, type, nullable, length, defaultFragment], index) => {
    const actual = actualColumns[index];
    if (!actual || actual[0] !== name || actual[1] !== type || actual[2] !== nullable || actual[3] !== length) {
      errors.push(`column ${index + 1} does not match ${name}`);
    }
    if (defaultFragment && !String(actual?.[4] || '').includes(defaultFragment)) {
      errors.push(`column ${name} default is not ${defaultFragment}`);
    }
  });

  const primaryKeys = constraints.filter((constraint) => constraint.contype === 'p');
  if (primaryKeys.length !== 1 || !/PRIMARY KEY \(id\)/i.test(primaryKeys[0]?.definition || '')) {
    errors.push('primary key is not exactly id');
  }
  const checks = constraints.filter((constraint) => constraint.contype === 'c');
  if (checks.length !== Object.keys(EXPECTED_CHECK_LITERALS).length) {
    errors.push(`expected ${Object.keys(EXPECTED_CHECK_LITERALS).length} check constraints, found ${checks.length}`);
  }
  for (const [column, expected] of Object.entries(EXPECTED_CHECK_LITERALS)) {
    const matches = checks.filter((constraint) => String(constraint.definition).includes(column));
    if (matches.length !== 1 || !sameStrings(quotedLiterals(matches[0]?.definition), expected)) {
      errors.push(`check constraint for ${column} is not exact`);
    }
  }

  const indexByName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
  const createdIndex = indexByName.get('idx_reviewer_institution_measurement_created') || '';
  const caseIndex = indexByName.get('idx_reviewer_institution_measurement_case') || '';
  if (!/\(created_at\)$/i.test(createdIndex)) errors.push('created_at index is missing or divergent');
  if (!/\(case_key, created_at\)$/i.test(caseIndex)) errors.push('case_key/created_at index is missing or divergent');
  if (Number(rowCount) !== 0) errors.push(`expected empty measurement table, found ${rowCount} rows`);
  return errors;
}

function assertMeasurementDisabled(env = process.env) {
  if (env.REVIEWER_INSTITUTION_MEASUREMENT === 'on') {
    throw new Error('REVIEWER_INSTITUTION_MEASUREMENT is exact-on; refusing reconciliation');
  }
}

function verifyCycleDossierMigrationDigest() {
  const filename = path.join(ROOT, 'lib/db/migrations', MIGRATION_045);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  if (digest !== CYCLE_DOSSIER_MIGRATION_SHA256) {
    throw new Error(`${MIGRATION_045} digest changed; refusing obsolete tracker cleanup`);
  }
  return digest;
}

async function readTracker(client, forUpdate = false) {
  const query = `SELECT name, applied_at, applied_by FROM schema_migrations ORDER BY name${forUpdate ? ' FOR UPDATE' : ''}`;
  return (await client.query(query)).rows;
}

async function readMeasurementSchema(client) {
  const columns = (await client.query(
    `SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [TABLE],
  )).rows;
  const constraints = (await client.query(
    `SELECT contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = $1::regclass
      ORDER BY contype, conname`,
    [`public.${TABLE}`],
  )).rows;
  const indexes = (await client.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
      ORDER BY indexname`,
    [TABLE],
  )).rows;
  const rowCount = (await client.query(`SELECT COUNT(*)::integer AS count FROM ${TABLE}`)).rows[0]?.count;
  return { columns, constraints, indexes, rowCount };
}

async function assertPostApply(client) {
  const rows = await readTracker(client);
  const diff = assertTrackerStage('post-apply', rows);
  const schema = await readMeasurementSchema(client);
  const errors = validateMeasurementSchema(schema);
  if (errors.length > 0) throw new Error(`Migration 051 schema verification failed: ${errors.join('; ')}`);
  return { diff, rowCount: Number(schema.rowCount) };
}

async function cleanupObsolete038(client) {
  assertMeasurementDisabled();
  verifyCycleDossierMigrationDigest();
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE');
    const beforeRows = await readTracker(client, true);
    const before = assertTrackerStage('post-apply', beforeRows);
    const target = beforeRows.find((row) => row.name === MIGRATION_038);
    const deletion = await client.query(
      'DELETE FROM schema_migrations WHERE name = $1 RETURNING name, applied_at, applied_by',
      [MIGRATION_038],
    );
    if (deletion.rowCount !== 1 || deletion.rows[0]?.name !== MIGRATION_038) {
      throw new Error(`Expected to delete exactly ${MIGRATION_038}; deleted ${deletion.rowCount}`);
    }
    const afterRows = await readTracker(client);
    const after = assertTrackerStage('final', afterRows);
    await client.query('COMMIT');
    return { before, after, deleted: target };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const mode = process.argv[2];
  if (!['--preflight', '--post-apply', '--cleanup-038', '--final'].includes(mode)) {
    throw new Error('Usage: node scripts/reconcile-migration-051.js --preflight|--post-apply|--cleanup-038|--final');
  }
  assertMeasurementDisabled();
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('POSTGRES_URL / DATABASE_URL not set');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (mode === '--preflight') {
      const rows = await readTracker(client);
      const diff = assertTrackerStage('preflight', rows);
      const trackerRows = rows.filter((row) => [MIGRATION_038, MIGRATION_045].includes(row.name));
      console.log(JSON.stringify({ mode, measurementEnabled: false, diff, trackerRows }, null, 2));
      return;
    }
    if (mode === '--post-apply') {
      const result = await assertPostApply(client);
      console.log(JSON.stringify({ mode, measurementEnabled: false, ...result }, null, 2));
      return;
    }
    if (mode === '--cleanup-038') {
      await assertPostApply(client);
      const result = await cleanupObsolete038(client);
      console.log(JSON.stringify({ mode, measurementEnabled: false, ...result }, null, 2));
      return;
    }
    const rows = await readTracker(client);
    const diff = assertTrackerStage('final', rows);
    const schema = await readMeasurementSchema(client);
    const errors = validateMeasurementSchema(schema);
    if (errors.length > 0) throw new Error(`Final schema verification failed: ${errors.join('; ')}`);
    console.log(JSON.stringify({ mode, measurementEnabled: false, diff, rowCount: Number(schema.rowCount) }, null, 2));
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  trackerDiff,
  assertTrackerStage,
  validateMeasurementSchema,
  assertMeasurementDisabled,
  cleanupObsolete038,
  _constants: {
    MIGRATION_038,
    MIGRATION_045,
    MIGRATION_051,
    EXPECTED_COLUMNS,
    EXPECTED_CHECK_LITERALS,
  },
};
