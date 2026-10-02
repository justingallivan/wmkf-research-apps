#!/usr/bin/env node
/**
 * Read-only, sandbox-only census of automation that may observe a synthetic
 * Meeting Tracker fixture. Never reads business records, run history, or writes.
 */
'use strict';

const crypto = require('node:crypto');
const { all, flowFacts } = require('./probe-test-request-platform.js');
const SANDBOX_HOST = 'orgd9e66399.crm.dynamics.com';
const RESOURCE = `https://${SANDBOX_HOST}`;
const ENTITY_NAMES = {
  akoya_request: ['akoya_request', 'akoya_requests'],
  contact: ['contact', 'contacts'],
  wmkf_sitevisit: ['wmkf_sitevisit', 'wmkf_sitevisits'],
  wmkf_apprequestperson: ['wmkf_apprequestperson', 'wmkf_apprequestpersons'],
  activitypointer: ['activitypointer', 'activitypointers'],
  activityparty: ['activityparty', 'activityparties'],
  sharepointdocumentlocation: ['sharepointdocumentlocation', 'sharepointdocumentlocations'],
};
const KNOWN_ENTITY_FORMS = new Map(Object.entries(ENTITY_NAMES)
  .flatMap(([logical, names]) => names.map(name => [name, logical])));
const ENTITIES = new Set(Object.keys(ENTITY_NAMES));

function normalizedEntity(value) {
  return KNOWN_ENTITY_FORMS.get(String(value || '').toLowerCase()) || null;
}

function matchesWorkflow(w, facts) {
  return ENTITIES.has(normalizedEntity(w.primaryentity)) ||
    facts.triggers.some(t => ENTITIES.has(normalizedEntity(t.entity)));
}

function isUnfilteredStep(s) {
  const primaryType = String(s.sdkmessagefilterid?.primaryobjecttypecode || '').trim().toLowerCase();
  return !primaryType || primaryType === 'none';
}

function isUnresolvedActiveCloudFlow(w, facts) {
  return w.category === 5 && w.statecode === 1 && (
    !facts.definitionPresent || facts.triggers.length === 0 ||
    !facts.triggers.some(t => normalizedEntity(t.entity))
  );
}

