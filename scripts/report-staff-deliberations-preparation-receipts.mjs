#!/usr/bin/env node
/**
 * Owner-run, READ-ONLY report of Staff Deliberations automatic-preparation
 * receipts (staff_deliberations_preparations) for one cycle, labelled with
 * request numbers from Dataverse. Performs no writes.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

async function main() {
  const match = process.argv.slice(2).map((value) => value.match(/^--cycle=([JD]\d{2})$/i)).find(Boolean);
  if (!match) throw new Error('Usage: --cycle=<D26|J27|...>');
  const cycleCode = match[1].toUpperCase();
  loadEnvLocal();
  if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;
  const { sql } = await import('@vercel/postgres');
  const grantRequestAdapter = await import('../lib/dataverse/adapters/grant-request.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');

  const host = (() => { try { return new URL(process.env.POSTGRES_URL).host; } catch { return 'unknown'; } })();
  const { rows } = await sql.query(`
    SELECT DISTINCT ON (request_id) request_id, state, attempt_count, last_error_code,
      left(last_error_message, 160) AS last_error_message, scheduled_end, updated_at,
      provenance->>'operation' AS operation
    FROM staff_deliberations_preparations
    WHERE cycle_code = $1
    ORDER BY request_id, updated_at DESC`, [cycleCode]);

  const numbers = await withDalContext('local-staff-deliberations-receipt-report', async () => {
    const out = new Map();
    for (const row of rows) {
      const request = await grantRequestAdapter.getById(row.request_id, { select: ['akoya_requestnum'] }).catch(() => null);
      out.set(row.request_id, request?.akoya_requestnum || '?');
    }
    return out;
  });

  console.log(`READ-ONLY · Postgres ${host} · cycle ${cycleCode} · ${rows.length} receipts`);
  console.table(rows
    .map((row) => ({
      num: numbers.get(row.request_id),
      state: row.state,
      attempts: row.attempt_count,
      operation: row.operation || '',
      error: row.last_error_code || '',
      message: row.last_error_message || '',
      updated: new Date(row.updated_at).toISOString().slice(0, 19),
    }))
    .sort((a, b) => String(a.num).localeCompare(String(b.num))));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
