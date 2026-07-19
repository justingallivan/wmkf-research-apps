#!/usr/bin/env node
/**
 * Canonical read-only report for reviewer_identity_shadow_log (migration 026).
 *
 * Usage:
 *   node scripts/report-reviewer-identity-shadow-log.js
 *   node scripts/report-reviewer-identity-shadow-log.js --days 7
 *   node scripts/report-reviewer-identity-shadow-log.js --run <run-id>
 *   node scripts/report-reviewer-identity-shadow-log.js --mode shadow|combined
 *   node scripts/report-reviewer-identity-shadow-log.js --all --json
 *
 * Default output includes errors, shadow arm disagreements, and every combined
 * mode comparison. Use --all to include shadow agreements too.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 5_000;
const RESOLVER_MODES = new Set(['shadow', 'combined']);

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function usage() {
  return `Usage:
  node scripts/report-reviewer-identity-shadow-log.js [options]

Options:
  --days <n>                 Look back n days (default: ${DEFAULT_DAYS})
  --run <run-id>             Report one resolver batch (all event types)
  --mode <shadow|combined>   Restrict rows to one resolver mode
  --limit <n>                Maximum detail rows (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})
  --all                      Include shadow agreement rows
  --json                     Emit machine-readable JSON
  --help, -h                 Show this help

--run and --days are mutually exclusive. A run report defaults to the ${MAX_LIMIT}
row safety cap so normal reviewer batches are not truncated at the window-report
default.`;
}

function valueAfter(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

function positiveInteger(value, flag, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(String(value || ''))) {
    throw new UsageError(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new UsageError(`${flag} must be between 1 and ${max}`);
  }
  return parsed;
}

function parseArgs(argv = []) {
  const args = {
    days: DEFAULT_DAYS,
    daysExplicit: false,
    run: null,
    mode: null,
    all: false,
    json: false,
    help: false,
    limit: DEFAULT_LIMIT,
    limitExplicit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--days') {
      args.days = positiveInteger(valueAfter(argv, i, arg), arg);
      args.daysExplicit = true;
      i += 1;
    } else if (arg === '--run') {
      args.run = valueAfter(argv, i, arg);
      i += 1;
    } else if (arg === '--mode') {
      args.mode = valueAfter(argv, i, arg).toLowerCase();
      if (!RESOLVER_MODES.has(args.mode)) {
        throw new UsageError('--mode must be shadow or combined');
      }
      i += 1;
    } else if (arg === '--limit') {
      args.limit = positiveInteger(valueAfter(argv, i, arg), arg, MAX_LIMIT);
      args.limitExplicit = true;
      i += 1;
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }

  if (args.run && args.daysExplicit) {
    throw new UsageError('--run and --days cannot be used together');
  }
  if (args.run && !args.limitExplicit) args.limit = MAX_LIMIT;
  return args;
}

function loadDotenv({ cwd = process.cwd(), env = process.env } = {}) {
  for (const filename of ['.env', '.env.local']) {
    try {
      const text = fs.readFileSync(path.join(cwd, filename), 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator < 0) continue;
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
        if (!env[key]) env[key] = value;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function buildScope(args) {
  const clauses = [];
  const params = [];
  if (args.run) {
    params.push(args.run);
    clauses.push(`run_id = $${params.length}`);
  } else {
    params.push(args.days);
    clauses.push(`created_at > NOW() - MAKE_INTERVAL(days => $${params.length})`);
  }
  if (args.mode) {
    params.push(args.mode);
    clauses.push(`resolver_mode = $${params.length}`);
  }
  return {
    where: clauses.join(' AND '),
    params,
    description: args.run ? `run ${args.run}` : `last ${args.days} day(s)`,
  };
}

function buildQueries(args) {
  const scope = buildScope(args);
  const summary = {
    text: `SELECT
             COUNT(*) FILTER (WHERE event_type = 'comparison') AS comparisons,
             COUNT(*) FILTER (WHERE event_type = 'comparison'
               AND legacy_decision IS DISTINCT FROM works_decision) AS arm_disagreements,
             COUNT(*) FILTER (WHERE event_type = 'comparison'
               AND resolver_mode = 'combined' AND combined_decision = 'bind') AS authoritative_binds,
             COUNT(*) FILTER (WHERE event_type = 'comparison'
               AND resolver_mode = 'combined' AND combined_decision = 'review') AS authoritative_reviews,
             COUNT(*) FILTER (WHERE event_type = 'comparison'
               AND resolver_mode = 'combined' AND combined_decision = 'abstain') AS authoritative_abstentions,
             COUNT(*) FILTER (WHERE event_type = 'comparison'
               AND resolver_mode = 'combined'
               AND (combined_decision IS NULL
                 OR combined_decision NOT IN ('bind', 'review', 'abstain'))) AS authoritative_other,
             COUNT(*) FILTER (WHERE event_type = 'error') AS errors,
             COUNT(DISTINCT run_id) AS runs,
             MIN(created_at) AS oldest,
             MAX(created_at) AS newest
           FROM reviewer_identity_shadow_log
           WHERE ${scope.where}`,
    params: [...scope.params],
  };

  const attentionFilter = args.run || args.all
    ? ''
    : ` AND (
        event_type = 'error'
        OR resolver_mode = 'combined'
        OR legacy_decision IS DISTINCT FROM works_decision
      )`;
  const rowParams = [...scope.params, args.limit];
  const rows = {
    text: `SELECT run_id, resolver_mode, event_type, candidate_key,
                  legacy_decision, works_decision, combined_decision,
                  combined_reason, anchors_agree, error_code, created_at
           FROM reviewer_identity_shadow_log
           WHERE ${scope.where}${attentionFilter}
           ORDER BY created_at DESC, id DESC
           LIMIT $${rowParams.length}`,
    params: rowParams,
  };

  return { scope, summary, rows };
}

async function queryReport(client, args) {
  const queries = buildQueries(args);
  const summaryResult = await client.query(queries.summary.text, queries.summary.params);
  const rowsResult = await client.query(queries.rows.text, queries.rows.params);
  return {
    scope: {
      runId: args.run,
      windowDays: args.run ? null : args.days,
      resolverMode: args.mode,
    },
    summary: summaryResult.rows[0],
    rows: rowsResult.rows,
  };
}

function formatHuman(report, args) {
  const { summary, rows } = report;
  const lines = [
    `Resolver comparison log, ${args.run ? `run ${args.run}` : `last ${args.days} day(s)`}`
      + `${args.mode ? `, mode=${args.mode}` : ''}:`,
    `  ${summary.comparisons} comparison(s) across ${summary.runs} run(s)`,
    `  ${summary.arm_disagreements} legacy-vs-works arm disagreement(s)`,
    `  authoritative combined outcomes: bind=${summary.authoritative_binds}, review=${summary.authoritative_reviews}, abstain=${summary.authoritative_abstentions}, other=${summary.authoritative_other}`,
    `  ${summary.errors} error(s)`,
  ];
  if (summary.newest) lines.push(`  observed: ${summary.oldest} -> ${summary.newest}`);
  if (!rows.length) {
    lines.push(args.run ? 'No rows for this run.' : 'No attention rows in this scope.');
    return lines.join('\n');
  }

  lines.push('', `${args.run || args.all ? 'All' : 'Attention'} rows (newest first, limit ${args.limit}):`);
  for (const row of rows) {
    const stamp = new Date(row.created_at).toISOString();
    const candidate = row.candidate_key || 'unknown-candidate';
    if (row.event_type === 'error') {
      lines.push(
        `  [${stamp}] mode=${row.resolver_mode} run=${row.run_id} key=${candidate}`
        + ` ERROR ${row.error_code}`,
      );
      continue;
    }
    const armDisagreement = row.legacy_decision !== row.works_decision;
    const outcomeLabel = row.resolver_mode === 'combined'
      ? 'authoritative'
      : (row.resolver_mode === 'shadow' ? 'shadow-combined' : 'unknown-mode-outcome');
    lines.push(
      `  [${stamp}] mode=${row.resolver_mode} run=${row.run_id} key=${candidate}`
      + ` arms=${row.legacy_decision}/${row.works_decision}`
      + ` armDisagreement=${armDisagreement} ${outcomeLabel}=${row.combined_decision}`
      + ` (${row.combined_reason}; anchorsAgree=${row.anchors_agree})`,
    );
  }
  return lines.join('\n');
}

async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  ClientClass = null,
  log = console.log,
  error = console.error,
} = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (parseError) {
    if (!(parseError instanceof UsageError)) throw parseError;
    error(parseError.message);
    error(usage());
    return 2;
  }

  if (args.help) {
    log(usage());
    return 0;
  }

  loadDotenv({ cwd, env });
  const connectionString = env.POSTGRES_URL || env.DATABASE_URL;
  if (!connectionString) {
    error('POSTGRES_URL / DATABASE_URL not set');
    return 1;
  }

  const DatabaseClient = ClientClass || require('pg').Client;
  const client = new DatabaseClient({ connectionString });
  try {
    await client.connect();
    const report = await queryReport(client, args);
    log(args.json ? JSON.stringify(report, null, 2) : formatHuman(report, args));
    return 0;
  } catch (queryError) {
    if (queryError.code === '42P01') {
      error('reviewer_identity_shadow_log does not exist in the target database.');
      error('Migration 026 has not been applied — run: node scripts/apply-migrations.js');
      return 1;
    }
    error(`report-reviewer-identity-shadow-log failed: ${queryError.message}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(`report-reviewer-identity-shadow-log failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_DAYS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  UsageError,
  buildQueries,
  buildScope,
  formatHuman,
  loadDotenv,
  parseArgs,
  queryReport,
  runCli,
  usage,
};
