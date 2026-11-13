#!/usr/bin/env node
/**
 * Read-only sizing for comparing integrity news verdicts before and after the
 * 2026-11-07 news-analysis change (318f9642c, 35a445bec). Prints aggregate
 * counts only: no names, snippets, links or request ids.
 *
 * Usage (owner-run; reads the database in .env.local's POSTGRES_URL):
 *   node scripts/probe-integrity-news-verdict-sizing.cjs
 */
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

async function main() {
  const raw = process.env.POSTGRES_URL;
  if (!raw) throw new Error('POSTGRES_URL is not set');
  console.log(`database host: ${new URL(raw).hostname}`);
  const client = new Client({ connectionString: withVerifyFullSslmode(raw) });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows: [r] } = await client.query(`
      WITH people AS (
        SELECT s.id, s.screening_type, s.created_at, p.person -> 'sources' -> 'news' AS news
        FROM integrity_screenings s
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(s.results) = 'array' THEN s.results ELSE '[]'::jsonb END
        ) AS p(person)
      ),
      searched AS (SELECT * FROM people WHERE (news ->> 'searched') = 'true'),
      raws AS (
        SELECT item FROM searched
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(news -> 'rawResults', '[]'::jsonb)) AS x(item)
      )
      SELECT
        (SELECT count(*) FROM integrity_screenings) AS screenings,
        (SELECT min(created_at)::date FROM integrity_screenings) AS first_screening,
        (SELECT max(created_at)::date FROM integrity_screenings) AS last_screening,
        (SELECT count(*) FROM people) AS people_screened,
        (SELECT count(*) FROM searched) AS news_searched,
        (SELECT count(*) FROM searched WHERE (news ->> 'hasConcerns') = 'true') AS news_flagged_old_rule,
        (SELECT count(*) FROM searched WHERE (news ->> 'analysisOutcome') IS NOT NULL) AS news_already_new_rule,
        (SELECT count(*) FROM searched WHERE jsonb_array_length(COALESCE(news -> 'rawResults', '[]'::jsonb)) > 0) AS news_with_stored_results,
        (SELECT count(*) FROM raws) AS stored_results,
        (SELECT count(*) FROM raws WHERE COALESCE(item ->> 'snippet', '') = '') AS stored_results_without_snippet,
        (SELECT count(*) FROM searched WHERE (news ->> 'resultCount')::int > 5) AS news_with_more_than_5_results
    `);
    await client.query('ROLLBACK');
    for (const [key, value] of Object.entries(r)) console.log(`${key}: ${value instanceof Date ? value.toISOString().slice(0, 10) : value}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
