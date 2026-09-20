#!/usr/bin/env node
/**
 * Read-only Test Request Factory platform census.
 * Authenticates using the existing application Dataverse client (not agent auth),
 * then GETs visible process definitions and request/location plugin metadata on
 * the two registered targets. Does not execute flows or change remote state.
 * Saves selected metadata only; never stores raw clientdata, URLs, connection
 * parameters, headers, or action input values. Names/IDs identify owner follow-up.
 * Matching is heuristic; absence is not proof that tenant automation is absent.
 * Usage: node --env-file=/approved/path/.env.local scripts/probe-test-request-platform.js /new/receipt.json
 * Output is create-only. Check scope and target registry before every execution.
 */
const fs = require('fs'),
  crypto = require('crypto');

// Run with node --env-file=/approved/path/.env.local when the worktree has no local environment.
// Never print environment values or raw flow definitions.

const terms = ['akoya_request', 'sharepointdocumentlocation', 'proposalnarrative', 'reviewer materials', 'wmkf_istestrequest', 'wmkf_testcreationrunid'];
async function all(client, resourceUrl, path) {
  const collectionPath = new URL(path, resourceUrl + '/api/data/v9.2/').pathname;
  if (!['/api/data/v9.2/workflows', '/api/data/v9.2/sdkmessageprocessingsteps'].includes(collectionPath)) throw Error('unsupported metadata collection');
  let rows = [],
    pages = 0;
  while (path) {
    if (++pages > 30) throw Error('pagination bound');
    const u = new URL(path, resourceUrl + '/api/data/v9.2/');
    if (u.origin !== resourceUrl || u.pathname !== collectionPath) throw Error('untrusted continuation');
    const r = await client.get(u.href);
    if (!r.ok) return {
      status: r.status,
      complete: false,
      rows: []
    };
    if (!Array.isArray(r.body?.value)) throw Error('malformed metadata collection');
    rows.push(...r.body.value);
    path = r.body['@odata.nextLink'];
  }
  return {
    status: 200,
    complete: true,
    rows
  };
}
function flowFacts(w) {
  let p;
  try {
    p = JSON.parse(w.clientdata || 'null');
  } catch {}
  const d = p?.properties?.definition;
  const raw = w.clientdata || '';
  const actions = [];
  function visit(o) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'actions' && v && typeof v === 'object') for (const a of Object.values(v)) actions.push({
        type: a.type || null,
        operationId: a.inputs?.host?.operationId || null
      });
      visit(v);
    }
  }
  visit(d);
  return {
    id: w.workflowid,
    name: w.name,
    category: w.category,
    state: w.statecode,
    primaryentity: w.primaryentity,
    triggeroncreate: w.triggeroncreate,
    triggerondelete: w.triggerondelete,
    triggeronupdateattributelist: w.triggeronupdateattributelist,
    definitionPresent: !!d,
    definitionSha256: raw ? crypto.createHash('sha256').update(raw).digest('hex') : null,
    matchedTerms: terms.filter(t => raw.toLowerCase().includes(t)),
    triggers: Object.values(d?.triggers || {}).map(t => ({
      type: t.type,
      operationId: t.inputs?.host?.operationId || null,
      entity: t.inputs?.parameters?.entityName || t.inputs?.parameters?.subscriptionRequest?.entityname || t.inputs?.parameters?.['subscriptionRequest/entityname'] || null,
      message: t.inputs?.parameters?.subscriptionRequest?.message || t.inputs?.parameters?.['subscriptionRequest/message'] || null,
      hasConditions: !!t.conditions,
      hasFilterExpression: !!(t.inputs?.parameters?.subscriptionRequest?.filterexpression || t.inputs?.parameters?.['subscriptionRequest/filterexpression'])
    })),
    actions
  };
}
async function main() {
  const {
    loadEnvLocal,
    getAccessToken,
    createClient
  } = require('../lib/dataverse/client.js');
  const output = process.argv[2];
  if (!output || fs.existsSync(output)) throw Error('new output path required');
  loadEnvLocal();
  const report = {
    checkedAt: new Date().toISOString(),
    mode: 'READ_ONLY_SYSTEM_METADATA',
    scope: 'visible process definitions and registered request/location plugin steps; no run history or business records',
    targets: []
  };
  for (const hostname of ['wmkf.crm.dynamics.com', 'orgd9e66399.crm.dynamics.com']) {
    const resourceUrl = 'https://' + hostname;
    const client = createClient({
      resourceUrl,
      token: await getAccessToken(resourceUrl)
    });
    const workflows = await all(client, resourceUrl, "/api/data/v9.2/workflows?$select=workflowid,name,category,statecode,type,primaryentity,triggeroncreate,triggerondelete,triggeronupdateattributelist,clientdata&$filter=type eq 1");
    const relevant = workflows.rows.filter(w => ['akoya_request', 'sharepointdocumentlocation'].includes(w.primaryentity) || terms.some(t => (w.clientdata || '').toLowerCase().includes(t))).map(flowFacts);
    const steps = await all(client, resourceUrl, "/api/data/v9.2/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,statecode,rank,filteringattributes&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)&$filter=sdkmessagefilterid/primaryobjecttypecode eq 'akoya_request' or sdkmessagefilterid/primaryobjecttypecode eq 'sharepointdocumentlocation'");
    const entity = await client.get("/EntityDefinitions(LogicalName='akoya_request')?$select=EntitySetName,IsDocumentManagementEnabled");
    const number = await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_requestnum')/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,AutoNumberFormat,MaxLength");
    report.targets.push({
      entityContract: {
        status: entity.status,
        entitySet: entity.body?.EntitySetName,
        documentManagementEnabled: entity.body?.IsDocumentManagementEnabled
      },
      numberingMetadata: {
        status: number.status,
        autoNumberFormat: number.body?.AutoNumberFormat,
        maxLength: number.body?.MaxLength
      },
      hostname,
      workflowStatus: workflows.status,
      workflowComplete: workflows.complete,
      visibleWorkflowCount: workflows.rows.length,
      cloudCount: workflows.rows.filter(w => w.category === 5).length,
      cloudWithoutDefinitionCount: workflows.rows.filter(w => w.category === 5 && !flowFacts(w).definitionPresent).length,
      relevantWorkflows: relevant,
      stepStatus: steps.status,
      stepsComplete: steps.complete,
      steps: steps.rows.map(s => ({
        id: s.sdkmessageprocessingstepid,
        name: s.name,
        stage: s.stage,
        mode: s.mode,
        state: s.statecode,
        rank: s.rank,
        filteringAttributes: s.filteringattributes,
        message: s.sdkmessageid?.name,
        entity: s.sdkmessagefilterid?.primaryobjecttypecode
      }))
    });
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2), {
    flag: 'wx'
  });
  console.log(JSON.stringify(report.targets.map(t => ({
    hostname: t.hostname,
    status: t.workflowStatus,
    total: t.visibleWorkflowCount,
    relevant: t.relevantWorkflows.length,
    stepStatus: t.stepStatus,
    steps: t.steps.length
  })), null, 2));
}
if (require.main === module) main().catch(() => {
  console.error('Platform census failed; credential/response detail omitted.');
  process.exitCode = 1;
});
module.exports = {
  all,
  flowFacts
};
