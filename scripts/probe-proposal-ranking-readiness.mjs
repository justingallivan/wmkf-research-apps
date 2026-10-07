#!/usr/bin/env node

/**
 * Read-only Proposal Ranking activation inventory for the registered sandbox.
 * Every Dataverse request is GET-only; this script has no write methods.
 * It reports schema, app identity/role, isolation, settings, and source counts
 * without printing proposal, reviewer, setting-value, or credential data.
 *
 * Run from a checkout whose .env.local supplies the existing OAuth variables:
 *   node scripts/probe-proposal-ranking-readiness.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { classifyTarget, resolveInterlockMode } from '../lib/dataverse/core/interlock.js';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { RESEARCH_PROGRAM_IDS } from '../shared/config/researchPrograms.js';
import { PHASE_II_PENDING } from '../shared/config/workbenchVisibility.js';
import { meetingDateToCycleCode } from '../lib/utils/cycle-code.js';
import cycleSchema from '../lib/dataverse/schema/wave32-proposal-ranking/wmkf_proposalrankingcycle.json' with { type: 'json' };
import roundSchema from '../lib/dataverse/schema/wave32-proposal-ranking/wmkf_proposalrankinground.json' with { type: 'json' };
import listSchema from '../lib/dataverse/schema/wave32-proposal-ranking/wmkf_proposalrankinglist.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
const EXPECTED_ROLE = 'WMKF Proposal Ranking Application User';
const SETTING_KEY = 'proposal_ranking.default_facilitator_systemuser_id';
const EXPECTED_ENTITY_SETS = Object.freeze({
  wmkf_proposalrankingcycle: 'wmkf_proposalrankingcycles',
  wmkf_proposalrankinground: 'wmkf_proposalrankingrounds',
  wmkf_proposalrankinglist: 'wmkf_proposalrankinglists',
});
const SOURCE_SELECTS = Object.freeze({
  akoya_requests: 'akoya_requestid,akoya_requestnum,akoya_title,akoya_request,wmkf_organizationname,wmkf_meetingdate,akoya_requeststatus,wmkf_istestrequest,wmkf_testcreationrunid,_akoya_programid_value,_wmkf_programdirector_value,_transactioncurrencyid_value',
  wmkf_appreviewersuggestions: 'wmkf_appreviewersuggestionid,_wmkf_request_value,_wmkf_potentialreviewer_value,wmkf_reviewreceivedat,wmkf_selected,wmkf_accepted,wmkf_invited,wmkf_declined',
  wmkf_potentialreviewerses: 'wmkf_potentialreviewersid,wmkf_issyntheticreviewer,statecode',
  systemusers: 'systemuserid,fullname,isdisabled',
  transactioncurrencies: 'transactioncurrencyid,currencyname,isocurrencycode,currencyprecision',
});

function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), name), 'utf8').split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#')) continue;
        const index = text.indexOf('=');
        if (index < 1) continue;
        const key = text.slice(0, index).trim();
        const value = text.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {}
  }
}

function escapeOData(value) { return String(value).replace(/'/g, "''"); }

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

async function pages(client, firstPath, maxPages = 100) {
  const records = [];
  let path = firstPath;
  for (let page = 0; path && page < maxPages; page += 1) {
    const normalized = path.startsWith('http') ? path : `/${path.replace(/^\/+/, '')}`;
    const response = await client.get(normalized);
    if (!response.ok) {
      const errorCode = response.body?.error?.code;
      return {
        ok: false,
        status: response.status,
        errorCode: typeof errorCode === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(errorCode) ? errorCode : undefined,
        records: [],
        capped: false,
      };
    }
    const body = response.body || {};
    if (!Array.isArray(body.value)) return { ok: false, status: response.status, records: [], capped: false };
    records.push(...body.value);
    path = body['@odata.nextLink'] || null;
    if (path) {
      const nextHost = classifyTarget(path);
      if (nextHost !== 'sandbox') throw new Error('Dataverse returned a non-sandbox continuation URL; refusing to follow it.');
    }
  }
  return { ok: true, status: 200, records, capped: Boolean(path) };
}

function schemaExpected(spec) {
  const attributes = [
    { schemaName: spec.primaryNameAttribute.schemaName, type: 'String', maxLength: spec.primaryNameAttribute.maxLength },
    ...(spec.attributes || []).map((attribute) => ({
      schemaName: attribute.schemaName,
      type: attribute.type,
      maxLength: attribute.maxLength,
      behavior: attribute.behavior,
      options: attribute.options?.map((option) => option.value),
    })),
  ];
  return { ...spec, attributes };
}

function attributeMatches(expected, actual) {
  if (!actual || actual.SchemaName !== expected.schemaName || actual.AttributeType !== expected.type) return false;
  if (expected.maxLength != null && actual.MaxLength !== expected.maxLength) return false;
  if (expected.behavior && actual.DateTimeBehavior?.Value !== expected.behavior) return false;
  if (expected.options) {
    const observed = actual.OptionSet?.Options?.map((option) => option.Value).sort((a, b) => a - b) || [];
    const wanted = [...expected.options].sort((a, b) => a - b);
    if (JSON.stringify(observed) !== JSON.stringify(wanted)) return false;
  }
  return true;
}

function keyMatches(expected, actual) {
  const attributes = [...(actual?.KeyAttributes || [])].sort();
  return actual?.SchemaName === expected.schemaName
    && JSON.stringify(attributes) === JSON.stringify([...expected.keyAttributes].sort())
    && actual.EntityKeyIndexStatus === 'Active';
}

async function inspectEntity(client, spec) {
  const expected = schemaExpected(spec);
  const entity = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')?$select=LogicalName,SchemaName,EntitySetName,OwnershipType,PrimaryIdAttribute,PrimaryNameAttribute,IsValidForAdvancedFind,IsPrivate`);
  if (!entity.ok) return { name: spec.name, exists: false, status: entity.status, attributes: false, keys: false };
  const baseAttributes = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')/Attributes?$select=LogicalName,SchemaName,AttributeType`);
  const keyResponse = await getJson(client,
    `EntityDefinitions(LogicalName='${spec.name}')/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus`);
  const attributes = baseAttributes.body?.value || [];
  const keys = keyResponse.body?.value || [];
  const metadataType = { String: 'String', Memo: 'Memo', Integer: 'Integer', DateTime: 'DateTime', Picklist: 'Picklist' };
  const attributeResults = [];
  for (const item of expected.attributes) {
    const base = attributes.find((attribute) => attribute.SchemaName === item.schemaName);
    if (!base || base.AttributeType !== item.type) {
      attributeResults.push({ schemaName: item.schemaName, matches: false, status: baseAttributes.status });
      continue;
    }
    const derivedSelect = item.type === 'String' || item.type === 'Memo'
      ? ',MaxLength'
      : item.type === 'DateTime' ? ',DateTimeBehavior' : '';
    const expandOptions = item.type === 'Picklist' ? '&$expand=OptionSet' : '';
    const detail = await getJson(client,
      `EntityDefinitions(LogicalName='${spec.name}')/Attributes(LogicalName='${item.schemaName.toLowerCase()}')/Microsoft.Dynamics.CRM.${metadataType[item.type]}AttributeMetadata?`
      + `$select=LogicalName,SchemaName,AttributeType${derivedSelect}`
      + expandOptions);
    attributeResults.push({
      schemaName: item.schemaName,
      matches: detail.ok && attributeMatches(item, detail.body),
      status: detail.status,
      errorCode: detail.errorCode,
    });
  }
  const attributesMatch = baseAttributes.ok && attributeResults.every((result) => result.matches);
  const keysMatch = keyResponse.ok && expected.alternateKeys.every((key) => keys.some((actual) => keyMatches(key, actual)));
  return {
    name: spec.name,
    exists: true,
    status: entity.status,
    identityMatches: entity.body?.LogicalName === spec.name
      && entity.body?.SchemaName === spec.schemaName
      && entity.body?.EntitySetName === EXPECTED_ENTITY_SETS[spec.name]
      && entity.body?.PrimaryIdAttribute === `${spec.name}id`
      && String(entity.body?.PrimaryNameAttribute || '').toLowerCase() === spec.primaryNameAttribute.schemaName.toLowerCase(),
    entitySetName: entity.body?.EntitySetName || null,
    primaryIdAttribute: entity.body?.PrimaryIdAttribute || null,
    primaryNameAttribute: entity.body?.PrimaryNameAttribute || null,
    ownershipOrganization: entity.body?.OwnershipType === 'OrganizationOwned',
    advancedFindValid: entity.body?.IsValidForAdvancedFind ?? null,
    privateEntity: entity.body?.IsPrivate ?? null,
    relevanceSearchExclusion: 'not verified by entity metadata',
    attributes: attributesMatch,
    attributesStatus: baseAttributes.status,
    attributeFailures: attributeResults.filter((result) => !result.matches).map(({ schemaName, status, errorCode }) => ({ schemaName, status, errorCode })),
    keys: keysMatch,
    keysStatus: keyResponse.status,
    keyStatuses: keys.map((key) => ({ name: key.SchemaName, status: key.EntityKeyIndexStatus })),
  };
}

async function inspectSource(client) {
  const selects = {};
  for (const [entity, select] of Object.entries(SOURCE_SELECTS)) {
    const result = await getJson(client, `${entity}?$select=${select}&$top=1`);
    selects[entity] = { available: result.ok, status: result.status };
  }

  const programFilter = RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  const filter = `(${programFilter}) and akoya_requeststatus eq '${PHASE_II_PENDING}' and ((wmkf_istestrequest eq false or wmkf_istestrequest eq null) and wmkf_testcreationrunid eq null)`;
  const requests = await pages(client,
    `akoya_requests?$select=${SOURCE_SELECTS.akoya_requests}&$filter=${encodeURIComponent(filter)}&$orderby=wmkf_meetingdate asc`);
  if (!requests.ok || requests.capped) {
    return { selects, requestScan: { available: requests.ok, status: requests.status, errorCode: requests.errorCode, capped: requests.capped }, activeSystemUserCount: null, cycles: {} };
  }
  const activeStaff = await pages(client, 'systemusers?$select=systemuserid&$filter=isdisabled eq false');
  const grouped = new Map();
  for (const row of requests.records) {
    const cycle = meetingDateToCycleCode(row.wmkf_meetingdate);
    if (!cycle) continue;
    const group = grouped.get(cycle) || { eligibleProposalCount: 0, se: 0, mr: 0, missingLead: 0, missingAmount: 0, missingCurrency: 0 };
    group.eligibleProposalCount += 1;
    if (row._akoya_programid_value?.toLowerCase() === RESEARCH_PROGRAM_IDS[0]) group.se += 1;
    if (row._akoya_programid_value?.toLowerCase() === RESEARCH_PROGRAM_IDS[1]) group.mr += 1;
    if (!row._wmkf_programdirector_value) group.missingLead += 1;
    if (row.akoya_request == null) group.missingAmount += 1;
    if (row.akoya_request != null && !row._transactioncurrencyid_value) group.missingCurrency += 1;
    grouped.set(cycle, group);
  }
  return {
    selects,
    requestScan: { available: true, status: requests.status, capped: false, eligibleOrdinaryPhaseIIPendingCount: requests.records.length, missingJuneDecemberDateCount: requests.records.filter((row) => !meetingDateToCycleCode(row.wmkf_meetingdate)).length },
    activeSystemUserCount: activeStaff.ok && !activeStaff.capped ? activeStaff.records.length : null,
    cycles: Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function inspectIdentityAndRole(client) {
  const who = await getJson(client, 'WhoAmI');
  if (!who.ok || !who.body?.UserId) return { available: false, status: who.status };
  const userId = String(who.body.UserId).toLowerCase();
  const roles = await pages(client, `systemusers(${userId})/systemuserroles_association?$select=roleid,name&$top=5000`);
  return {
    available: roles.ok && !roles.capped,
    systemUserId: userId,
    status: roles.status,
    proposalRankingRoleAssigned: roles.records?.some((role) => role.name === EXPECTED_ROLE) || false,
    assignedRoleNames: (roles.records || []).map((role) => role.name).filter(Boolean).sort(),
  };
}

async function main() {
  loadEnvFiles();
  if (resolveInterlockMode() !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  const resourceUrl = process.env.DYNAMICS_SANDBOX_URL || `https://${SANDBOX_HOSTS[0]}`;
  if (classifyTarget(resourceUrl) !== 'sandbox') throw new Error('Refusing target outside the registered Dataverse sandbox.');
  if (!process.env.DYNAMICS_TENANT_ID || !process.env.DYNAMICS_CLIENT_ID || !process.env.DYNAMICS_CLIENT_SECRET) {
    throw new Error('Missing OAuth credential variable names required for Dataverse access.');
  }
  const hostname = new URL(resourceUrl).hostname;
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const who = await inspectIdentityAndRole(client);
  const schema = [];
  for (const spec of [cycleSchema, roundSchema, listSchema]) schema.push(await inspectEntity(client, spec));

  const requestIsolation = await getJson(client,
    "EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,SchemaName&$filter=LogicalName eq 'wmkf_istestrequest' or LogicalName eq 'wmkf_testcreationrunid'");
  const reviewerIsolation = await getJson(client,
    "EntityDefinitions(LogicalName='wmkf_potentialreviewers')/Attributes?$select=LogicalName,SchemaName&$filter=LogicalName eq 'wmkf_issyntheticreviewer'");
  const settings = await getJson(client,
    `wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue&$filter=${encodeURIComponent(`wmkf_settingkey eq '${escapeOData(SETTING_KEY)}'`)}&$top=1`);
  const source = await inspectSource(client);

  const report = {
    target: hostname,
    writesPerformed: false,
    identityAndRole: who,
    schema,
    isolation: {
      requestMarkers: {
        available: requestIsolation.ok,
        complete: requestIsolation.ok && ['wmkf_istestrequest', 'wmkf_testcreationrunid'].every((field) => requestIsolation.body?.value?.some((item) => item.LogicalName === field)),
        status: requestIsolation.status,
        fields: requestIsolation.body?.value?.map((field) => field.LogicalName) || [],
      },
      syntheticReviewerMarker: {
        available: reviewerIsolation.ok,
        complete: reviewerIsolation.ok && reviewerIsolation.body?.value?.some((item) => item.LogicalName === 'wmkf_issyntheticreviewer'),
        status: reviewerIsolation.status,
        fields: reviewerIsolation.body?.value?.map((field) => field.LogicalName) || [],
      },
      switches: {
        testRequestIsolationEnabled: process.env.TEST_REQUEST_ISOLATION === 'on',
        syntheticReviewerIsolationEnabled: process.env.SYNTHETIC_REVIEWER_ISOLATION === 'on',
        proposalRankingSchemaReady: process.env.PROPOSAL_RANKING_SCHEMA_READY === 'on',
        proposalRankingEnabled: process.env.PROPOSAL_RANKING_ENABLED === 'on',
      },
    },
    defaultFacilitatorSetting: {
      available: settings.ok,
      status: settings.status,
      rowPresent: Boolean(settings.body?.value?.length),
      valueValidGuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settings.body?.value?.[0]?.wmkf_settingvalue || ''),
    },
    source,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`Proposal Ranking readiness probe stopped safely (${error?.name || 'Error'}).`);
  process.exitCode = 1;
});
