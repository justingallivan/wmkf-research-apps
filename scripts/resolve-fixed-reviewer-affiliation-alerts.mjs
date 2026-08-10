#!/usr/bin/env node
/**
 * One-off (S412): resolve reviewer affiliation-mismatch alerts whose underlying
 * condition is genuinely fixed, plus one confirmed test-data row.
 *
 * WHY THIS IS AN ALLOWLIST, NOT A PREFIX SWEEP: an affiliation-mismatch alert
 * asserts "this Contact's parent does not match the reviewer's affiliation". At
 * the time of writing 34 such alerts were open but only 9 Contacts had actually
 * been linked, so resolving every row matching the key prefix would erase the
 * only signal that the other 26 reviewers still need attention. Each id below was
 * enumerated and cross-referenced against the production apply-result before
 * being listed here.
 *
 * Owner-authorized 2026-08-10. Dry-run by default; pass --execute to write.
 *
 *   node scripts/resolve-fixed-reviewer-affiliation-alerts.mjs
 *   node scripts/resolve-fixed-reviewer-affiliation-alerts.mjs --execute
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
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

const EXECUTE = process.argv.includes('--execute');
const KEY_PREFIX = 'reviewer-affiliation-mismatch:';
const APPLY_RESULT =
  'outputs/019feb82-883c-7d21-ba5d-aff1f3bbed44/reviewer-contact-account-newly-promoted-accepted-links.apply-result.json';

// Alerts whose Contact was linked to its exact parent Account and independently
// re-verified (the post-write verification re-ran as 9 noop / 0 conflicts).
const FIXED_ALERT_IDS = [402, 408, 410, 417, 421, 423, 434, 436];
// Confirmed test data: reviewer "Kevin Turing" at "Testing University", same
// class as the Martha Cat record excluded from the production link pass.
const TEST_DATA_ALERT_IDS = [322];
const TEST_DATA_CONTACT_IDS = new Set(['2a99c4ed-0382-f111-ab0e-7ced8d3c39fd']);

const TARGET_IDS = [...FIXED_ALERT_IDS, ...TEST_DATA_ALERT_IDS];

const { sql } = await import('@vercel/postgres');
const { default: AlertService } = await import('../lib/services/alert-service.js');

const linked = new Set(
  JSON.parse(readFileSync(APPLY_RESULT, 'utf8'))
    .results.filter((r) => r.status === 'written_and_verified')
    .map((r) => String(r.contactId).toLowerCase()),
);

const { rows } = await sql.query(
  `SELECT id, status, auto_resolve_key, metadata, created_at
     FROM system_alerts WHERE id = ANY($1::int[]) ORDER BY id`,
  [TARGET_IDS],
);

const plan = [];
for (const id of TARGET_IDS) {
  const row = rows.find((r) => r.id === id);
  if (!row) { plan.push({ id, action: 'skip', reason: 'not_found' }); continue; }
  if (!String(row.auto_resolve_key || '').startsWith(KEY_PREFIX)) {
    plan.push({ id, action: 'skip', reason: 'unexpected_key', key: row.auto_resolve_key });
    continue;
  }
  if (!['active', 'acknowledged'].includes(row.status)) {
    plan.push({ id, action: 'skip', reason: `already_${row.status}` });
    continue;
  }
  const contactId = String((row.metadata || {}).contactId || '').toLowerCase();
  const isFixed = linked.has(contactId);
  const isTestData = TEST_DATA_CONTACT_IDS.has(contactId);
  if (!isFixed && !isTestData) {
    // The guard that matters: refuse anything whose justification cannot be
    // re-derived right now, even though a human listed the id.
    plan.push({ id, action: 'skip', reason: 'justification_not_reproducible', contactId });
    continue;
  }
  plan.push({
    id,
    action: 'resolve',
    basis: isFixed ? 'contact_linked_and_verified' : 'test_data',
    contactId,
    affiliation: (row.metadata || {}).reviewerAffiliation || null,
    status: row.status,
  });
}

console.log(`mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
for (const p of plan) {
  console.log(`  id=${p.id} ${p.action}${p.reason ? ` (${p.reason})` : ''}${p.basis ? ` [${p.basis}]` : ''} ${p.affiliation || ''}`);
}
const toResolve = plan.filter((p) => p.action === 'resolve');
console.log(`\nplanned resolves: ${toResolve.length} / ${TARGET_IDS.length}`);

if (!EXECUTE) {
  console.log('\nDRY RUN — no writes. Re-run with --execute to apply.');
  process.exit(0);
}

const results = [];
for (const p of toResolve) {
  try {
    const updated = await AlertService.resolveAlert(p.id, null);
    results.push({ id: p.id, ok: Boolean(updated), status: updated?.status || null, basis: p.basis });
    console.log(`  resolved id=${p.id} -> ${updated?.status || 'NO ROW (status changed under us)'}`);
  } catch (error) {
    results.push({ id: p.id, ok: false, error: error.message, basis: p.basis });
    console.error(`  FAILED id=${p.id}: ${error.message}`);
  }
}

const after = await sql.query(
  `SELECT status, COUNT(*)::int AS c FROM system_alerts
    WHERE auto_resolve_key LIKE $1 GROUP BY status ORDER BY status`,
  [`${KEY_PREFIX}%`],
);
console.log('\n=== affiliation-mismatch alerts by status (after) ===');
for (const r of after.rows) console.log(`  ${r.status.padEnd(14)} ${r.c}`);

const auditDir = 'outputs/s412-affiliation-alert-resolve';
mkdirSync(auditDir, { recursive: true });
const auditPath = `${auditDir}/resolve-result.json`;
writeFileSync(auditPath, JSON.stringify({
  mode: 'execute',
  targetIds: TARGET_IDS,
  plan,
  results,
  summary: {
    planned: toResolve.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  },
  statusAfter: after.rows,
}, null, 2));
console.log(`\naudit written: ${auditPath}`);
