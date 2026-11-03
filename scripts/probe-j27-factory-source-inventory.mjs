#!/usr/bin/env node
/** Owner-authorized read-only D26/J27 Factory source inventory (2026-11-02).
 * GET-only Dataverse and SharePoint metadata discovery; no content downloads.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-j27-factory-source-inventory.mjs
 * Emits request numbers, lifecycle/test/readiness flags and recognized file kinds/sizes.
 */
import { createRequire } from 'node:module';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { createStrictTestRequestSourceDependencies, discoverTestRequestSourceDocuments } from '../lib/services/test-requests/admin-preview-service.js';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--metadata-only')) throw new Error('Only --metadata-only is supported.');
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase()) || process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Production read acknowledgment required.');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const metadata = await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_readyforreview')?$select=LogicalName,AttributeType,IsValidForCreate,IsValidForUpdate");
  if (!metadata.ok) throw new Error('Readiness metadata unavailable.');
  const field = { logicalName: metadata.body.LogicalName, type: metadata.body.AttributeType, createable: metadata.body.IsValidForCreate, updateable: metadata.body.IsValidForUpdate };
  if (args[0] === '--metadata-only') { console.log(JSON.stringify({ checkedAt: new Date().toISOString(), readOnly: true, field }, null, 2)); return; }
  const programs = await client.get("/wmkf_grantprograms?$select=wmkf_grantprogramid&$filter=wmkf_name%20eq%20'Research'%20and%20statecode%20eq%200&$top=2");
  if (!programs.ok || programs.body?.value?.length !== 1) throw new Error('Exact Research program required.');
  const programId = programs.body.value[0].wmkf_grantprogramid;
  if (!/^[0-9a-f-]{36}$/i.test(programId || '')) throw new Error('Invalid Research program identity.');
  const params = new URLSearchParams({
    $select: 'akoya_requestid,akoya_requestnum,akoya_requeststatus,wmkf_phaseistatus,wmkf_phaseiistatus,wmkf_readyforreview,wmkf_istestrequest',
    $expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
    $filter: `_wmkf_grantprogram_value eq ${programId} and (wmkf_GrantCycle/wmkf_cyclecode eq 'D26' or wmkf_GrantCycle/wmkf_cyclecode eq 'J27')`, $top: '5000',
  });
  const result = await client.get(`/akoya_requests?${params}`);
  if (!result.ok || !Array.isArray(result.body?.value) || result.body['@odata.nextLink']) throw new Error('Incomplete request inventory.');
  const rows = result.body.value;
  const abstractParams = new URLSearchParams({ $select: 'akoya_requestnum', $filter: `(${params.get('$filter')}) and wmkf_abstract ne null`, $top: '5000' });
  const abstracts = await client.get(`/akoya_requests?${abstractParams}`);
  if (!abstracts.ok || !Array.isArray(abstracts.body?.value) || abstracts.body['@odata.nextLink']) throw new Error('Incomplete abstract-presence inventory.');
  const withAbstract = new Set(abstracts.body.value.map(r => r.akoya_requestnum));
  // Bound metadata traffic: all J27 examples plus up to six advanced D26 sources.
  const selected = [...rows.filter(r => r.wmkf_GrantCycle?.wmkf_cyclecode === 'J27').sort((a,b) => Number(['1003391','1003384'].includes(b.akoya_requestnum)) - Number(['1003391','1003384'].includes(a.akoya_requestnum))).slice(0, 12), ...rows.filter(r => r.wmkf_GrantCycle?.wmkf_cyclecode === 'D26' && r.wmkf_phaseistatus === 100000003).slice(0, 6)];
  if (selected.length > 30) throw new Error('Inventory exceeds approved bounded probe; narrow selection first.');
  const dependencies = createStrictTestRequestSourceDependencies();
  const report = { checkedAt: new Date().toISOString(), readOnly: true, field, scope: 'Research D26/J27; up to 12 J27 and six invited D26 sources', totalByCycle: {}, sources: [] };
  for (const code of ['D26', 'J27']) report.totalByCycle[code] = rows.filter(r => r.wmkf_GrantCycle?.wmkf_cyclecode === code).length;
  await withDalContext('probe-j27-factory-source-inventory', async () => {
    for (const row of selected) {
      const { documents, errors } = await discoverTestRequestSourceDocuments(row, dependencies);
      report.sources.push({ requestNumber: row.akoya_requestnum, cycle: row.wmkf_GrantCycle?.wmkf_cyclecode, requestStatus: row.akoya_requeststatus, phaseI: row.wmkf_phaseistatus, phaseII: row.wmkf_phaseiistatus, ready: row.wmkf_readyforreview, isTest: row.wmkf_istestrequest, hasApplicantAbstract: withAbstract.has(row.akoya_requestnum), documents: documents.map(d => ({ kind: d.kind, bytes: d.size })), discoveryErrors: errors.map(e => typeof e === 'string' ? e : e.code || 'discovery_error') });
    }
  });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ failed: true, code: error.code || null, status: error.status || null, message: String(error.message || '').replace(/https?:\/\/\S+/g, '[URL]').slice(0, 160) })); process.exitCode = 1; });
