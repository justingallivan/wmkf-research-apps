#!/usr/bin/env node
/** Read-only D26/J27 visibility comparison. Only Dataverse GETs.
 * Production (owner authorization 2026-11-02): verify unchanged D26 and hidden unready J27.
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-j27-readiness-visibility.cjs <verified-program-guid>
 * Sandbox (plan F1, 2026-11-09): superset check for the discovery filter.
 *   DYNAMICS_SANDBOX_URL=https://<sandbox-host> node scripts/probe-j27-readiness-visibility.cjs --target=sandbox [<program-guid>]
 * Without a program GUID the sandbox branch resolves the readiness-only scope by name from the
 * live catalog, exactly as the app does. Cohort A: every D26/J27-linked row for the program, no
 * discovery filter. Cohort B: the same with `buildDiscoveryFilter` applied. Asserts
 * exact(A) ⊆ B and exact(B) == exact(A). Emits counts, request numbers and ID-set digests only.
 */
const crypto = require('node:crypto');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const SELECT = 'akoya_requestid,akoya_requestnum,akoya_requeststatus,wmkf_triagestatus,wmkf_readyforreview,wmkf_istestrequest,_wmkf_grantprogram_value';
const EXPAND = 'wmkf_GrantCycle($select=wmkf_cyclecode)';
const set = (rows) => rows.map(r => r.akoya_requestid.toLowerCase()).sort();
const digest = (rows) => crypto.createHash('sha256').update(JSON.stringify(set(rows))).digest('hex');
const numbers = (rows) => rows.map(r => r.akoya_requestnum).sort();
async function readAll(client, filter) {
  const qs = new URLSearchParams({ $select: SELECT, $filter: filter, $expand: EXPAND });
  const result = await client.get(`/akoya_requests?${qs}`);
  if (!result.ok) throw new Error(`Read failed HTTP ${result.status}`);
  if (!Array.isArray(result.body?.value) || result.body['@odata.nextLink']) throw new Error('Incomplete read; no conclusions.');
  return result.body.value;
}
async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const sandbox = args.includes('--target=sandbox');
  const program = args.find(a => /^[0-9a-f-]{36}$/i.test(a)) || null;
  const { PRODUCTION_HOSTS, SANDBOX_HOSTS } = await import('../lib/dataverse/core/target-registry.js');
  const { isVisibleRequestRow, buildDiscoveryFilter, isDiscoverableRequestRow, assertDiscoveryQuery } = await import('../shared/config/workbenchVisibility.js');
  const { isRequestReadyForStaff } = await import('../shared/config/requestReadiness.js');
  const { readinessOnlyProgramIds } = await import('../lib/services/workbench/program-scope-service.js');
  const cycles = `(wmkf_GrantCycle/wmkf_cyclecode eq 'D26' or wmkf_GrantCycle/wmkf_cyclecode eq 'J27')`;
  const summary = { observedAt: new Date().toISOString(), dataverseMethods: ['GET'], cycles: {} };
  let client;
  if (sandbox) {
    const resourceUrl = process.env.DYNAMICS_SANDBOX_URL;
    if (!resourceUrl || !SANDBOX_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase())) throw new Error('Registered sandbox URL required (DYNAMICS_SANDBOX_URL).');
    client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
    summary.target = 'sandbox';
  } else {
    if (!program) throw new Error('Verified Grant Program GUID required.');
    const resourceUrl = process.env.DYNAMICS_URL;
    if (!PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase()) || process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Explicit registered Production read required.');
    client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
    summary.target = 'production';
  }
  // Scope: the given program, or the one catalog row named Research (as the app resolves it).
  let scopeIds = program ? [program.toLowerCase()] : [];
  if (!program) {
    const catalog = await client.get('/wmkf_grantprograms?$select=wmkf_grantprogramid,wmkf_name,statecode&$filter=statecode eq 0');
    if (!catalog.ok) throw new Error(`Catalog read failed HTTP ${catalog.status}`);
    scopeIds = readinessOnlyProgramIds(catalog.body.value);
    if (!scopeIds.length) throw new Error('No single active program named Research in the catalog.');
  }
  const scope = { readinessOnlyProgramIds: scopeIds };
  const programFilter = `(${scopeIds.map(id => `_wmkf_grantprogram_value eq ${id}`).join(' or ')})`;
  summary.scope = scopeIds;
  const cohortA = await readAll(client, `${programFilter} and ${cycles}`);
  for (const code of ['D26', 'J27']) {
    const rows = cohortA.filter(r => r.wmkf_GrantCycle?.wmkf_cyclecode === code);
    const modes = {};
    for (const includeSetAside of [false, true]) {
      const legacy = rows.filter(r => isVisibleRequestRow(r, includeSetAside)).filter(isRequestReadyForStaff);
      const exact = rows.filter(r => isDiscoverableRequestRow(r, includeSetAside, scope));
      modes[includeSetAside ? 'includeSetAside' : 'default'] = {
        legacyEligible: legacy.length, discoveryEligible: exact.length,
        legacyIdDigest: digest(legacy), discoveryIdDigest: digest(exact),
        addedByDiscovery: numbers(exact.filter(r => !set(legacy).includes(r.akoya_requestid.toLowerCase()))),
        removedByDiscovery: numbers(legacy.filter(r => !set(exact).includes(r.akoya_requestid.toLowerCase()))),
        discoveryRequestNumbers: numbers(exact),
      };
    }
    summary.cycles[code] = { total: rows.length, ready: rows.filter(r => r.wmkf_readyforreview === true).length, test: rows.filter(r => r.wmkf_istestrequest === true).length, modes };
  }
  // Superset check: cohort B through the real OData filter, both views.
  summary.superset = {};
  for (const includeSetAside of [false, true]) {
    const filter = `${programFilter} and ${cycles} and ${buildDiscoveryFilter(includeSetAside, scope)}`;
    assertDiscoveryQuery({ select: SELECT, expand: EXPAND });
    const cohortB = await readAll(client, filter);
    const exactA = cohortA.filter(r => isDiscoverableRequestRow(r, includeSetAside, scope));
    const exactB = cohortB.filter(r => isDiscoverableRequestRow(r, includeSetAside, scope));
    const idsB = new Set(set(cohortB));
    summary.superset[includeSetAside ? 'includeSetAside' : 'default'] = {
      cohortA: cohortA.length, cohortB: cohortB.length, exactA: exactA.length, exactB: exactB.length,
      exactASubsetOfB: set(exactA).every(id => idsB.has(id)),
      exactBEqualsExactA: JSON.stringify(set(exactA)) === JSON.stringify(set(exactB)),
      supersetOverhead: cohortB.length - exactB.length,
    };
    if (!summary.superset[includeSetAside ? 'includeSetAside' : 'default'].exactASubsetOfB) summary.failed = true;
    if (!summary.superset[includeSetAside ? 'includeSetAside' : 'default'].exactBEqualsExactA) summary.failed = true;
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
