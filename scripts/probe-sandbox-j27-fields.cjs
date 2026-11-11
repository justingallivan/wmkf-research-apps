#!/usr/bin/env node
/**
 * Read-only: does the SANDBOX akoya_request table have the fields the J27
 * Workbench reads and the Preview settings switch on?
 *
 * One metadata GET (EntityDefinitions attributes); no records are read. Pinned
 * to the registered sandbox host and refuses any other.
 *
 *   node scripts/probe-sandbox-j27-fields.cjs
 *
 * Run 2026-11-10/11 (Session 673): all eight present. Recorded in
 * docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md.
 */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
loadEnvLocal();
const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const host = new URL(SANDBOX).hostname;
if (host !== 'orgd9e66399.crm.dynamics.com') { console.error('refusing: not the sandbox host'); process.exit(2); }
console.log('target host:', host);
const FIELDS = ['wmkf_initialassessmentrationale', 'wmkf_confirmedmeetingroster', 'wmkf_staffreviewsummary', 'wmkf_staffvisitassessment', 'wmkf_phaseiistatus', 'wmkf_readyforreview', 'wmkf_currentpresitevisit', 'wmkf_currentfinalwriteup'];
(async () => {
  const c = createClient({ resourceUrl: SANDBOX, token: await getAccessToken(SANDBOX) });
  const r = await c.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,AttributeType");
  if (!r.ok) { console.error('metadata read failed', r.status); process.exit(1); }
  const have = new Map(r.body.value.map((a) => [a.LogicalName, a.AttributeType]));
  for (const f of FIELDS) console.log(f.padEnd(34), have.has(f) ? `present (${have.get(f)})` : 'MISSING');
})().catch((e) => { console.error('failed:', e.message.slice(0, 200)); process.exit(1); });
