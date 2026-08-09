#!/usr/bin/env node
/**
 * run-pair-gates.js — live replay CLI for the Stage 1 pair-consistency gate
 * (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md, "Agent-runnable
 * evaluation harness" deliverable 2).
 *
 * Replays the frozen pair-consistency case files
 * (cases/request-1002903-pairs.jsonl, cases/uc-sibling-pairs.jsonl, plus any
 * extra files passed via --cases) through the real
 * createInstitutionConsistencyChecker() in BOTH configurations — incumbent
 * (segmentComparison off, today's production default) and staged
 * (segmentComparison on, the Stage 1 opt-in) — using the real
 * createInstitutionIdentityResolver() as the resolver for both (Stage 1 has
 * no ROR; that swap is Stage 2 work and out of scope here).
 *
 * Gate vocabulary: a checker verdict of consistent=true maps to
 * "same-or-related"; consistent=false maps to "not-cleared". A case's
 * `expected` field drives the gate rule against the STAGED column only (the
 * incumbent column is printed for comparison, never gated):
 *   - expected "same"                       -> PASS iff staged=true
 *   - expected "distinct" | "related-surface" -> PASS iff staged=false
 *     (auto-clearing a distinct/related-surface pair is a FORBIDDEN VERDICT)
 *
 * Exit codes: 0 only if every case file loaded, every case ran (none
 * skipped), no provider/transport error occurred, and no forbidden verdict
 * was produced. A partial run is a failed run (Codex finding 4) — this
 * script never exits 0 on partial data.
 *
 * Usage:
 *   node run-pair-gates.js --slug <name> [--cases <path>]... [--timeout-ms <n>]
 *   node run-pair-gates.js --help
 *
 * Writes benchmarks/institution-pair-consistency/results/<slug>.json and
 * refuses to overwrite an existing slug file. Read-only against OpenAlex
 * (via the real resolver); no writes anywhere else. This driver is never run
 * against live providers by an agent session — it is invoked by the human
 * orchestrator only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;
const RESULTS_DIR = path.join(__dirname, 'results');
const DEFAULT_CASE_FILES = [
  path.join(__dirname, 'cases', 'request-1002903-pairs.jsonl'),
  path.join(__dirname, 'cases', 'uc-sibling-pairs.jsonl'),
  path.join(__dirname, 'cases', 'named-relationship-pairs.jsonl'),
];

// The three tracked case files the gate always requires by default,
// identified by basename (matches the `family` field loadCaseFile attaches).
// A prior Codex finding: the runner silently passes whatever case files it's
// given, so a future refactor that drops one of the defaults (or a run
// invoked with a truncated --cases override that doesn't replace all three)
// would gate on a smaller, non-representative case set without any signal.
// `assertRequiredCaseFiles` below fails fast on that before any live call.
const REQUIRED_CASE_FILES = new Set(DEFAULT_CASE_FILES.map((filePath) => path.basename(filePath)));

const REQUIRED_FIELDS = ['caseId', 'left', 'right', 'expected'];
const KNOWN_EXPECTED = new Set(['same', 'distinct', 'related-surface', 'insufficient']);

// ---------------------------------------------------------------------------
// Case loading (throws on missing/unparseable files — caller decides how to
// report that as a failed run).
// ---------------------------------------------------------------------------

function loadCaseFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`case file not found or unreadable: ${filePath} (${err.message})`);
  }
  const family = path.basename(filePath);
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      throw new Error(`unparseable JSONL at ${filePath}:${index + 1}: ${err.message}`);
    }
    return { ...row, family };
  });
}

function loadAllCases(extraPaths) {
  const files = [...DEFAULT_CASE_FILES, ...extraPaths];
  const rows = [];
  for (const file of files) {
    rows.push(...loadCaseFile(file));
  }
  return rows;
}

/**
 * Fails fast (throws, before any live provider call) unless every required
 * case-file family (by basename, matching `loadCaseFile`'s `family` tag)
 * contributed at least one row to the loaded case set. Catches both a
 * required file being absent from the loaded set entirely and a required
 * file that loaded but was empty (zero rows) — either way, a run that
 * silently drops a required family from the gate is not a real replay of
 * the full case set and must not proceed.
 */
