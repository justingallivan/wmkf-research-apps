#!/usr/bin/env node

/**
 * Read-only Production inventory for Proposal Ranking storage and eligible
 * source counts. Every Dataverse request is GET-only. Request number is read
 * only to apply the December 2026 trial cutoff; output contains aggregate
 * counts and readiness booleans only.
 *
 * Requires an explicit target and local read grant:
 *   DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_TARGET_INTERLOCK=on \
 *     node scripts/probe-proposal-ranking-production-readiness.mjs --target=production
 */

import { createRequire } from 'node:module';
import { classifyTarget, resolveInterlockMode } from '../lib/dataverse/core/interlock.js';
import { eq } from '../lib/dataverse/core/odata.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { RESEARCH_PROGRAM_IDS } from '../shared/config/researchPrograms.js';
import { PHASE_II_PENDING } from '../shared/config/workbenchVisibility.js';
import { TEST_REQUEST_ORDINARY_OData_FILTER } from '../lib/services/test-requests/isolation.js';
import { meetingDateToCycleCode } from '../lib/utils/cycle-code.js';
import { applyProposalRankingTrialCutoff } from '../lib/services/proposal-ranking/trial-cutoff.js';
import cycleSchema from '../lib/dataverse/schema/wave32-proposal-ranking/wmkf_proposalrankingcycle.json' with { type: 'json' };
import roundSchema from '../lib/dataverse/schema/wave32-proposal-ranking/wmkf_proposalrankinground.json' with { type: 'json' };
import listSchema from '../lib/dataverse/schema/wave32-proposal-ranking/wmkf_proposalrankinglist.json' with { type: 'json' };
import roleSpec from '../lib/dataverse/schema/roles/proposal-ranking-app.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const API_PATH = '/api/data/v9.2/akoya_requests';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const targetArgs = argv.slice(2);
  if (targetArgs.length !== 1 || targetArgs[0] !== '--target=production') {
    throw new Error('Pass exactly --target=production.');
  }
}

async function getJson(client, path) {
  const normalized = path.startsWith('http') ? path : `/${path.replace(/^\/+/, '')}`;
  const response = await client.get(normalized);
  if (!response.ok) {
    const errorCode = response.body?.error?.code;
    return {
      ok: false,
      status: response.status,
      errorCode: typeof errorCode === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(errorCode) ? errorCode : undefined,
      body: null,
    };
  }
  return { ok: true, status: response.status, body: response.body || {} };
}

function expectedKeyMatches(expected, actual) {
  const attributes = [...(actual?.KeyAttributes || [])].map((item) => item.toLowerCase()).sort();
  const expectedAttributes = [...expected.keyAttributes].map((item) => item.toLowerCase()).sort();
  return actual?.SchemaName === expected.schemaName
    && JSON.stringify(attributes) === JSON.stringify(expectedAttributes)
    && actual.EntityKeyIndexStatus === 'Active';
}

