#!/usr/bin/env node
/*
 * Analyze Dynamics Explorer failure signals to GROUND Path A prioritization
 * (do the live-taxonomy / live-schema changes actually target real failures?).
 * READ-ONLY. Run: node scripts/analyze-dynamics-explorer-failures.js
 *
 * Sources:
 *   dynamics_query_log  — record_count = -1 → errored tool call (chat.js),
 *                          record_count = 0 → zero results, was_denied → blocked.
 *   dynamics_feedback   — thumbs-down by category, auto_detected, query_text.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (e) { /* file may not exist */ }
}

const { sql } = await import('@vercel/postgres');

async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`  [${label}] query failed: ${e.message.slice(0, 120)}`);
    return null;
  }
}

function table(rows, cols) {
  if (!rows || !rows.length) { console.log('  (none)'); return; }
  for (const r of rows) {
    console.log('  ' + cols.map(c => String(r[c] ?? '').slice(0, 60).padEnd(c === cols[cols.length - 1] ? 0 : 24)).join(''));
  }
}

console.log('\n================ DYNAMICS EXPLORER FAILURE ANALYSIS ================\n');

// Volume + date range
await safe('volume', async () => {
  const r = await sql`SELECT COUNT(*)::int AS total, MIN(created_at) AS first, MAX(created_at) AS last FROM dynamics_query_log`;
  const v = r.rows[0];
  console.log(`query_log rows: ${v.total}  (from ${v.first} to ${v.last})`);
});

console.log('\n--- Errored tool calls (record_count = -1) by query_type ---');
await safe('errors-by-type', async () => {
  const r = await sql`SELECT query_type, COUNT(*)::int AS n FROM dynamics_query_log WHERE record_count = -1 GROUP BY query_type ORDER BY n DESC`;
  table(r.rows, ['query_type', 'n']);
});

console.log('\n--- Errored tool calls by table_name (top 15) ---');
await safe('errors-by-table', async () => {
  const r = await sql`SELECT COALESCE(table_name,'(none)') AS table_name, COUNT(*)::int AS n FROM dynamics_query_log WHERE record_count = -1 GROUP BY table_name ORDER BY n DESC LIMIT 15`;
  table(r.rows, ['table_name', 'n']);
});

console.log('\n--- Zero-result queries (record_count = 0) by query_type ---');
await safe('zero-by-type', async () => {
  const r = await sql`SELECT query_type, COUNT(*)::int AS n FROM dynamics_query_log WHERE record_count = 0 GROUP BY query_type ORDER BY n DESC`;
  table(r.rows, ['query_type', 'n']);
});

console.log('\n--- Denials by reason (was_denied = true) ---');
await safe('denials', async () => {
  const r = await sql`SELECT COALESCE(denial_reason,'(none)') AS denial_reason, COUNT(*)::int AS n FROM dynamics_query_log WHERE was_denied = true GROUP BY denial_reason ORDER BY n DESC LIMIT 20`;
  table(r.rows, ['denial_reason', 'n']);
});

console.log('\n--- Sample errored query_params (last 20) — what was the model trying? ---');
await safe('error-samples', async () => {
  const r = await sql`SELECT query_type, table_name, query_params FROM dynamics_query_log WHERE record_count = -1 ORDER BY created_at DESC LIMIT 20`;
  for (const row of (r.rows || [])) {
    console.log(`  [${row.query_type} / ${row.table_name}] ${JSON.stringify(row.query_params).slice(0, 200)}`);
  }
  if (!r.rows?.length) console.log('  (none)');
});

console.log('\n--- Feedback by type + category ---');
await safe('feedback', async () => {
  const r = await sql`SELECT feedback_type, COALESCE(category,'(none)') AS category, COUNT(*)::int AS n, SUM(CASE WHEN auto_detected THEN 1 ELSE 0 END)::int AS auto FROM dynamics_feedback GROUP BY feedback_type, category ORDER BY n DESC`;
  console.log('  type        category                n     auto');
  for (const row of (r.rows || [])) {
    console.log(`  ${String(row.feedback_type).padEnd(11)} ${String(row.category).padEnd(23)} ${String(row.n).padEnd(5)} ${row.auto}`);
  }
  if (!r.rows?.length) console.log('  (none)');
});

console.log('\n--- Recent negative-feedback query_text (last 25) — the actual failing asks ---');
await safe('negative-samples', async () => {
  const r = await sql`SELECT category, query_text FROM dynamics_feedback WHERE feedback_type <> 'positive' ORDER BY created_at DESC LIMIT 25`;
  for (const row of (r.rows || [])) {
    console.log(`  [${row.category}] ${String(row.query_text ?? '').replace(/\s+/g, ' ').slice(0, 140)}`);
  }
  if (!r.rows?.length) console.log('  (none)');
});

console.log('\n===================================================================\n');
process.exit(0);