function assertRequiredCaseFiles(cases, requiredBasenames = REQUIRED_CASE_FILES) {
  const rowCountByFamily = new Map();
  for (const row of Array.isArray(cases) ? cases : []) {
    const family = row?.family || 'unknown';
    rowCountByFamily.set(family, (rowCountByFamily.get(family) || 0) + 1);
  }
  const missing = [...requiredBasenames].filter((name) => !(rowCountByFamily.get(name) > 0));
  if (missing.length > 0) {
    throw new Error(`required case file(s) missing or contributed zero rows: ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Core replay logic — pure, dependency-injected, no network/module imports.
// Exported for the offline test (tests/unit/benchmarks/run-pair-gates-offline.test.js).
// ---------------------------------------------------------------------------

function verdictLabel(consistent) {
  return consistent ? 'same-or-related' : 'not-cleared';
}

function gatePasses(expected, stagedConsistent) {
  if (expected === 'same') return stagedConsistent === true;
  // distinct | related-surface | anything else (insufficient/unknown): must
  // NOT auto-clear.
  return stagedConsistent === false;
}

function isForbiddenVerdict(expected, stagedConsistent) {
  return expected !== 'same' && stagedConsistent === true;
}

function missingRequiredFields(row) {
  return REQUIRED_FIELDS.filter((field) => row[field] === undefined || row[field] === null || row[field] === '');
}

async function withTimeout(fn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const err = new Error(`timed out after ${timeoutMs}ms`);
    err.code = 'PAIR_GATE_TIMEOUT';
    controller.abort(err);
  }, timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one case row through both checkers. Never throws — errors are
 * captured on the returned result so the caller can tally them without
 * aborting the rest of the run.
 */
async function runOnePair(row, { incumbentChecker, stagedChecker, timeoutMs }) {
  const family = row.family || 'unknown';
  const missing = missingRequiredFields(row);
  if (missing.length > 0) {
    return {
      caseId: row.caseId || null,
      family,
      status: 'skipped',
      reason: `missing required field(s): ${missing.join(', ')}`,
    };
  }
  if (!KNOWN_EXPECTED.has(row.expected)) {
    return {
      caseId: row.caseId,
      family,
      status: 'skipped',
      reason: `unknown expected verdict: ${row.expected}`,
    };
  }

  try {
    const [incumbentConsistent, stagedConsistent] = await withTimeout(
      (signal) => Promise.all([
        incumbentChecker.areConsistent(row.left, row.right, { signal }),
        stagedChecker.areConsistent(row.left, row.right, { signal }),
      ]),
      timeoutMs,
    );

    const passed = gatePasses(row.expected, stagedConsistent);
    const forbidden = isForbiddenVerdict(row.expected, stagedConsistent);

    return {
      caseId: row.caseId,
      family,
      expected: row.expected,
      incumbentVerdict: verdictLabel(incumbentConsistent),
      stagedVerdict: verdictLabel(stagedConsistent),
      passed,
      forbidden,
      status: 'ok',
    };
  } catch (err) {
    return {
      caseId: row.caseId,
      family,
      status: 'error',
      error: err?.message || String(err),
    };
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Core entry point. `cases` is an already-loaded array of case rows (each
 * carrying `family`); `incumbentChecker`/`stagedChecker` are objects with an
 * `areConsistent(left, right, { signal }) => Promise<boolean>` method — the
 * real checker in production use, stub objects in the offline test.
 *
 * Returns { ok, rows, families, summary } — never throws. `ok` is false on
 * any skip, error, forbidden verdict, failed gate, or an empty case set.
 */
async function runPairGates({
  cases,
  incumbentChecker,
  stagedChecker,
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const rows = await mapWithConcurrency(
    Array.isArray(cases) ? cases : [],
    concurrency,
    (row) => runOnePair(row, { incumbentChecker, stagedChecker, timeoutMs }),
  );

  const families = {};
  const summary = {
    total: rows.length, passed: 0, failed: 0, skipped: 0, errors: 0, forbidden: 0,
  };

  for (const row of rows) {
    const fam = row.family || 'unknown';
    if (!families[fam]) {
      families[fam] = {
        total: 0, passed: 0, failed: 0, skipped: 0, errors: 0, forbidden: 0,
      };
    }
    families[fam].total += 1;

    if (row.status === 'skipped') {
      families[fam].skipped += 1;
      summary.skipped += 1;
      continue;
    }
    if (row.status === 'error') {
      families[fam].errors += 1;
      summary.errors += 1;
      continue;
    }
    if (row.forbidden) {
      families[fam].forbidden += 1;
      summary.forbidden += 1;
    }
    if (row.passed) {
      families[fam].passed += 1;
      summary.passed += 1;
    } else {
      families[fam].failed += 1;
      summary.failed += 1;
    }
  }

  const ok = rows.length > 0
    && summary.skipped === 0
    && summary.errors === 0
    && summary.forbidden === 0
    && summary.failed === 0;

  return {
    ok, rows, families, summary,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTable(result) {
  const familyNames = Object.keys(result.families).sort();
  const header = ['family', 'total', 'passed', 'failed', 'skipped', 'errors', 'forbidden'];
  const rows = familyNames.map((name) => {
    const f = result.families[name];
    return [name, f.total, f.passed, f.failed, f.skipped, f.errors, f.forbidden];
  });
  const widths = header.map((label, colIndex) => Math.max(
    label.length,
    ...rows.map((row) => String(row[colIndex]).length),
  ));
  const formatRow = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');

  console.log('\nPer-family verdict table:');
  console.log(formatRow(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(formatRow(row));

  console.log('\nCase-level detail:');
  for (const row of result.rows) {
    if (row.status === 'ok') {
      const mark = row.passed ? 'PASS' : (row.forbidden ? 'FORBIDDEN' : 'FAIL');
      console.log(`  [${mark}] ${row.caseId} (${row.family}) expected=${row.expected} incumbent=${row.incumbentVerdict} staged=${row.stagedVerdict}`);
    } else if (row.status === 'skipped') {
      console.log(`  [SKIPPED] ${row.caseId || '(no caseId)'} (${row.family}) — ${row.reason}`);
    } else {
      console.log(`  [ERROR] ${row.caseId} (${row.family}) — ${row.error}`);
    }
  }

  console.log('\nGate summary:', JSON.stringify(result.summary));
  console.log(result.ok ? '\nGATE: PASS' : '\nGATE: FAIL');
}

// ---------------------------------------------------------------------------
// Provenance + overall gating (Codex F2/F4 findings). A resolver-metrics
// provider-failure gate and the per-artifact provenance block are pure
// functions of already-computed inputs, so both are exported for the offline
// test — no network involved in exercising their shape/logic.
// ---------------------------------------------------------------------------

/**
 * Combines the row-level gate (`runPairGates`'s `result.ok`) with the shared
 * resolver's cumulative metrics. `metrics.providerFailures` is a monotonic
 * counter that is never reset mid-run and is never decremented by a later
 * success, so ANY nonzero value here means at least one OpenAlex call failed
 * during this run — including a failure on a query that a different,
 * unrelated query later resolved successfully. That must fail the gate even
 * when every row's verdict happens to still be correct, because a row's
 * `passed=true` cannot on its own distinguish "provider healthy, genuinely
 * distinct" from "provider dead, checker abstained to a false that happened
 * to match `expected`" (the F2 vacuous-pass mechanism). This is a deliberate
 * defense-in-depth check alongside row-level error propagation, not a
 * replacement for it.
 */
function gateOk(result, resolverMetrics) {
  const rowsOk = Boolean(result?.ok);
  const noProviderFailures = !resolverMetrics || resolverMetrics.providerFailures === 0;
  return rowsOk && noProviderFailures;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Best-effort git revision info. Never throws — a run outside a git checkout
 * (or with git unavailable) still produces an artifact, just with null
 * revision fields, rather than crashing the run.
 */
function gitRevisionInfo() {
  const cwd = path.join(__dirname, '..', '..');
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
    return { sha, dirty: porcelain.trim().length > 0 };
  } catch (err) {
    return { sha: null, dirty: null, error: err?.message || String(err) };
  }
}

/**
 * Builds the per-artifact provenance block (Codex F4): git revision + dirty
 * state, a sha256 of this script and of every case file actually consumed,
 * node version, and whether OPENALEX_API_KEY was present in process.env —
 * never the key value or any other env value. `scriptPath` is injected
 * (rather than hardcoding __filename) so the offline test can exercise this
 * against a temp script fixture without depending on the live file layout.
 */
function buildProvenance({ scriptPath, caseFiles }) {
  return Object.freeze({
    git: gitRevisionInfo(),
    scriptSha256: sha256File(scriptPath),
    caseFileHashes: caseFiles.map((filePath) => ({
      file: path.relative(process.cwd(), filePath),
      sha256: sha256File(filePath),
    })),
    nodeVersion: process.version,
    openAlexApiKeyPresent: Boolean(process.env.OPENALEX_API_KEY),
  });
}

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: node run-pair-gates.js --slug <name> [--cases <path>]... [--timeout-ms <n>]

Replays the Stage 1 pair-consistency case files through the real institution
consistency checker in both incumbent and staged (segmentComparison)
configurations, and prints a per-family gate table.

Options:
  --slug <name>        required; results are written to results/<name>.json
                        (refuses to overwrite an existing slug file)
  --cases <path>        extra JSONL case file to include (repeatable)
  --timeout-ms <n>       per-pair AbortController timeout (default ${DEFAULT_TIMEOUT_MS})
  --help                 print this message and exit 0

Reads live from OpenAlex via the production institution resolver. This
script is invoked by the human orchestrator only, never automatically by an
agent session.`);
}

function parseArgs(argv) {
  const args = { extraCases: [], timeoutMs: DEFAULT_TIMEOUT_MS, slug: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--slug') {
      args.slug = argv[i + 1] || null;
      i += 1;
    } else if (arg === '--cases') {
      if (argv[i + 1]) args.extraCases.push(argv[i + 1]);
      i += 1;
    } else if (arg === '--timeout-ms') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.timeoutMs = value;
      i += 1;
    }
  }
  return args;
}

