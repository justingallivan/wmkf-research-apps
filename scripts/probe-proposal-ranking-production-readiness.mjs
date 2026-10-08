#!/usr/bin/env node

/**
 * Read-only Production inventory for Proposal Ranking storage and eligible
 * source counts. Every Dataverse request is GET-only. Request number is read
 * only to apply the December 2026 trial cutoff; request data is never printed.
 * The current application's system-user ID is included for role assignment.
 *
 * Requires an explicit target and local read grant:
 *   DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_TARGET_INTERLOCK=on \
 *     node scripts/probe-proposal-ranking-production-readiness.mjs --target=production
 */

import { createRequire } from 'node:module';
import { classifyTarget, resolveInterlockMode } from '../lib/dataverse/core/interlock.js';
import { eq, eqGuid } from '../lib/dataverse/core/odata.js';
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
import solutionSpec from '../lib/dataverse/schema/solution.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const { resolvePrivilegeIds } = require('../lib/dataverse/role-apply.js');
const API_PATH = '/api/data/v9.2/akoya_requests';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// These default platform privileges are present in Microsoft's documented
// security-role creation sample; no other non-ranking privileges are allowed.
// https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/web-api-functions-actions-sample
const ALLOWED_PLATFORM_BASELINE_PRIVILEGES = new Set([
  'prvreadsdkmessage',
  'prvreadsdkmessageprocessingstep',
  'prvreadsdkmessageprocessingstepimage',
  'prvreadplugintype',
  'prvreadpluginassembly',
  'prvreadsharepointdocument',
  'prvreadsharepointdata',
  'prvwritesharepointdata',
  'prvcreatesharepointdata',
]);

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

function expectedAttributes(spec) {
  return [
    { schemaName: spec.primaryNameAttribute.schemaName, type: 'String', maxLength: spec.primaryNameAttribute.maxLength, requiredLevel: spec.primaryNameAttribute.requiredLevel },
    ...(spec.attributes || []).map((attribute) => ({
      schemaName: attribute.schemaName,
      type: attribute.type,
      maxLength: attribute.maxLength,
      minValue: attribute.minValue,
      maxValue: attribute.maxValue,
      behavior: attribute.behavior,
      options: attribute.options?.map((option) => option.value),
      requiredLevel: attribute.requiredLevel,
    })),
  ];
}

function attributeMismatchReasons(expected, actual) {
  const mismatches = [];
  if (!actual || actual.SchemaName !== expected.schemaName) return ['missing'];
  if (actual.AttributeType !== expected.type) mismatches.push('type');
  if (expected.maxLength != null && actual.MaxLength !== expected.maxLength) mismatches.push('maxLength');
  if (expected.minValue != null && actual.MinValue !== expected.minValue) mismatches.push('minValue');
  if (expected.maxValue != null && actual.MaxValue !== expected.maxValue) mismatches.push('maxValue');
  if (expected.behavior && actual.DateTimeBehavior?.Value !== expected.behavior) mismatches.push('dateTimeBehavior');
  if (expected.requiredLevel && actual.RequiredLevel?.Value !== expected.requiredLevel) mismatches.push('requiredLevel');
  if (expected.options) {
    const observed = actual.OptionSet?.Options?.map((option) => option.Value).sort((a, b) => a - b) || [];
    const wanted = [...expected.options].sort((a, b) => a - b);
    if (JSON.stringify(observed) !== JSON.stringify(wanted)) mismatches.push('options');
  }
  return mismatches;
}

async function resolveExpectedRolePrivileges(client) {
  const expected = [];
  const missing = [];
  for (const tableSpec of roleSpec.privileges) {
    const result = await resolvePrivilegeIds(client, tableSpec.table, tableSpec.ops);
    missing.push(...result.missing);
    for (const privilege of result.resolved) {
      expected.push({
        privilegeId: String(privilege.privilegeId || '').toLowerCase(),
        privilegeName: privilege.name,
        depth: tableSpec.depth,
      });
    }
  }
  return { expected, missing };
}

