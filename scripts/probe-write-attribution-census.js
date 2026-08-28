#!/usr/bin/env node
/**
 * READ-ONLY census of write attribution on app-written Dataverse tables:
 * who does Dataverse say created/modified recent rows — staff users or the
 * app's service principal?
 *
 * BACKGROUND (S466). The guarded-reopen audit card shows the app service
 * principal ("# WMK: Research Review App Suite") as the actor. The
 * MSCRMCallerID impersonation contract (S127–S129) is gated behind
 * DYNAMICS_IMPERSONATION_ENABLED, which is `true` in Production (verified
 * S271, re-verified S466). This probe tallies what production attribution
 * actually looks like across app-written tables. First run (S466): wmkf_ai_run
 * mixed staff/service; wmkf_requestdocument all service-principal — the
 * privilege-intersection fallback signature on a post-audit table. See
 * docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md §Status. Re-run after the
 * staff role gains wmkf_requestdocument privileges to confirm the fix.
 *
 * Tables scanned (both are written exclusively through the app):
 *   - wmkf_requestdocuments  (Workbench pre-site/site-visit documents)
 *   - wmkf_ai_runs           (every governed AI generation)
 *
 * Output: per table, a tally of distinct createdby (and modifiedby)
 * identities with row counts and first/last createdon — aggregates only.
 *
 * SAFETY: NO write path — every Dataverse call is a read. Production reads
 * are owner-run and require the interlock override:
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-write-attribution-census.js [--days=90]
 */

require('./../lib/dataverse/client').loadEnvLocal();

const DAYS = (() => {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  const n = arg ? Number(arg.split('=')[1]) : 90;
  if (!Number.isInteger(n) || n < 1 || n > 730) {
    throw new Error(`--days must be an integer 1..730, got: ${arg}`);
  }
  return n;
})();

const TABLES = [
  { entitySet: 'wmkf_requestdocuments', label: 'wmkf_requestdocument (Workbench documents)' },
  { entitySet: 'wmkf_ai_runs', label: 'wmkf_ai_run (AI generations)' },
];

function assertComplete(label, result) {
  if (result.capped) {
    throw new Error(`${label}: query hit the export cap — census would be incomplete. Refusing.`);
  }
  if (result.totalCount && result.records.length < result.totalCount) {
    throw new Error(`${label}: fetched ${result.records.length} of ${result.totalCount} — census would be incomplete. Refusing.`);
  }
}

function tally(records, idField, nameField) {
  const byId = new Map();
  for (const r of records) {
    const id = (r[idField] || '').toLowerCase() || '(none)';
    const entry = byId.get(id) || {
      name: r[nameField] || '(unnamed)',
      count: 0,
      first: null,
      last: null,
    };
    entry.count += 1;
    const created = r.createdon || null;
    if (created) {
      if (!entry.first || created < entry.first) entry.first = created;
      if (!entry.last || created > entry.last) entry.last = created;
    }
    byId.set(id, entry);
  }
  return [...byId.entries()].sort((a, b) => b[1].count - a[1].count);
}

function printTally(title, rows) {
  console.log(`  ${title}:`);
  for (const [id, e] of rows) {
    const range = e.first ? ` (${e.first.slice(0, 10)} → ${e.last.slice(0, 10)})` : '';
    console.log(`    ${String(e.count).padStart(5)}  ${e.name}${range}  [${id}]`);
  }
}

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`Write-attribution census — rows created since ${since.slice(0, 10)} (${DAYS} days)\n`);

  await bypassDynamicsRestrictions('probe-write-attribution-census', async () => {
    for (const table of TABLES) {
      const result = await DynamicsService.queryAllRecords(table.entitySet, {
        select: 'createdon,_createdby_value,_modifiedby_value',
        filter: `createdon ge ${since}`,
      });
      assertComplete(table.label, result);

      console.log(`${table.label} — ${result.records.length} row(s)`);
      if (result.records.length === 0) {
        console.log('  (no rows in window)\n');
        continue;
      }
      printTally('createdby', tally(result.records, '_createdby_value', '_createdby_value_formatted'));
      printTally('modifiedby', tally(result.records, '_modifiedby_value', '_modifiedby_value_formatted'));
      console.log('');
    }
  });

  console.log('Interpretation: rows attributed to a person mean impersonation (or a');
  console.log('direct-CRM edit) applied to that write; rows attributed to the app');
  console.log('registration mean service-principal attribution.');
})().catch((error) => {
  console.error('Probe failed:', error.message);
  process.exit(1);
});
