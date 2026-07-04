#!/usr/bin/env node
/**
 * CI gate: every Postgres table and Dataverse entity referenced in source
 * must appear in the Application State Atlas.
 *
 * Phase 2 of docs/CLAUDE_REMEDIATION_PLAN.md. Without this, the Atlas
 * rots — same way the API_ROUTE_SECURITY_MATRIX did before its CI gate.
 *
 * ⚠️ Run this SEQUENTIALLY with `check:atlas:self-test`, never in parallel.
 * The self-test writes synthetic fixtures into `lib/services/atlas_selftest_tmp/`
 * (a path this gate scans); a concurrent run here false-fails on them and
 * races the self-test's cleanup. The /start skill runs the gates in order.
 *
 * What this enforces (v1, structural coverage):
 *   1. Every Postgres table declared in schema.sql / migrations / setup-database.js
 *      is mentioned in at least one Atlas file.
 *   2. Every Dataverse entity-set name passed to a DynamicsService.* method
 *      is mentioned in at least one Atlas file.
 *
 * What it does NOT enforce (v2 future work):
 *   - Per-file caller registration. A new write site in an existing entity's
 *     domain still passes if the table/entity itself is covered.
 *
 * False-positive guard: maintain ALLOWED_UNDOCUMENTED below for entities
 * that intentionally aren't in the Atlas (e.g., test-only entity sets).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const atlasIndex = path.join(repoRoot, 'docs', 'APPLICATION_STATE_ATLAS.md');
const atlasDir = path.join(repoRoot, 'docs', 'atlas');

// Source dirs to scan for table/entity references.
const SCAN_DIRS = [
  path.join(repoRoot, 'lib'),
  path.join(repoRoot, 'pages', 'api'),
  path.join(repoRoot, 'scripts'),
];

// Where Postgres tables are declared.
const SCHEMA_FILES = [
  path.join(repoRoot, 'lib', 'db', 'schema.sql'),
  path.join(repoRoot, 'scripts', 'setup-database.js'),
];
const MIGRATIONS_DIR = path.join(repoRoot, 'lib', 'db', 'migrations');

// Postgres tables that are intentionally NOT in the Atlas (yet). Add a reason.
// Empty by default — keep it that way.
const ALLOWED_UNDOCUMENTED_TABLES = new Set([
]);

// Dataverse entity sets that are intentionally NOT in the Atlas. Standard
// vendor entities we never touch beyond a one-off probe go here.
const ALLOWED_UNDOCUMENTED_ENTITIES = new Set([
  'sharepointdocumentlocations', // vendor-only, accessed via lookup not direct

  // Platform/security entities — read by setup/role scripts, not the app:
  'roles',                  // scripts/apply-security-role.js — manage app user role
  'privileges',             // scripts/apply-security-role.js — privilege list lookups
  'businessunits',          // scripts/apply-security-role.js — root BU resolve
  'publishers',             // scripts/apply-dataverse-schema.js — solution publisher
  'solutions',              // scripts/apply-dataverse-schema.js — solution metadata

  // Microsoft Graph / SharePoint platform entities (Dataverse-side mirrors):
  'sharepointdocuments',    // virtual entity, vendor doc tracking — see graph-service.js
  'sharepointsites',        // vendor SharePoint site registration

  // Activity entities — used only by email-attachment paths:
  'activitymimeattachments', // SendEmail attachment binding (lib/services/dynamics-service.js)

  // Synthetic test-fixture names — never real entity sets:
  'should_not_count', // check-dataverse-access-layer-self-test.js exempt-path negative assertion
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    // Skip build artifacts + node_modules.
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) return [];
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// ── Step 1: enumerate Postgres tables ──────────────────────────────────────
function enumeratePostgresTables() {
  const tables = new Set();
  const re = /CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi;

  for (const f of SCHEMA_FILES) {
    const src = readFileSafe(f);
    let m;
    while ((m = re.exec(src)) !== null) tables.add(m[1].toLowerCase());
  }
  if (fs.existsSync(MIGRATIONS_DIR)) {
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
      if (!f.endsWith('.sql')) continue;
      const src = readFileSafe(path.join(MIGRATIONS_DIR, f));
      let m;
      while ((m = re.exec(src)) !== null) tables.add(m[1].toLowerCase());
    }
  }
  return tables;
}

// ── Step 2: enumerate Dataverse entity sets used in code ───────────────────
// Look for DynamicsService.{queryRecords,queryAllRecords,getRecord,createRecord,updateRecord,
//   deleteRecord}('<entitySet>'  — the first string arg is the entity set name.
function enumerateDataverseEntitySets() {
  const entities = new Set();

  // Pattern A: DynamicsService.<method>('<entitySet>', ...)
  // Includes search/count/aggregate helpers as well as CRUD.
  const dsRe = /DynamicsService\.(?:queryRecords|queryAllRecords|getRecord|createRecord|updateRecord|deleteRecord|countRecords|aggregateRecords|searchRecords|logAiRun)\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;

  // Pattern B: Wave-1-style raw client calls — client.{get,post,patch,delete,delete_,put}('/<entitySet>...')
  // (`delete_` because `delete` is a JS reserved word — the Dataverse client exposes it with a trailing underscore.)
  // The path may have query params, GUIDs, etc. — capture only the entity-set segment.
  const clientRe = /\bclient\.(?:get|post|patch|delete_?|put)\s*\(\s*['"`]\/([a-z_][a-z0-9_]*)/g;

  // Pattern C: $expand / $batch URL fragments that name the entity set inline.
  // Less common but appears in some adapters. (Conservative — may miss URL builders.)
  const odataPathRe = /\/api\/data\/v9\.[12]\/([a-z_][a-z0-9_]*)/g;

  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      if (!/\.(?:js|mjs|cjs)$/.test(file)) continue; // pattern E (CLAUDE_COVERAGE_LESSONS.md): traverse .mjs/.cjs, not just .js
      const src = readFileSafe(file);
      for (const re of [dsRe, clientRe, odataPathRe]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) entities.add(m[1].toLowerCase());
      }
    }
  }

  // Constants holding entity-set names — match any `<NAME>_ENTITY = 'wmkf_*'`
  // or `ENTITY_SET = 'wmkf_*'` const/let declarations. Catches the
  // PROMPTS_ENTITY / REQUESTS_ENTITY / RUNS_ENTITY pattern in execute-prompt.js
  // as well as the older ENTITY_SET pattern in adapter modules.
  const setRe = /(?:^|\s)(?:const|let)\s+(?:[A-Z][A-Z0-9_]*_ENTITY|ENTITY_SET)\s*=\s*['"]([a-z_][a-z0-9_]*)['"]/gm;
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      if (!/\.(?:js|mjs|cjs)$/.test(file)) continue; // pattern E (CLAUDE_COVERAGE_LESSONS.md): traverse .mjs/.cjs, not just .js
      const src = readFileSafe(file);
      let m;
      while ((m = setRe.exec(src)) !== null) entities.add(m[1].toLowerCase());
    }
  }

  // Strip out non-entity matches that the regexes can pick up:
  // OAuth resource paths (`oauth2`, `tenants`), search paths (`query`),
  // metadata (`entitydefinitions`).
  const NON_ENTITIES = new Set([
    'oauth2', 'tenants', 'query', 'entitydefinitions', 'globaloptionsetdefinitions',
    'permissions', 'token', 'common', 'authorize', 'me', 'sites', 'drives',
    'preferences', 'drive', 'root', 'children', 'items',
  ]);
  for (const e of NON_ENTITIES) entities.delete(e);

  return entities;
}

// ── Step 3: read all Atlas content ─────────────────────────────────────────
function readAtlasCorpus() {
  const parts = [readFileSafe(atlasIndex)];
  if (fs.existsSync(atlasDir)) {
    for (const f of fs.readdirSync(atlasDir)) {
      if (!f.endsWith('.md')) continue;
      parts.push(readFileSafe(path.join(atlasDir, f)));
    }
  }
  return parts.join('\n').toLowerCase();
}

// ── Step 4: check coverage ─────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(atlasIndex)) {
    console.error(`Missing Application State Atlas index: ${path.relative(repoRoot, atlasIndex)}`);
    process.exit(1);
  }

  const tables = enumeratePostgresTables();
  const entities = enumerateDataverseEntitySets();
  const atlas = readAtlasCorpus();

  const missingTables = [];
  for (const t of tables) {
    if (ALLOWED_UNDOCUMENTED_TABLES.has(t)) continue;
    // Match `t` as a backtick-quoted identifier or word-boundary mention.
    // Use a simple substring check after lowercasing — Atlas pages already
    // backtick the identifiers consistently.
    if (!atlas.includes(`\`${t}\``) && !atlas.includes(` ${t} `) && !atlas.includes(`${t}.`)) {
      missingTables.push(t);
    }
  }

  const missingEntities = [];
  for (const e of entities) {
    if (ALLOWED_UNDOCUMENTED_ENTITIES.has(e)) continue;
    if (!atlas.includes(`\`${e}\``) && !atlas.includes(` ${e} `) && !atlas.includes(`${e}.`)) {
      missingEntities.push(e);
    }
  }

  let failed = false;

  if (missingTables.length > 0) {
    console.error('Postgres tables declared in schema/migrations but NOT mentioned in any Atlas page:');
    for (const t of missingTables.sort()) console.error(`  - ${t}`);
    console.error(
      '\nAdd each table to docs/atlas/postgres-infra-tables.md (compact summary) or' +
      '\ngive it its own page under docs/atlas/. If intentional, add to' +
      '\nALLOWED_UNDOCUMENTED_TABLES in this script with a reason.\n',
    );
    failed = true;
  }

  if (missingEntities.length > 0) {
    console.error('Dataverse entity sets referenced in code but NOT mentioned in any Atlas page:');
    for (const e of missingEntities.sort()) console.error(`  - ${e}`);
    console.error(
      '\nAdd each entity to an Atlas page under docs/atlas/. If intentional,' +
      '\nadd to ALLOWED_UNDOCUMENTED_ENTITIES in this script with a reason.\n',
    );
    failed = true;
  }

  if (failed) process.exit(1);

  console.log(
    `Atlas coverage OK: ${tables.size} Postgres table(s), ${entities.size} Dataverse entity set(s).`,
  );
}

main();
