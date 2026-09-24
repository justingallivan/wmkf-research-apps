'use strict';

/**
 * Catalog-level parity check between the fresh-install V55-V59 blocks in
 * scripts/setup-database.js (currently UNCOMMITTED working-tree state — see
 * schema-applies.test.js) and the actual migration-built shape for the same
 * five tables. Requested by a Codex adversarial review: the name-level
 * parity test (tests/unit/postgres-schema-parity.test.js) proves a table
 * exists in both places, but cannot catch a wrong column type, a missing
 * constraint, or a differently-shaped index inside a V-block that happens
 * to declare the right table name.
 *
 * Method: after global-setup.js's fresh install, snapshot each table's
 * pg_catalog shape (columns, constraints, indexes). Then, inside a single
 * transaction that is always rolled back, DROP the five tables and rebuild
 * them by applying the RAW SQL of the migrations that actually produced
 * them in production (015, 017, 020, 023, 025, 027, 029, 021, 022, in that
 * order — the reviewer_find_roster chain must run in migration order since
 * each ALTER depends on the previous one's state). Snapshot again and
 * diff. Nothing persists: the whole rebuild runs inside BEGIN...ROLLBACK
 * (DDL is transactional in Postgres), proven idempotent by running this
 * suite twice in a row (see the pg-contract report).
 *
 * One accepted difference, by design, not a bug: ordinal position is
 * excluded from the column comparison. 025 ADDs reviewer_find_roster's
 * candidate_key column after the table already exists, so the
 * migration-rebuilt shape has it last; the folded V57 block declares it
 * inline, earlier. Column SETS and every other column attribute (type,
 * nullability, default, identity, generated-ness, collation, and — for a
 * column with an owned sequence, i.e. any SERIAL/BIGSERIAL or IDENTITY
 * column — the sequence's own seqstart/seqincrement/seqmin/seqmax/seqcache/
 * seqcycle/seqtype and whether it's an 'a' (SERIAL) or 'i' (IDENTITY)
 * dependency, per pg_depend) still must match exactly. That last piece is
 * what tells `INTEGER NOT NULL DEFAULT 0` apart from `GENERATED ALWAYS AS
 * IDENTITY`, and a SERIAL sequence with a different increment/ownership
 * from its migration-built counterpart, neither of which attidentity alone
 * catches (round 3, Codex high finding).
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { stripOuterTxn } = require('../../scripts/apply-migrations.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

const REPO_ROOT = path.join(__dirname, '..', '..');
// PG_CONTRACT_MIGRATIONS_DIR exists ONLY for discriminating-control runs: point
// it at a scratch copy of lib/db/migrations with one deliberate divergence
// and the comparison must fail. It is never set in CI or by npm scripts.
const MIGRATIONS_DIR = process.env.PG_CONTRACT_MIGRATIONS_DIR
  ? path.resolve(process.env.PG_CONTRACT_MIGRATIONS_DIR)
  : path.join(REPO_ROOT, 'lib', 'db', 'migrations');

const TABLES = [
  'bill_webhook_events',
  'bill_onboarding_state',
  'reviewer_find_roster',
  'review_drafts',
  'review_question_audit',
];

// Production apply order for the tables/ALTERs under test, not manifest
// (lexicographic) order — the reviewer_find_roster chain is a strict
// dependency chain (023/025/027/029 each ALTER what the previous state
// left behind).
const MIGRATION_FILES_IN_ORDER = [
  '015_bill_webhook_events.sql',
  '017_bill_onboarding_state.sql',
  '020_reviewer_find_roster.sql',
  '023_reviewer_find_roster_coi_dropped.sql',
  '025_reviewer_find_roster_candidate_key.sql',
  '027_reviewer_find_roster_ineligible.sql',
  '029_reviewer_find_roster_blocked.sql',
  '021_review_drafts.sql',
  '022_review_question_audit.sql',
];

function normalizeDef(def) {
  return (def || '').replace(/\bpublic\./g, '').replace(/\s+/g, ' ').trim();
}

/**
 * A column can carry an owned sequence two ways: `SERIAL`/`BIGSERIAL`
 * (pg_depend deptype 'a', auto) or `GENERATED ... AS IDENTITY` (deptype
 * 'i', internal) — `attidentity` alone can't distinguish "no sequence" from
 * "sequence with different start/increment/cycle", and `INTEGER ...
 * DEFAULT 0` vs `GENERATED ALWAYS AS IDENTITY` differ only in attidentity
 * and this owned-sequence shape, not in data_type/is_nullable. Snapshot the
 * sequence's own attributes per owning column so both classes of mismatch
 * are caught.
 */
async function snapshotOwnedSequences(client, table) {
  const res = await client.query(
    `SELECT d.refobjsubid AS attnum,
            d.deptype,
            s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle,
            format_type(s.seqtypid, NULL) AS seqtype
       FROM pg_depend d
       JOIN pg_sequence s ON s.seqrelid = d.objid
      WHERE d.refobjid = ('public.' || $1)::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND d.classid = 'pg_class'::regclass
        AND d.deptype IN ('a', 'i')`,
    [table]
  );
  const byAttnum = new Map();
  for (const row of res.rows) {
    const { attnum, ...seq } = row;
    byAttnum.set(attnum, JSON.stringify(seq));
  }
  return byAttnum;
}

