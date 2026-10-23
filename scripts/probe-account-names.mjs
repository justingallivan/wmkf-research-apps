/**
 * probe-account-names.mjs — READ-ONLY account name lookup, used to map the
 * institution names staff typed in the Stage B co-PI review workbook to
 * accounts (docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2).
 *
 * For each --term, lists every account whose name contains the term, with its
 * state and the number of active contacts whose parent account it is, so
 * near-duplicate accounts can be told apart. Prints account names only; no
 * contact data.
 *
 *   node scripts/probe-account-names.mjs --term=Anschutz --term="CU Denver" [...]
 *
 * Acts against whatever .env.local points at.
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const terms = process.argv.filter((a) => a.startsWith('--term=')).map((a) => a.slice('--term='.length).trim()).filter(Boolean);
if (!terms.length) { console.error('Give at least one --term=<text>'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { escape } = await import('../lib/dataverse/core/odata.js');

await bypassDynamicsRestrictions('probe-account-names', async () => {
  console.log(`host: ${new URL(process.env.DYNAMICS_URL).host}`);
  for (const term of terms) {
    const result = await DynamicsService.queryAllRecords('accounts', {
      select: 'accountid,name,statecode,createdon',
      filter: `contains(name,'${escape(term)}')`,
    });
    if (result.capped) { console.error(`"${term}" matched over 5,000 accounts — use a narrower term.`); process.exit(1); }
    console.log(`\n== "${term}": ${result.records.length} account(s)`);
    const rows = [];
    for (const a of result.records) {
      const contacts = await DynamicsService.countRecords('contacts', `_parentcustomerid_value eq ${a.accountid} and statecode eq 0`);
      rows.push({ name: a.name, state: a.statecode === 0 ? 'active' : 'inactive', contacts, created: String(a.createdon || '').slice(0, 10), id: a.accountid });
    }
    rows.sort((x, y) => x.name.localeCompare(y.name));
    for (const r of rows) console.log(`  ${r.name} | ${r.state} | ${r.contacts} active contacts | created ${r.created} | ${r.id}`);
  }
});