async function inspectTable(client, spec) {
  const entity = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')?$select=LogicalName,SchemaName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`);
  if (!entity.ok) {
    return { logicalName: spec.name, available: false, status: entity.status, errorCode: entity.errorCode, expectedKeysActive: null };
  }
  const keys = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus`);
  const actualKeys = keys.body?.value || [];
  const expectedKeysActive = keys.ok && spec.alternateKeys.every((expected) => (
    actualKeys.some((actual) => expectedKeyMatches(expected, actual))
  ));
  return {
    logicalName: spec.name,
    available: true,
    identityMatches: entity.body?.LogicalName === spec.name
      && entity.body?.SchemaName === spec.schemaName
      && entity.body?.EntitySetName === `${spec.name}s`
      && entity.body?.PrimaryIdAttribute === `${spec.name}id`
      && String(entity.body?.PrimaryNameAttribute || '').toLowerCase() === spec.primaryNameAttribute.schemaName.toLowerCase(),
    expectedKeysActive,
    keysStatus: keys.status,
    keysErrorCode: keys.errorCode,
  };
}

async function scanEligibleSource(client, resourceOrigin) {
  const programFilter = RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  const filter = `(${programFilter}) and akoya_requeststatus eq '${PHASE_II_PENDING}' and ${TEST_REQUEST_ORDINARY_OData_FILTER}`;
  const initialPath = `${API_PATH}?$select=akoya_requestnum,wmkf_meetingdate,_akoya_programid_value&$filter=${encodeURIComponent(filter)}&$orderby=wmkf_meetingdate asc`;
  let nextUrl = new URL(initialPath, resourceOrigin).href;
  const records = [];
  let pageCount = 0;
  let lastStatus = null;
  while (nextUrl && pageCount < 100) {
    const parsed = new URL(nextUrl);
    if (parsed.origin !== resourceOrigin || parsed.pathname !== API_PATH) {
      throw new Error('Dataverse returned a continuation outside the fixed Production request query.');
    }
    const result = await getJson(client, parsed.href);
    lastStatus = result.status;
    if (!result.ok) {
      return { complete: false, status: result.status, errorCode: result.errorCode, capped: false, scannedProposalCount: null, eligibleProposalCount: null, excludedByD26RequestNumberCutoffCount: null, byCycle: null, unmappedMeetingDateCount: null };
    }
    if (!Array.isArray(result.body?.value)) {
      return { complete: false, status: result.status, capped: false, scannedProposalCount: null, eligibleProposalCount: null, excludedByD26RequestNumberCutoffCount: null, byCycle: null, unmappedMeetingDateCount: null };
    }
    records.push(...result.body.value);
    const continuation = result.body['@odata.nextLink'];
    nextUrl = continuation ? new URL(continuation, resourceOrigin).href : null;
    pageCount += 1;
  }
  if (nextUrl) {
    return { complete: false, status: lastStatus, capped: true, scannedProposalCount: null, eligibleProposalCount: null, excludedByD26RequestNumberCutoffCount: null, byCycle: null, unmappedMeetingDateCount: null };
  }

  const { requests: trialRecords, excludedRequestCount } = applyProposalRankingTrialCutoff(records);
  const byCycle = {};
  let unmappedMeetingDateCount = 0;
  for (const row of trialRecords) {
    const cycleCode = meetingDateToCycleCode(row.wmkf_meetingdate);
    const programId = String(row._akoya_programid_value || '').toLowerCase();
    const programKey = programId === RESEARCH_PROGRAM_IDS[0] ? 'se' : programId === RESEARCH_PROGRAM_IDS[1] ? 'mr' : null;
    if (!cycleCode || !programKey) {
      unmappedMeetingDateCount += 1;
      continue;
    }
    const cycle = byCycle[cycleCode] || { eligibleProposalCount: 0, se: 0, mr: 0 };
    cycle.eligibleProposalCount += 1;
    cycle[programKey] += 1;
    byCycle[cycleCode] = cycle;
  }
  return {
    complete: true,
    status: lastStatus,
    capped: false,
    scannedProposalCount: records.length,
    eligibleProposalCount: trialRecords.length,
    excludedByD26RequestNumberCutoffCount: excludedRequestCount,
    byCycle: Object.fromEntries(Object.entries(byCycle).sort(([left], [right]) => left.localeCompare(right))),
    unmappedMeetingDateCount,
  };
}

async function main() {
  parseArgs(process.argv);
  loadEnvLocal();
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes.');
  if (resolveInterlockMode() !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  if (PRODUCTION_HOSTS.length !== 1) throw new Error('The Production target registry is ambiguous.');
  const resourceUrl = `https://${PRODUCTION_HOSTS[0]}`;
  if (classifyTarget(resourceUrl) !== 'production') throw new Error('Refusing target outside the registered Production Dataverse org.');
  if (!process.env.DYNAMICS_TENANT_ID || !process.env.DYNAMICS_CLIENT_ID || !process.env.DYNAMICS_CLIENT_SECRET) {
    throw new Error('Missing OAuth credential variable names required for Dataverse access.');
  }

  const resourceOrigin = new URL(resourceUrl).origin;
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const tableResults = [];
  for (const schema of [cycleSchema, roundSchema, listSchema]) tableResults.push(await inspectTable(client, schema));

  const roleFilter = eq('name', roleSpec.name);
  const roleQuery = await getJson(client, `roles?$select=roleid,name&$filter=${encodeURIComponent(roleFilter)}`);
  const roleExists = roleQuery.ok
    ? Array.isArray(roleQuery.body?.value) && roleQuery.body.value.some((role) => role.name === roleSpec.name)
    : null;
  const who = await getJson(client, 'WhoAmI');
  let assignedToApplication = null;
  let assignmentStatus = null;
  let assignmentErrorCode;
  if (who.ok && GUID.test(String(who.body?.UserId || ''))) {
    const assignment = await getJson(client,
      `systemusers(${who.body.UserId})/systemuserroles_association?$select=name&$filter=${encodeURIComponent(roleFilter)}`);
    assignmentStatus = assignment.status;
    assignmentErrorCode = assignment.errorCode;
    if (assignment.ok) {
      assignedToApplication = Array.isArray(assignment.body?.value)
        && assignment.body.value.some((role) => role.name === roleSpec.name);
    }
  }
  const source = await scanEligibleSource(client, resourceOrigin);
  const complete = tableResults.every((table) => table.available && table.identityMatches && table.expectedKeysActive === true)
    && roleExists === true && assignedToApplication === true && source.complete;
  console.log(JSON.stringify({
    target: new URL(resourceUrl).hostname,
    writesPerformed: false,
    selectedProposalFields: ['akoya_requestnum', 'wmkf_meetingdate', '_akoya_programid_value'],
    businessRowsPrinted: false,
    activationChecked: false,
    rankingTables: tableResults,
    applicationRole: {
      name: roleSpec.name,
      queryStatus: roleQuery.status,
      exists: roleExists,
      assignedToCurrentApplication: assignedToApplication,
      assignmentStatus,
      assignmentErrorCode,
    },
    eligibleOrdinaryPhaseIIPendingResearchRequests: source,
    inventoryComplete: complete,
  }, null, 2));
  if (!complete) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`Proposal Ranking Production readiness probe stopped safely (${error?.name || 'Error'}).`);
  process.exitCode = 1;
});