function summarizeWorkflow(w, facts) {
  return {
    name: w.name || null,
    primaryEntity: w.primaryentity || null,
    category: w.category,
    state: w.statecode,
    definitionAvailable: facts.definitionPresent,
    definitionSha256: facts.definitionSha256,
    triggers: facts.triggers.map(({ type, entity, message, hasConditions, hasFilterExpression }) => ({
      type: type || null, entity, message, hasConditions, hasFilterExpression,
    })),
    actionOperationIds: [...new Set(facts.actions.map(a => a.operationId).filter(Boolean))].sort(),
  };
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const pluralFixture = { primaryentity: 'none' };
    const pluralFacts = { triggers: [{ entity: 'wmkf_sitevisits' }] };
    const unrelated = { primaryentity: 'none' };
    const unrelatedFacts = { triggers: [{ entity: 'unrelatedwidgets' }] };
    const unresolvedCloud = { category: 5, statecode: 1 };
    const unresolvedCloudFacts = { definitionPresent: false, triggers: [] };
    const globalStep = { sdkmessagefilterid: null };
    const filteredStep = { sdkmessagefilterid: { primaryobjecttypecode: 'wmkf_sitevisit' } };
    if (!matchesWorkflow(pluralFixture, pluralFacts) || matchesWorkflow(unrelated, unrelatedFacts)) {
      throw new Error('entity matching self-test failed');
    }
    if (!isUnresolvedActiveCloudFlow(unresolvedCloud, unresolvedCloudFacts) ||
        !isUnfilteredStep(globalStep) || isUnfilteredStep(filteredStep)) {
      throw new Error('unresolved automation self-test failed');
    }
    process.stdout.write('entity matching self-test passed\n');
    return;
  }
  const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
  loadEnvLocal();
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('interlock must be explicitly on');
  const client = createClient({ resourceUrl: RESOURCE, token: await getAccessToken(RESOURCE) });
  const workflowPath = "/api/data/v9.2/workflows?$select=name,category,statecode,type,primaryentity,triggeroncreate,triggerondelete,triggeronupdateattributelist,clientdata&$filter=type eq 1";
  const stepPath = "/api/data/v9.2/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,rank,filteringattributes&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)";
  const [workflows, steps] = await Promise.all([
    all(client, RESOURCE, workflowPath), all(client, RESOURCE, stepPath),
  ]);
  if (!workflows.complete || !steps.complete) throw new Error('incomplete metadata census');
  const selectedWorkflows = workflows.rows.filter(w => {
    const f = flowFacts(w);
    return matchesWorkflow(w, f);
  }).map(w => summarizeWorkflow(w, flowFacts(w)));
  const workflowSummary = {};
  for (const w of selectedWorkflows) {
    const key = `${w.primaryEntity || 'trigger-only'}:category${w.category}:state${w.state}`;
    workflowSummary[key] = (workflowSummary[key] || 0) + 1;
  }
  const activeBusinessWorkflows = selectedWorkflows.filter(w => w.state === 1 && w.category === 0)
    .map(({ name, primaryEntity, definitionAvailable }) => ({ name, primaryEntity, definitionAvailable }));
  const activeCloudFlows = selectedWorkflows.filter(w => w.state === 1 && w.category === 5)
    .map(({ name, primaryEntity, definitionAvailable, triggers, actionOperationIds }) => ({
      name, primaryEntity, definitionAvailable, triggers, actionOperationIds,
    }));
  const unresolvedWorkflows = selectedWorkflows.filter(w => w.state === 1 && (
    !w.definitionAvailable || (w.category === 5 && w.triggers.length === 0)
  )).map(({ name, primaryEntity, category, definitionAvailable, triggers }) => ({
    name, primaryEntity, category, definitionAvailable, triggerCount: triggers.length,
  }));
  const activeCloudCandidates = workflows.rows.filter(w => w.category === 5 && w.statecode === 1)
    .map(w => ({ row: w, facts: flowFacts(w) }));
  const unresolvedCloudCandidates = activeCloudCandidates.filter(({ row, facts }) =>
    isUnresolvedActiveCloudFlow(row, facts)
  ).map(({ row, facts }) => ({
    name: row.name || null,
    primaryEntity: row.primaryentity || null,
    definitionAvailable: facts.definitionPresent,
    triggerCount: facts.triggers.length,
  }));
  const relevantSteps = steps.rows.filter(s => ENTITIES.has(normalizedEntity(s.sdkmessagefilterid?.primaryobjecttypecode)));
  const unfilteredGlobalSteps = steps.rows.filter(isUnfilteredStep);
  const stepSummary = {};
  for (const s of relevantSteps) {
    if (!['Create', 'Update', 'Delete'].includes(s.sdkmessageid?.name)) continue;
    const key = `${s.sdkmessagefilterid.primaryobjecttypecode}:${s.sdkmessageid?.name || 'unknown'}:state${s.statecode}:stage${s.stage}`;
    stepSummary[key] = (stepSummary[key] || 0) + 1;
  }
  const report = {
    mode: 'READ_ONLY_SYSTEM_METADATA',
    target: SANDBOX_HOST,
    interlock: 'on',
    scope: 'workflow definitions and registered plugin steps only; no business rows, run history, or writes',
    entitiesChecked: [...ENTITIES],
    workflowRead: { status: workflows.status, complete: workflows.complete, totalVisible: workflows.rows.length },
    pluginStepRead: { status: steps.status, complete: steps.complete, totalVisible: steps.rows.length },
    workflowCountsByEntityCategoryState: workflowSummary,
    activeClassicWorkflows: activeBusinessWorkflows,
    activeCloudFlows,
    unresolvedActiveWorkflowCount: unresolvedWorkflows.length,
    unresolvedActiveWorkflows: unresolvedWorkflows,
    activeCloudCandidateCount: activeCloudCandidates.length,
    unresolvedActiveCloudCandidateCount: unresolvedCloudCandidates.length,
    unresolvedActiveCloudCandidateSample: unresolvedCloudCandidates.slice(0, 20),
    pluginStepRelevantCount: relevantSteps.length,
    pluginStepCountsByEntityMessageStateStage: stepSummary,
    unfilteredGlobalPluginStepCount: unfilteredGlobalSteps.length,
    unfilteredGlobalPluginStepCountsByMessageStateStage: Object.fromEntries(
      Object.entries(unfilteredGlobalSteps.reduce((counts, s) => {
        const key = `${s.sdkmessageid?.name || 'unknown'}:state${s.statecode}:stage${s.stage}`;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {})).sort(([a], [b]) => a.localeCompare(b)),
    ),
    note: 'Workflow matching uses exact known logical names and entity-set names in primary entity or parsed trigger entity. Active processes with unavailable/incomplete definitions and global unfiltered plugin steps are classified unresolved. Raw definitions are never printed; per-definition hashes cover raw clientdata. Plugin detail is aggregated. This census gives no safety-ready verdict; absence is not proof automation is absent.',
  };
  report.reportDigestSha256 = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(() => {
  process.stderr.write('Sandbox safety census failed; credentials and response details omitted.\n');
  process.exitCode = 1;
});
