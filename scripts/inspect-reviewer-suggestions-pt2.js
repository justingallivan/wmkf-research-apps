#!/usr/bin/env node
/**
 * Pt2: characterize researchers/email coverage and request_number → GUID
 * resolvability for the rows we plan to backfill.
 */

require('./../lib/dataverse/client').loadEnvLocal();
const { sql } = require('@vercel/postgres');

(async () => {
  // Researcher email coverage
  const cov = await sql`
    SELECT
      COUNT(*)::int AS rows,
      COUNT(*) FILTER (WHERE r.email IS NOT NULL AND r.email <> '')::int AS with_email,
      COUNT(*) FILTER (WHERE r.email IS NULL OR r.email = '')::int AS no_email,
      COUNT(*) FILTER (WHERE r.orcid IS NOT NULL)::int AS with_orcid,
      COUNT(*) FILTER (WHERE r.h_index IS NOT NULL)::int AS with_hindex
    FROM reviewer_suggestions rs
    JOIN researchers r ON r.id = rs.researcher_id
    WHERE rs.request_number IS NOT NULL
  `;
  console.log('Suggestion → researcher coverage (rows with request_number):');
  console.log(' ', cov.rows[0]);

  // Distinct request_numbers
  const reqs = await sql`
    SELECT DISTINCT request_number
    FROM reviewer_suggestions
    WHERE request_number IS NOT NULL AND request_number <> ''
    ORDER BY request_number
  `;
  console.log(`\nDistinct request_numbers: ${reqs.rows.length}`);
  console.log('  list:', reqs.rows.map((r) => r.request_number).join(', '));

  // grant_cycles table content
  const cycles = await sql`SELECT id, short_code, name FROM grant_cycles ORDER BY id`;
  console.log('\nGrant cycles in Postgres:');
  for (const c of cycles.rows) console.log(`  id=${c.id}  short_code=${c.short_code}  name=${c.name}`);

  // Resolve every distinct request_number against Dataverse → GUID
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('inspect');
  const resolved = [];
  const missed = [];
  for (const { request_number: rn } of reqs.rows) {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum,akoya_title',
      filter: `akoya_requestnum eq '${rn.replace(/'/g, "''")}'`,
      top: 1,
    });
    if (records[0]) resolved.push({ rn, guid: records[0].akoya_requestid, title: records[0].akoya_title });
    else missed.push(rn);
  }
  console.log(`\nResolved: ${resolved.length} / ${reqs.rows.length}`);
  if (missed.length) console.log('  MISSED:', missed.join(', '));
  for (const r of resolved) console.log(`  ${r.rn} → ${r.guid}  (${(r.title || '').slice(0, 60)})`);

  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