function compareRolePrivileges(expected, actual, rootBusinessUnitId) {
  const mismatches = [];
  if (!Array.isArray(actual)) return { exactSetMatches: false, actualCount: null, allowedBaselineNames: [], mismatches: [{ reason: 'RolePrivileges response is missing or malformed.' }] };
  const expectedById = new Map(expected.map((item) => [item.privilegeId, item]));
  const actualById = new Map();
  for (const item of actual) {
    const id = String(item?.PrivilegeId || '').toLowerCase();
    if (!id || actualById.has(id)) mismatches.push({ privilegeId: id || null, reason: 'missing or duplicate privilege ID' });
    else actualById.set(id, item);
  }
  for (const wanted of expected) {
    const observed = actualById.get(wanted.privilegeId);
    if (!observed) {
      mismatches.push({ privilegeName: wanted.privilegeName, reason: 'missing' });
      continue;
    }
    if (String(observed.PrivilegeName || '').toLowerCase() !== wanted.privilegeName.toLowerCase()) mismatches.push({ privilegeName: wanted.privilegeName, reason: 'name' });
    if (observed.Depth !== wanted.depth) mismatches.push({ privilegeName: wanted.privilegeName, reason: 'depth' });
    if (String(observed.BusinessUnitId || '').toLowerCase() !== rootBusinessUnitId.toLowerCase()) mismatches.push({ privilegeName: wanted.privilegeName, reason: 'businessUnit' });
  }
  const allowedBaselineNames = [];
  for (const [id, observed] of actualById) {
    if (expectedById.has(id)) continue;
    const name = String(observed.PrivilegeName || '');
    if (ALLOWED_PLATFORM_BASELINE_PRIVILEGES.has(name.toLowerCase())) allowedBaselineNames.push(name);
    else mismatches.push({ privilegeName: name || null, reason: 'unexpected privilege' });
  }
  return {
    exactSetMatches: mismatches.length === 0 && expected.every((item) => actualById.has(item.privilegeId)),
    actualCount: actual.length,
    allowedBaselineNames: allowedBaselineNames.sort(),
    mismatches,
  };
}

