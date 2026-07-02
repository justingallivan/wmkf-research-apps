#!/usr/bin/env node
/**
 * READ-ONLY: inspect the Postgres reviewer_find_roster candidate blob for
 * request 1003020, to see the ENRICHMENT-TIME email state per candidate:
 * candidate.email, contactEnrichment.email, emailSource, emailPersistAllowed,
 * affiliationPersistAllowed, contactStatus. Explains why some Find candidates
 * kept their email at save and others didn't.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}
// @vercel/postgres reads POSTGRES_URL; fall back to DATABASE_URL.
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;

const REQ_GUID = process.argv[2] || '8a0efbb3-8d45-f111-88b4-000d3a306da2';

const { sql } = await import('@vercel/postgres');

const res = await sql`
  SELECT display_name, status, source_kind, candidate
  FROM reviewer_find_roster
  WHERE request_id = ${REQ_GUID}
  ORDER BY display_name
`;

console.log(`roster rows for request ${REQ_GUID}: ${res.rows.length}\n`);
console.log('name | status | source_kind | c.email | enr.email | emailSource | emailPersistAllowed | affPersistAllowed | contactStatus');
console.log('---------------------------------------------------------------------------------------------------------------------');
for (const r of res.rows) {
  const c = r.candidate || {};
  const enr = c.contactEnrichment || {};
  const line = [
    r.display_name,
    r.status,
    r.source_kind,
    c.email || '∅',
    enr.email || '∅',
    c.emailSource || enr.emailSource || '∅',
    (c.emailPersistAllowed ?? enr.emailPersistAllowed ?? '∅'),
    (c.affiliationPersistAllowed ?? enr.affiliationPersistAllowed ?? '∅'),
    (c.contactStatus || enr.contactStatus || '∅'),
  ].join(' | ');
  console.log(line);
}
process.exit(0);
