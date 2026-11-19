#!/usr/bin/env node
/**
 * Shows old-rule news flags in full for owner review: name, institution, the
 * old summary and the stored headlines and links. Case numbers match
 * scripts/replay-integrity-news-verdicts.cjs (same selection and order).
 * Read-only (READ ONLY transaction). Prints personal data: owner-run only.
 *
 * Usage:
 *   node scripts/show-integrity-news-flag-cases.cjs 1 2 3 4
 */
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

async function main() {
  const wanted = new Set(process.argv.slice(2).map(Number).filter(Number.isInteger));
  if (!wanted.size) throw new Error('Give one or more case numbers, e.g. 1 2 3 4');
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not set');
  const client = new Client({ connectionString: withVerifyFullSslmode(process.env.POSTGRES_URL) });
  await client.connect();
  let rows;
  try {
    await client.query('BEGIN READ ONLY');
    ({ rows } = await client.query(`
      SELECT s.id AS screening_id, s.created_at, p.person ->> 'name' AS name,
             p.person ->> 'institution' AS institution,
             p.person -> 'sources' -> 'news' AS news
      FROM integrity_screenings s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.results) = 'array' THEN s.results ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS p(person, ord)
      WHERE (p.person -> 'sources' -> 'news' ->> 'searched') = 'true'
        AND (p.person -> 'sources' -> 'news' ->> 'hasConcerns') = 'true'
      ORDER BY s.created_at, s.id, p.ord
    `));
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }

  for (const [index, row] of rows.entries()) {
    if (!wanted.has(index + 1)) continue;
    const { news } = row;
    console.log(`\n=== case ${index + 1} — screening ${row.screening_id}, ${row.created_at.toISOString().slice(0, 16)} UTC`);
    console.log(`name: ${row.name}\ninstitution: ${row.institution || '(none)'}`);
    console.log(`results found: ${news.resultCount ?? '?'}\n--- old summary ---\n${news.summary || '(none)'}\n--- stored results ---`);
    for (const [i, item] of (news.rawResults || []).entries()) {
      console.log(`[${i + 1}] ${item.title || '(no title)'}${item.source ? ` — ${typeof item.source === 'string' ? item.source : item.source.name || ''}` : ''}${item.date ? ` (${item.date})` : ''}\n    ${item.link || ''}`);
    }
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