// Same minimal .env.local loader as scripts/evaluate-reviewer-works-first.js:
// existing process.env keys win; quoted values are unwrapped.
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!key || parts.length === 0 || key in process.env) continue;
    let value = parts.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
    return;
  }

  if (!args.slug || !/^[\w.-]+$/.test(args.slug)) {
    console.error('Error: --slug <name> is required (bare filename fragment, no path separators).');
    printUsage();
    process.exit(2);
    return;
  }

  const outPath = path.join(RESULTS_DIR, `${args.slug}.json`);
  if (fs.existsSync(outPath)) {
    console.error(`Refusing to overwrite existing results: ${outPath}`);
    console.error('Frozen result files are the record — pick a new slug.');
    process.exit(2);
    return;
  }

  let cases;
  try {
    cases = loadAllCases(args.extraCases);
    assertRequiredCaseFiles(cases);
  } catch (err) {
    console.error(`Error loading case files: ${err.message}`);
    process.exit(1);
    return;
  }

  // Load .env.local (OPENALEX_API_KEY etc.) before any provider-backed module
  // is constructed — a keyless run uses OpenAlex's public pool and mass-times-
  // out on this case volume (observed live 2026-08-08: 120/145 timeouts).
  loadEnvLocal();

  // eslint-disable-next-line global-require
  const { createInstitutionConsistencyChecker } = require('../../lib/services/institution-affiliation-consistency');
  // eslint-disable-next-line global-require
  const { createInstitutionIdentityResolver } = require('../../lib/services/institution-identity-resolver');

  // One shared resolver instance backs BOTH checker configurations (incumbent
  // and staged) across BOTH fixture families for the whole run — its cache and
  // `metrics` counters are cumulative over every row, not per-family or
  // per-checker. propagateProviderErrors: true is load-bearing (Codex F2): the
  // default (false) degrades a provider exception to a null resolution, which
  // makes every distinct/related-surface row pass vacuously instead of
  // surfacing the failure. With this set, a provider exception throws through
  // checker.areConsistent into runOnePair's per-row error handling, which
  // marks that row status:'error' and fails the run.
  const sharedResolver = createInstitutionIdentityResolver({ propagateProviderErrors: true });
  const incumbentChecker = createInstitutionConsistencyChecker({
    resolver: sharedResolver,
    segmentComparison: false,
  });
  const stagedChecker = createInstitutionConsistencyChecker({
    resolver: sharedResolver,
    segmentComparison: true,
  });

  const result = await runPairGates({
    cases,
    incumbentChecker,
    stagedChecker,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: args.timeoutMs,
  });

  // Snapshot metrics only after every row has settled — the resolver's
  // counters accumulate monotonically across the whole run and are never
  // reset mid-run, so a mid-run read would be incomplete.
  const resolverMetrics = sharedResolver.metrics;
  const overallOk = gateOk(result, resolverMetrics);

  printTable({ ...result, ok: overallOk });
  console.log('\nResolver metrics (shared across both checker configs and both fixture families):', JSON.stringify(resolverMetrics));
  if (resolverMetrics.providerFailures > 0) {
    console.log(`\nGATE NOTE: ${resolverMetrics.providerFailures} provider failure(s) recorded — this fails the gate even if every row's verdict matched its expectation.`);
  }

  const caseFilesResolved = [...DEFAULT_CASE_FILES, ...args.extraCases];
  const provenance = buildProvenance({ scriptPath: __filename, caseFiles: caseFilesResolved });

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const artifact = {
    ranAt: new Date().toISOString(),
    slug: args.slug,
    caseFiles: caseFilesResolved.map((p) => path.relative(process.cwd(), p)),
    timeoutMs: args.timeoutMs,
    concurrency: DEFAULT_CONCURRENCY,
    // PASS means: every row's verdict matched its expectation AND zero
    // resolver-recorded provider failures occurred anywhere in the run
    // (Codex F2) — not just "no row-level errors".
    ok: overallOk,
    summary: result.summary,
    families: result.families,
    rows: result.rows,
    resolverMetrics,
    provenance,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nWrote results to ${outPath}`);

  process.exit(overallOk ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error running pair gates:', err?.stack || err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  runPairGates,
  runOnePair,
  loadCaseFile,
  loadAllCases,
  assertRequiredCaseFiles,
  REQUIRED_CASE_FILES,
  DEFAULT_CASE_FILES,
  verdictLabel,
  gatePasses,
  isForbiddenVerdict,
  missingRequiredFields,
  parseArgs,
  gateOk,
  sha256File,
  gitRevisionInfo,
  buildProvenance,
};
