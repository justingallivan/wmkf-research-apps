#!/usr/bin/env node
/**
 * READ-ONLY census of live outside links that could serve a Site Visit
 * recording or transcript (docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
 * §2.1 "Exposure to close first"; Session 575 handoff Verified Open §1).
 *
 * Lists every non-revoked, unexpired row in `presentation_material_links`
 * (Board presentation link) and `deliberation_briefing_links` (briefing link)
 * with its request id and expiry. No token material is selected. The
 * transaction is READ ONLY. Owner-run against the app database
 * (`POSTGRES_URL` from .env.local); never run from an agent shell without
 * authorization.
 *
 * Usage:
 *   node scripts/probe-outside-link-exposure.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}

const QUERIES = [
  ['Board presentation links', `SELECT request_id, created_at, expires_at
     FROM presentation_material_links
     WHERE revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at`],
  ['Deliberation briefing links', `SELECT request_id, created_at, expires_at
     FROM deliberation_briefing_links
     WHERE revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at`],
];

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error('POSTGRES_URL is not set (expected in .env.local).');
  const { Client } = require('pg');
  const client = new Client({ connectionString: url, application_name: 'outside-link-exposure-readonly-probe' });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    for (const [label, text] of QUERIES) {
      const { rows } = await client.query(text);
      console.log(`\n${label}: ${rows.length} live`);
      for (const row of rows) {
        console.log(`  request ${row.request_id}  created ${row.created_at.toISOString()}  expires ${row.expires_at.toISOString()}`);
      }
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
  console.log('\nA live link for a request whose recording ran past the applicants leaving can serve the staff discussion until Stage 1 deploys.');
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
