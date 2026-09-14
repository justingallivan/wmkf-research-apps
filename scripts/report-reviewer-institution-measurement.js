#!/usr/bin/env node
/** Read-only, aggregate report. No names, case keys, or request identifiers. */
'use strict';

const fs = require('fs');
const path = require('path');

// Same local operator-env convention as report-reviewer-identity-shadow-log.
// The report never prints environment values.
for (const filename of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(path.join(process.cwd(), filename), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const { sql } = require('@vercel/postgres');

async function main() {
  const rawDays = process.argv[2] || '30';
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('Usage: node scripts/report-reviewer-institution-measurement.js [days: 1-90]');
  }
  const events = await sql`
    SELECT event_type, capture_source, outcome_category, COUNT(*)::integer AS events,
           COUNT(DISTINCT case_key)::integer AS cases
    FROM reviewer_institution_measurement_events
    WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})
    GROUP BY event_type, capture_source, outcome_category
    ORDER BY event_type, capture_source, outcome_category
  `;
  const cases = await sql`
    WITH cases AS (
      SELECT case_key,
             BOOL_OR(event_type = 'roster_upsert') AS surfaced,
             BOOL_OR(capture_source = 'server_applicant' AND relationship IS NOT NULL) AS typed,
             BOOL_OR(capture_source = 'server_applicant' AND legacy_hold IS TRUE) AS trusted_legacy_hold,
             BOOL_OR(event_type LIKE 'staff_%') AS staff_action,
             BOOL_OR(event_type = 'save_saved') AS saved,
             BOOL_OR(event_type = 'save_rejected') AS rejected
      FROM reviewer_institution_measurement_events
      WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})
      GROUP BY case_key
    )
    SELECT COUNT(*)::integer AS observed_cases,
           COUNT(*) FILTER (WHERE surfaced)::integer AS surfaced_cases,
           COUNT(*) FILTER (WHERE typed)::integer AS typed_cases,
           COUNT(*) FILTER (WHERE trusted_legacy_hold)::integer AS trusted_legacy_hold_cases,
           COUNT(*) FILTER (WHERE staff_action)::integer AS cases_with_staff_action,
           COUNT(*) FILTER (WHERE trusted_legacy_hold AND staff_action)::integer AS trusted_hold_with_staff_action,
           COUNT(*) FILTER (WHERE saved)::integer AS cases_saved,
           COUNT(*) FILTER (WHERE rejected)::integer AS cases_rejected
    FROM cases
  `;
  const result = {
    windowDays: days,
    coverage: 'captured events only; failed/missing inserts are not in the denominator',
    authority: 'observation only; no automatic clear can be scored',
    cases: cases.rows[0],
    events: events.rows,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.code || error?.message || 'report failed');
  process.exitCode = 1;
});