async function inspectTable(client, spec) {
  const entity = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')?$select=LogicalName,SchemaName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`);
  if (!entity.ok) {
    return { logicalName: spec.name, available: false, status: entity.status, errorCode: entity.errorCode, attributesMatch: false, expectedKeysActive: null, keyStatuses: [] };
  }
  const baseAttributes = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')/Attributes?$select=LogicalName,SchemaName,AttributeType`);
  const keys = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus`);
  const baseRows = baseAttributes.body?.value || [];
  const expected = expectedAttributes(spec);
  const metadataType = { String: 'String', Memo: 'Memo', Integer: 'Integer', DateTime: 'DateTime', Picklist: 'Picklist' };
  const attributeFailures = [];
  if (!baseAttributes.ok || baseAttributes.body?.['@odata.nextLink']) {
    attributeFailures.push({ schemaName: '*', reasons: [baseAttributes.ok ? 'incomplete' : 'unavailable'], status: baseAttributes.status, errorCode: baseAttributes.errorCode });
  } else {
    for (const item of expected) {
      const base = baseRows.find((attribute) => attribute.SchemaName === item.schemaName);
      if (!base || base.AttributeType !== item.type) {
        attributeFailures.push({ schemaName: item.schemaName, reasons: [base ? 'type' : 'missing'] });
        continue;
      }
      const derivedSelect = item.type === 'String' || item.type === 'Memo'
        ? ',MaxLength,RequiredLevel'
        : item.type === 'Integer' ? ',MinValue,MaxValue,RequiredLevel'
          : item.type === 'DateTime' ? ',DateTimeBehavior,RequiredLevel' : ',RequiredLevel';
      const expandOptions = item.type === 'Picklist' ? '&$expand=OptionSet' : '';
      const detail = await getJson(client,
        `EntityDefinitions(LogicalName='${spec.name}')/Attributes(LogicalName='${item.schemaName.toLowerCase()}')/Microsoft.Dynamics.CRM.${metadataType[item.type]}AttributeMetadata?`
        + `$select=LogicalName,SchemaName,AttributeType${derivedSelect}${expandOptions}`);
      const reasons = detail.ok ? attributeMismatchReasons(item, detail.body) : ['metadataUnavailable'];
      if (reasons.length) attributeFailures.push({ schemaName: item.schemaName, reasons, status: detail.status, errorCode: detail.errorCode });
    }
  }
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
    attributesMatch: baseAttributes.ok && !baseAttributes.body?.['@odata.nextLink'] && attributeFailures.length === 0,
    attributeFailures,
    attributesStatus: baseAttributes.status,
    expectedKeysActive,
    keyStatuses: actualKeys.map((key) => ({
      schemaName: key.SchemaName,
      keyAttributes: key.KeyAttributes,
      indexStatus: key.EntityKeyIndexStatus,
    })),
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
  const solutionFilter = eq('uniquename', solutionSpec.uniqueName);
  const solutionQuery = await getJson(client,
    `solutions?$select=solutionid,uniquename&$filter=${encodeURIComponent(solutionFilter)}&$top=2`);
  const solutionExists = solutionQuery.ok
    && Array.isArray(solutionQuery.body?.value)
    && solutionQuery.body.value.length === 1
    && solutionQuery.body.value[0].uniquename === solutionSpec.uniqueName;
  const tableResults = [];
  for (const schema of [cycleSchema, roundSchema, listSchema]) tableResults.push(await inspectTable(client, schema));

  const rootBusinessUnitQuery = await getJson(client,
    'businessunits?$select=businessunitid&$filter=parentbusinessunitid eq null&$top=2');
  const rootBusinessUnitRows = rootBusinessUnitQuery.body?.value || [];
  const rootBusinessUnitId = rootBusinessUnitQuery.ok && rootBusinessUnitRows.length === 1
    ? String(rootBusinessUnitRows[0].businessunitid || '').toLowerCase()
    : null;
  const rootBusinessUnitVerified = Boolean(rootBusinessUnitId && GUID.test(rootBusinessUnitId));
  const roleFilter = rootBusinessUnitVerified
    ? `${eq('name', roleSpec.name)} and ${eqGuid('_businessunitid_value', rootBusinessUnitId)}`
    : null;
  const roleQuery = roleFilter
    ? await getJson(client, `roles?$select=roleid,name,_businessunitid_value&$filter=${encodeURIComponent(roleFilter)}&$top=2`)
    : { ok: false, status: null, body: {} };
  const roleRows = roleQuery.body?.value || [];
  const exactRole = roleQuery.ok && roleRows.length === 1
    && roleRows[0].name === roleSpec.name
    && String(roleRows[0]._businessunitid_value || '').toLowerCase() === rootBusinessUnitId
    && GUID.test(String(roleRows[0].roleid || ''))
    ? roleRows[0]
    : null;
  const roleId = exactRole ? String(exactRole.roleid).toLowerCase() : null;
  const roleExists = Boolean(exactRole);
  const expectedPrivileges = rootBusinessUnitVerified
    ? await resolveExpectedRolePrivileges(client)
    : { expected: [], missing: roleSpec.privileges.flatMap((item) => item.ops.map((op) => `prv${op}${item.table}`)) };
  // RetrieveRolePrivilegesRole is an unbound, no-side-effect GET function;
  // Microsoft documents the top-level RolePrivileges response and its
  // PrivilegeId, PrivilegeName, Depth, and BusinessUnitId members.
  const rolePrivilegeResponse = roleId
    ? await getJson(client, `RetrieveRolePrivilegesRole(RoleId=${roleId})`)
    : { ok: false, status: null, body: {} };
  const privilegeComparison = compareRolePrivileges(
    expectedPrivileges.expected,
    rolePrivilegeResponse.body?.RolePrivileges,
    rootBusinessUnitId || '',
  );
  const rolePrivilegesMatch = Boolean(rolePrivilegeResponse.ok
    && expectedPrivileges.missing.length === 0
    && expectedPrivileges.expected.length === 9
    && privilegeComparison.exactSetMatches);
  const who = await getJson(client, 'WhoAmI');
  const systemUserId = who.ok && GUID.test(String(who.body?.UserId || ''))
    ? String(who.body.UserId).toLowerCase()
    : null;
  let userStatus = null;
  let appIdMatches = false;
  let enabled = false;
  let assignedToApplication = null;
  let assignmentStatus = null;
  let assignmentErrorCode;
  let exclusiveAssignmentStatus = null;
  let exclusiveAssignmentToApplication = false;
  let assignedUserCount = null;
  let teamAssignmentStatus = null;
  let assignedTeamCount = null;
  let unassignedToTeams = false;
  if (systemUserId) {
    const applicationUser = await getJson(client,
      `systemusers(${systemUserId})?$select=systemuserid,applicationid,isdisabled`);
    userStatus = applicationUser.status;
    const matchingUser = applicationUser.ok
      && String(applicationUser.body?.systemuserid || '').toLowerCase() === systemUserId;
    appIdMatches = matchingUser
      && GUID.test(String(applicationUser.body?.applicationid || ''))
      && String(applicationUser.body.applicationid).toLowerCase() === String(process.env.DYNAMICS_CLIENT_ID || '').toLowerCase();
    enabled = matchingUser && applicationUser.body?.isdisabled === false;
    if (roleId) {
      const assignment = await getJson(client,
        `systemusers(${systemUserId})/systemuserroles_association?$select=roleid,name&$filter=${encodeURIComponent(eqGuid('roleid', roleId))}`);
      assignmentStatus = assignment.status;
      assignmentErrorCode = assignment.errorCode;
      if (assignment.ok) {
        assignedToApplication = Array.isArray(assignment.body?.value)
          && assignment.body.value.some((role) => String(role.roleid || '').toLowerCase() === roleId && role.name === roleSpec.name);
      }
      const roleUsers = await getJson(client,
        `roles(${roleId})/systemuserroles_association?$select=systemuserid&$top=2`);
      exclusiveAssignmentStatus = roleUsers.status;
      const assignedUsers = roleUsers.body?.value;
      assignedUserCount = Array.isArray(assignedUsers) ? assignedUsers.length : null;
      exclusiveAssignmentToApplication = Boolean(roleUsers.ok
        && Array.isArray(assignedUsers)
        && !roleUsers.body?.['@odata.nextLink']
        && assignedUsers.length === 1
        && String(assignedUsers[0].systemuserid || '').toLowerCase() === systemUserId
        && appIdMatches && enabled);
      const roleTeams = await getJson(client,
        `roles(${roleId})/teamroles_association?$select=teamid&$top=1`);
      teamAssignmentStatus = roleTeams.status;
      const assignedTeams = roleTeams.body?.value;
      assignedTeamCount = Array.isArray(assignedTeams) ? assignedTeams.length : null;
      unassignedToTeams = Boolean(roleTeams.ok
        && Array.isArray(assignedTeams)
        && !roleTeams.body?.['@odata.nextLink']
        && assignedTeams.length === 0);
    }
  }
  const source = await scanEligibleSource(client, resourceOrigin);
  const complete = tableResults.every((table) => table.available && table.identityMatches && table.attributesMatch && table.expectedKeysActive === true)
    && solutionExists && rootBusinessUnitVerified && roleExists && rolePrivilegesMatch
    && appIdMatches && enabled && assignedToApplication === true && exclusiveAssignmentToApplication
    && unassignedToTeams && source.complete;
  console.log(JSON.stringify({
    target: new URL(resourceUrl).hostname,
    writesPerformed: false,
    selectedProposalFields: ['akoya_requestnum', 'wmkf_meetingdate', '_akoya_programid_value'],
    businessRowsPrinted: false,
    activationChecked: false,
    solution: {
      uniqueName: solutionSpec.uniqueName,
      available: solutionQuery.ok,
      status: solutionQuery.status,
      exists: solutionExists,
    },
    rankingTables: tableResults,
    applicationRole: {
      name: roleSpec.name,
      roleId,
      queryStatus: roleQuery.status,
      exists: roleExists,
      rootBusinessUnitVerified,
      rootBusinessUnitId,
      expectedPrivilegeCount: expectedPrivileges.expected.length,
      missingExpectedPrivileges: expectedPrivileges.missing,
      retrievePrivilegesStatus: rolePrivilegeResponse.status,
      actualPrivilegeCount: privilegeComparison.actualCount,
      privilegeSetMatches: rolePrivilegesMatch,
      allowedPlatformBaselinePrivileges: privilegeComparison.allowedBaselineNames,
      privilegeMismatches: privilegeComparison.mismatches,
      systemUserId,
      userStatus,
      appIdMatches,
      enabled,
      assignedToCurrentApplication: assignedToApplication,
      assignmentStatus,
      assignmentErrorCode,
      exclusiveAssignmentToApplication,
      exclusiveAssignmentStatus,
      assignedUserCount,
      unassignedToTeams,
      teamAssignmentStatus,
      assignedTeamCount,
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
