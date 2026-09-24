/**
 * @jest-environment node
 *
 * Whole-repo Postgres schema parity check (plan §5 Stage 0 item 5, owner
 * decision Q3, docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).
 *
 * Pure file parsing — no database connection. It answers one question:
 * does `scripts/setup-database.js` (the fresh-install shape of record,
 * CLAUDE.md Universal Safety Invariants) create every table that the
 * migrations (`lib/db/migrations/*.sql`) leave behind at their end state?
 *
 * A table is "left behind" if some migration CREATEs it and no later
 * migration DROPs it. That set must be a subset of the setup-database.js
 * CREATE TABLE set, except for the tables in KNOWN_GAPS below — the
 * pre-existing parity defect this plan surfaces. KNOWN_GAPS must be EXACTLY
 * the current gap: shrink it (or empty it) the moment setup-database.js is
 * patched to create a gap table, and this test fails loudly if a name is
 * left in the list after it stops being a gap, or if a new, unlisted gap
 * appears.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'lib/db/migrations');
const SETUP_DATABASE_PATH = process.env.SETUP_DATABASE_PATH
  ? path.resolve(process.env.SETUP_DATABASE_PATH)
  : path.join(ROOT, 'scripts/setup-database.js');

// The pre-existing parity defect (plan §1 "Tables" bullet, owner decision Q3).
// This list must be exactly the current gap — see the assertion below.
//
// History: the Stage 0 census found five migration-only tables
// (bill_webhook_events, bill_onboarding_state, reviewer_find_roster,
// review_drafts, review_question_audit — the last one surfaced by this
// parser, not by the plan's first draft). The V55–V59 blocks in
// scripts/setup-database.js closed all five in the same commit that emptied
// this list. Any future entry here is a new parity defect to fix, not a
// permanent exemption.
const KNOWN_GAPS = [];

/**
 * Strip SQL comments (`-- line` and `/* block *\/`) before scanning for
 * CREATE/DROP TABLE. Migration files carry prose comments that use the
 * literal words "CREATE TABLE IF NOT EXISTS" (e.g.
 * lib/db/migrations/034_pre_site_distribution_attempts.sql:131, a backtick
 * immediately after "EXISTS" with no trailing space defeats the `IF NOT
 * EXISTS` optional-group match and yields a bogus table named "if") — this
 * must run before extractTableNames sees the text, not be caught by it.
 */
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalizeIdentifier(raw) {
  return raw
    .replace(/"/g, '')
    .trim()
    .split('.')
    .pop()
    .toLowerCase();
}

/**
 * Extract table names from CREATE TABLE / DROP TABLE statements in a raw
 * SQL (or SQL-bearing) string. Handles `IF NOT EXISTS` / `IF EXISTS`,
 * double-quoted identifiers, schema-qualified names (`schema.table`), and
 * comma-separated DROP TABLE lists (`DROP TABLE a, b, c`).
 */
function extractTableNames(sql, verb) {
  const names = new Set();
  const re =
    verb === 'CREATE'
      ? /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/gi
      : /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+?)(?:;|$)/gim;

  let match;
  while ((match = re.exec(sql)) !== null) {
    const raw = match[1];
    if (verb === 'CREATE') {
      names.add(normalizeIdentifier(raw));
    } else {
      // DROP TABLE a, b, c -> split on commas, each side may be quoted /
      // schema-qualified and may carry trailing whitespace/newlines.
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => names.add(normalizeIdentifier(s)));
    }
  }
  return names;
}

/**
 * setup-database.js is a JS file, not raw SQL: every real CREATE/DROP TABLE
 * statement in it lives inside a backtick template-literal string assigned
 * into one of the `vNN` statement arrays. Prose in `//` comments can
 * *contain* the literal text "CREATE TABLE IF NOT EXISTS" without it being a
 * statement (e.g. the V30 block's design-note comment at
 * scripts/setup-database.js:429/:433, which a naive whole-file regex reads
 * as tables named "IF" and "is"). Scanning only inside backtick literals
 * sidesteps that: comments live outside backticks, so they never enter the
 * scan at all, regardless of what English words they contain.
 */
function extractBacktickLiterals(jsSource) {
  const literals = [];
  const re = /`([^`]*)`/g;
  let match;
  while ((match = re.exec(jsSource)) !== null) {
    literals.push(match[1]);
  }
  return literals.join('\n');
}

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // numeric filename prefixes sort in migration-application order
}

function buildMigrationTableSets() {
  const created = new Set();
  const dropped = new Set();
  const perFile = {};

  for (const file of loadMigrationFiles()) {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    const fileCreated = extractTableNames(sql, 'CREATE');
    const fileDropped = extractTableNames(sql, 'DROP');
    fileCreated.forEach((t) => created.add(t));
    fileDropped.forEach((t) => dropped.add(t));
    perFile[file] = { created: fileCreated, dropped: fileDropped };
  }

  return { created, dropped, perFile };
}

function buildSetupTableSet() {
  const jsSource = fs.readFileSync(SETUP_DATABASE_PATH, 'utf8');
  const sqlOnly = stripSqlComments(extractBacktickLiterals(jsSource));
  return extractTableNames(sqlOnly, 'CREATE');
}

describe('Postgres fresh-install / migrations schema parity', () => {
  const { created: migrationCreated, dropped: migrationDropped } = buildMigrationTableSets();
  const setupTables = buildSetupTableSet();

  // End-state migration tables: created by some migration and not dropped by
  // any migration. Union-minus-union is exact today because no migration
  // creates a table that another migration drops (007/014/018 drop tables
  // that predate the migration series). If a future migration re-creates a
  // dropped name, switch to the per-file sequence in `perFile` so the
  // re-created table is not silently exempted.
  const endStateMigrationTables = [...migrationCreated].filter((t) => !migrationDropped.has(t));

  test(
    `sanity: parser finds a plausible number of tables ` +
      `(${migrationCreated.size} migration CREATE TABLE names across ${loadMigrationFiles().length} files, ` +
      `${setupTables.size} setup-database.js CREATE TABLE names)`,
    () => {
      // Loose bounds so this test fails loudly (not silently) if the parser
      // regresses to matching nothing, rather than pinning exact counts that
      // would need updating on every unrelated migration.
      expect(migrationCreated.size).toBeGreaterThan(40);
      expect(setupTables.size).toBeGreaterThan(40);
      // Known comment-artefact false positives (naive regex on the whole
      // file, not this parser) must NOT appear as table names.
      expect(setupTables.has('if')).toBe(false);
      expect(setupTables.has('is')).toBe(false);
    },
  );

  test('every end-state migration table is either in setup-database.js or an explicit KNOWN_GAPS entry', () => {
    const computedGaps = endStateMigrationTables
      .filter((t) => !setupTables.has(t))
      .sort();
    const expectedGaps = [...KNOWN_GAPS].sort();

    // Exact-match, not subset: a KNOWN_GAPS entry that stopped being a gap
    // (setup-database.js was patched) must be removed from the list, and any
    // new, undeclared gap must fail the test rather than silently pass.
    expect(computedGaps).toEqual(expectedGaps);
  });

  test('no setup-database.js table is ever the target of a migration DROP TABLE', () => {
    const violations = [...setupTables].filter((t) => migrationDropped.has(t)).sort();
    expect(violations).toEqual([]);
  });
});
