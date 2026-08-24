#!/usr/bin/env node

/** Read-only migration-035 shape/readback probe. Prints no roster addresses. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 1) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const { sql } = await import('@vercel/postgres');
const expectedColumns = [
  ['expertise_roster', 'preferred_email'],
  ['pre_site_distribution_attempts', 'calendar_enabled'],
  ['pre_site_distribution_attempts', 'site_visit_id'],
  ['pre_site_distribution_attempts', 'site_visit_etag'],
  ['pre_site_distribution_attempts', 'site_visit_snapshot'],
  ['pre_site_distribution_attempts', 'material_links'],
  ['pre_site_distribution_attempts', 'calendar_filename'],
  ['pre_site_distribution_attempts', 'calendar_content_type'],
  ['pre_site_distribution_attempts', 'calendar_byte_hash'],
  ['pre_site_distribution_attempts', 'calendar_size'],
  ['pre_site_distribution_attempts', 'calendar_attached_at'],
];
const columns = await sql`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('expertise_roster', 'pre_site_distribution_attempts')
  ORDER BY table_name, column_name
`;
const foundColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
const missingColumns = expectedColumns
  .map(([table, column]) => `${table}.${column}`)
  .filter((key) => !foundColumns.has(key));

const constraints = await sql`
  SELECT conname
  FROM pg_constraint
  WHERE conrelid = 'pre_site_distribution_attempts'::regclass
    AND conname IN (
      'pre_site_distribution_hash_shape',
      'pre_site_distribution_material_links_shape',
      'pre_site_distribution_calendar_shape'
    )
  ORDER BY conname
`;
const expectedConstraints = [
  'pre_site_distribution_calendar_shape',
  'pre_site_distribution_hash_shape',
  'pre_site_distribution_material_links_shape',
];
const foundConstraints = constraints.rows.map((row) => row.conname);
const migration = await sql`
  SELECT name, applied_at
  FROM schema_migrations
  WHERE name = '035_site_visit_logistics.sql'
`;
const counts = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM pre_site_distribution_attempts) AS attempts,
    (SELECT COUNT(*)::int FROM pre_site_distribution_attempts WHERE calendar_enabled) AS calendar_attempts,
    (SELECT COUNT(*)::int FROM expertise_roster WHERE preferred_email IS NOT NULL) AS roster_emails
`;

const exact = missingColumns.length === 0
  && JSON.stringify(foundConstraints) === JSON.stringify(expectedConstraints)
  && migration.rows.length === 1;
console.log(JSON.stringify({
  migration: migration.rows[0] || null,
  expectedColumnCount: expectedColumns.length,
  missingColumns,
  constraints: foundConstraints,
  rowCounts: counts.rows[0],
  exact,
}, null, 2));
if (!exact) process.exitCode = 1;