async function snapshotTable(client, table) {
  const columns = await client.query(
    `SELECT a.attnum,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            (NOT a.attnotnull) AS is_nullable,
            pg_get_expr(d.adbin, d.adrelid) AS column_default,
            a.attidentity AS identity,
            a.attgenerated AS generated,
            COALESCE(coll.collname, '') AS collation
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
       LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
      WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table]
  );
  const ownedSequences = await snapshotOwnedSequences(client, table);
  // Relation-level metadata (Codex adversarial review, S536): a table that
  // became UNLOGGED, or a view/partitioned table wearing the same name,
  // would leave every column/constraint/index value identical, so relkind
  // and relpersistence are compared explicitly.
  const relation = await client.query(
    `SELECT c.relname AS relname, c.relkind::text AS relkind, c.relpersistence::text AS relpersistence
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [table]
  );
  const constraints = await client.query(
    `SELECT conname, contype::text AS contype, pg_get_constraintdef(oid) AS condef
       FROM pg_constraint
      WHERE conrelid = ('public.' || $1)::regclass
      ORDER BY conname`,
    [table]
  );
  const indexes = await client.query(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
      ORDER BY indexname`,
    [table]
  );
  return {
    relation: relation.rows,
    columns: columns.rows.map((r) => ({
      ...r,
      // '' (not null/undefined) so it participates in the by-name diff
      // like every other compared field, for a column with no owned sequence.
      sequence: ownedSequences.get(r.attnum) || '',
    })),
    constraints: constraints.rows.map((r) => ({ ...r, condef: normalizeDef(r.condef) })),
    indexes: indexes.rows.map((r) => ({ ...r, indexdef: normalizeDef(r.indexdef) })),
  };
}

/** Generic by-key diff, used for columns/constraints/indexes alike; every mismatch names the table, the kind, the key, and the differing field with both values. */
function diffByKey(table, kind, freshRows, migratedRows, keyField, compareFields) {
  const errors = [];
  const freshByKey = new Map(freshRows.map((r) => [r[keyField], r]));
  const migByKey = new Map(migratedRows.map((r) => [r[keyField], r]));
  for (const key of freshByKey.keys()) {
    if (!migByKey.has(key)) {
      errors.push(`[${table}] ${kind} "${key}": in fresh-install shape but missing from migration-rebuilt shape`);
    }
  }
  for (const key of migByKey.keys()) {
    if (!freshByKey.has(key)) {
      errors.push(`[${table}] ${kind} "${key}": in migration-rebuilt shape but missing from fresh-install shape`);
    }
  }
  for (const [key, f] of freshByKey) {
    const m = migByKey.get(key);
    if (!m) continue;
    for (const field of compareFields) {
      if (f[field] !== m[field]) {
        errors.push(
          `[${table}] ${kind} "${key}".${field} differs: fresh-install=${JSON.stringify(f[field])} migration-rebuilt=${JSON.stringify(m[field])}`
        );
      }
    }
  }
  return errors;
}

describeIfDb('setup-database.js V55-V59 blocks vs. migration-built shape (catalog parity)', () => {
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  test('columns, constraints, and indexes match exactly (ordinal position excluded)', async () => {
    const fresh = {};
    for (const table of TABLES) {
      fresh[table] = await snapshotTable(client, table);
    }

    const errors = [];
    await client.query('BEGIN');
    try {
      for (const table of TABLES) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      for (const filename of MIGRATION_FILES_IN_ORDER) {
        const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
        await client.query(stripOuterTxn(raw));
      }

      for (const table of TABLES) {
        const migrated = await snapshotTable(client, table);
        errors.push(
          ...diffByKey(table, 'relation', fresh[table].relation, migrated.relation, 'relname', [
            'relkind',
            'relpersistence',
          ])
        );
        errors.push(
          ...diffByKey(table, 'column', fresh[table].columns, migrated.columns, 'column_name', [
            'data_type',
            'is_nullable',
            'column_default',
            'identity',
            'generated',
            'collation',
            'sequence',
          ])
        );
        errors.push(
          ...diffByKey(table, 'constraint', fresh[table].constraints, migrated.constraints, 'conname', [
            'contype',
            'condef',
          ])
        );
        errors.push(
          ...diffByKey(table, 'index', fresh[table].indexes, migrated.indexes, 'indexname', ['indexdef'])
        );
      }
    } finally {
      // Nothing from this test ever persists, regardless of pass or fail.
      await client.query('ROLLBACK');
    }

    if (errors.length > 0) {
      throw new Error(
        `setup-database.js V55-V59 blocks do NOT reproduce the migration-built shape ` +
          `(${errors.length} mismatch(es)):\n${errors.join('\n')}`
      );
    }
  });
});
