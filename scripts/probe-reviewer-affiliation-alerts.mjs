#!/usr/bin/env node
/**
 * READ-ONLY probe of reviewer affiliation-mismatch alerts in system_alerts.
 *
 * Written for the S412 question "which historical affiliation alerts are safe to
 * batch-resolve?". It performs NO writes. The point is to separate:
 *   - alerts whose underlying condition is genuinely fixed (the Contact now has
 *     the right parent Account), which are stale signal, from
 *   - alerts whose mismatch is still real, where resolving would destroy the only
 *     record that the reviewer needs attention.
 *
 * Only 9 Contacts were linked in the S412 production pass, so a blanket resolve of
 * every row matching the key prefix is NOT equivalent to a resolve of the fixed
 * ones. This prints both populations and never merges them.
 *
 * Usage: node scripts/probe-reviewer-affiliation-alerts.mjs
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
  } catch { /* optional env file */ }
}

const { sql } = await import('@vercel/postgres');

const KEY_PREFIX = 'reviewer-affiliation-mismatch:';

const byStatus = await sql.query(
  `SELECT status, COUNT(*)::int AS c
     FROM system_alerts
    WHERE auto_resolve_key LIKE $1
    GROUP BY status
    ORDER BY status`,
  [`${KEY_PREFIX}%`],
);
console.log('=== affiliation-mismatch alerts by status ===');
for (const r of byStatus.rows) console.log(`  ${r.status.padEnd(14)} ${r.c}`);

const open = await sql.query(
  `SELECT id, status, created_at, auto_resolve_key, title, metadata
     FROM system_alerts
    WHERE auto_resolve_key LIKE $1
      AND status IN ('active', 'acknowledged')
    ORDER BY created_at ASC`,
  [`${KEY_PREFIX}%`],
);
console.log(`\n=== open (active|acknowledged): ${open.rows.length} ===`);
for (const r of open.rows) {
  const md = r.metadata || {};
  console.log(
    `  id=${r.id} ${r.status} ${new Date(r.created_at).toISOString().slice(0, 10)} ` +
    `key=${r.auto_resolve_key} contact=${md.contactId || md.contact_id || '?'} ` +
    `affiliation=${JSON.stringify(md.reviewerAffiliation || md.affiliation || null)} ` +
    `parent=${JSON.stringify(md.parentAccountName || md.currentParentName || null)}`,
  );
}

// Distinct subject ids, so the denominator is reviewers, not rows.
const subjects = new Set(open.rows.map((r) => String(r.auto_resolve_key).slice(KEY_PREFIX.length)));
console.log(`\nDistinct subjects with an open alert: ${subjects.size}`);
console.log('Subjects:', [...subjects].join(', ') || '(none)');

// Also report the newer capped-scan key, which the S412 correction introduced.
const capped = await sql.query(
  `SELECT status, COUNT(*)::int AS c
     FROM system_alerts
    WHERE auto_resolve_key = $1
    GROUP BY status`,
  ['reviewer-contact-account-scan-capped'],
);
console.log('\n=== capped-scan alerts (new S412 key) ===');
if (!capped.rows.length) console.log('  none');
for (const r of capped.rows) console.log(`  ${r.status.padEnd(14)} ${r.c}`);

console.log('\nNO WRITES PERFORMED.');
process.exit(0);
