#!/usr/bin/env node
/**
 * READ-ONLY probe: board-writeup notice delivery vs open board-writeups alerts.
 *
 * Reads the app Postgres (POSTGRES_URL from .env.local) inside a READ ONLY
 * transaction. Prints, per cycle, each notice key with its kind and
 * create/send/accepted timestamps, and every non-resolved board-writeups alert
 * with its auto-resolve key. Never prints recipients, subjects, or bodies.
 *
 * Usage: node scripts/probe-board-notice-state.mjs [--cycle=D26]
 */

import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && !(match[1] in process.env)) {
    process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
if (!process.env.POSTGRES_URL) {
  console.error('POSTGRES_URL missing from .env.local.');
  process.exit(2);
}

const cycleArg = process.argv.find((a) => a.startsWith('--cycle='))?.slice('--cycle='.length) || null;
const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');

  const alerts = await client.query(
    `SELECT title, message, status, auto_resolve_key, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') || ' UTC' AS created_at
       FROM system_alerts
      WHERE source = 'board-writeups' AND status <> 'resolved'
      ORDER BY created_at`,
  );
  console.log(`Open board-writeups alerts: ${alerts.rows.length}`);
  for (const a of alerts.rows) {
    console.log(`  [${a.status}] ${a.created_at} ${a.title} — ${a.message} (key: ${a.auto_resolve_key})`);
  }

  const runs = await client.query(
    `SELECT cycle_code, revision, updated_at, state->'emails' AS emails
       FROM board_writeup_runs
      WHERE $1::text IS NULL OR cycle_code = $1
      ORDER BY cycle_code`,
    [cycleArg],
  );
  for (const run of runs.rows) {
    const emails = Object.entries(run.emails || {});
    console.log(`\nCycle ${run.cycle_code} (revision ${run.revision}, updated ${run.updated_at.toISOString()}): ${emails.length} notice(s)`);
    for (const [key, r] of emails.sort(([a], [b]) => a.localeCompare(b))) {
      const status = r.acceptedAt ? 'SENT' : r.sendStartedAt ? 'SENDING' : r.createStartedAt ? 'DRAFTED' : 'PENDING';
      console.log(`  ${status.padEnd(8)} ${key} kind=${r.kind} created=${r.createStartedAt || '-'} sent=${r.sendStartedAt || '-'} accepted=${r.acceptedAt || '-'}`);
    }
  }
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
