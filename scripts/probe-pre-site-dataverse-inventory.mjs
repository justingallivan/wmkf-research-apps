#!/usr/bin/env node

/**
 * Read-only inventory for Pre-Site Visit persistence planning.
 *
 * Reports only metadata, aggregate request-document counts, and governed
 * prompt identity. It never prints credentials, access tokens, document
 * content, request content, or unrelated record data.
 *
 * Usage:
 *   node scripts/probe-pre-site-dataverse-inventory.mjs --target=prod
 *   node scripts/probe-pre-site-dataverse-inventory.mjs --target=sandbox
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of content.split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 0) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg?.slice('--target='.length);
if (!['prod', 'sandbox'].includes(target)) {
  throw new Error('Pass --target=prod or --target=sandbox.');
}

const resourceUrl = target === 'prod'
  ? process.env.DYNAMICS_URL
  : process.env.DYNAMICS_SANDBOX_URL;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const SEARCH_RE = /(writeup|pre[ _-]?site|site[ _-]?visit|draft|artifact|document|narrative)/i;
const ARTIFACT_LABEL = new Map([
  [100000000, 'Initial Assessment'],
  [100000001, 'Pre Site Visit'],
  [100000002, 'Final Writeup'],
  [100000003, 'Applicant Slides'],
  [100000004, 'Other Applicant Materials'],
  [100000005, 'Recording'],
  [100000006, 'Transcript'],
  [100000007, 'Transcript Summary'],
]);
const OPERATION_LABEL = new Map([
  [100000000, 'Generating'],
  [100000001, 'Ready'],
  [100000002, 'Failed'],
]);
const LIFECYCLE_LABEL = new Map([
  [100000000, 'Draft'],
  [100000001, 'Review'],
  [100000002, 'Board Ready'],
  [100000003, 'Superseded'],
  [100000004, 'Final'],
]);

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DYNAMICS_CLIENT_ID,
        client_secret: DYNAMICS_CLIENT_SECRET,
        scope: `${resourceUrl}/.default`,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`Token request failed (${response.status}).`);
  }
  return body.access_token;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    Prefer: 'odata.maxpagesize=5000',
  };
}

async function getJson(token, pathOrUrl) {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${resourceUrl}/api/data/v9.2/${pathOrUrl}`;
  const response = await fetch(url, { headers: headers(token) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET failed (${response.status}) for ${new URL(url).pathname}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function getAll(token, path) {
  const rows = [];
  let next = path;
  while (next) {
    const body = await getJson(token, next);
    rows.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

function label(metadata) {
  return metadata?.UserLocalizedLabel?.Label
    || metadata?.LocalizedLabels?.[0]?.Label
    || null;
}

function searchableMetadata(row) {
  return [
    row.LogicalName,
    row.SchemaName,
    row.EntitySetName,
    label(row.DisplayName),
    label(row.Description),
  ].filter(Boolean).join(' ');
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedCounts(map) {
  return [...map.entries()]
    .map(([labelValue, count]) => ({ label: labelValue, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function getAttributeRows(token, entity) {
  return getAll(
    token,
    `EntityDefinitions(LogicalName='${entity}')/Attributes?`
      + '$select=LogicalName,SchemaName,AttributeType,DisplayName,Description,'
      + 'IsCustomAttribute,IsValidForRead,IsValidForCreate,IsValidForUpdate',
  );
}

function summarizeAttribute(row) {
  return {
    logicalName: row.LogicalName,
    type: row.AttributeType,
    displayName: label(row.DisplayName),
    description: label(row.Description),
    custom: row.IsCustomAttribute,
    readable: row.IsValidForRead,
    creatable: row.IsValidForCreate,
    updatable: row.IsValidForUpdate,
  };
}

async function main() {
  const token = await getToken();

  const entityDefinitions = await getAll(
    token,
    'EntityDefinitions?$select=LogicalName,SchemaName,EntitySetName,DisplayName,Description,IsCustomEntity'
      + '&$filter=IsCustomEntity eq true',
  );
  const matchingEntities = entityDefinitions
    .filter((row) => SEARCH_RE.test(searchableMetadata(row)))
    .map((row) => ({
      logicalName: row.LogicalName,
      entitySetName: row.EntitySetName,
      displayName: label(row.DisplayName),
      description: label(row.Description),
    }))
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));

  const matchingAttributes = {};
  for (const entity of ['akoya_request', 'wmkf_requestdocument']) {
    const rows = await getAttributeRows(token, entity);
    matchingAttributes[entity] = rows
      .filter((row) => SEARCH_RE.test(searchableMetadata(row)))
      .map(summarizeAttribute)
      .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  }

  const siteVisitDefinition = await getJson(
    token,
    "EntityDefinitions(LogicalName='wmkf_sitevisit')?"
      + '$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute'
      + '&$expand=ManyToOneRelationships('
      + '$select=SchemaName,ReferencedEntity,ReferencingAttribute,'
      + 'ReferencingEntityNavigationPropertyName)',
  );
  const siteVisitAttributes = (await getAttributeRows(token, 'wmkf_sitevisit'))
    .filter((row) => row.IsCustomAttribute || [
      siteVisitDefinition.PrimaryIdAttribute,
      siteVisitDefinition.PrimaryNameAttribute,
      'createdon',
      'modifiedon',
      'statecode',
      'statuscode',
    ].includes(row.LogicalName))
    .map(summarizeAttribute)
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  const siteVisitRelationships = (siteVisitDefinition.ManyToOneRelationships || [])
    .filter((row) => row.SchemaName?.startsWith('wmkf_') || row.ReferencedEntity === 'akoya_request')
    .map((row) => ({
      schemaName: row.SchemaName,
      referencedEntity: row.ReferencedEntity,
      referencingAttribute: row.ReferencingAttribute,
      navigationProperty: row.ReferencingEntityNavigationPropertyName,
    }))
    .sort((a, b) => a.schemaName.localeCompare(b.schemaName));
  const siteVisitCountBody = await getJson(
    token,
    `wmkf_sitevisits?$select=${siteVisitDefinition.PrimaryIdAttribute}&$count=true&$top=1`,
  );

  const writeupTypeMetadata = await getJson(
    token,
    "EntityDefinitions(LogicalName='akoya_request')/"
      + "Attributes(LogicalName='wmkf_researchwriteuptype')/"
      + 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata?'
      + '$select=LogicalName,AttributeType,DisplayName,Description&$expand=OptionSet',
  );
  const writeupTypeRows = await getAll(
    token,
    'akoya_requests?$select=wmkf_researchwriteuptype'
      + '&$filter=wmkf_researchwriteuptype ne null',
  );
  const writeupTypeOptions = (writeupTypeMetadata.OptionSet?.Options || [])
    .map((option) => ({
      value: option.Value,
      label: label(option.Label),
      liveRows: writeupTypeRows.filter(
        (row) => row.wmkf_researchwriteuptype === option.Value,
      ).length,
    }))
    .sort((a, b) => a.value - b.value);

  const documents = await getAll(
    token,
    'wmkf_requestdocuments?$select=wmkf_artifacttype,wmkf_operationstatus,wmkf_lifecyclestate',
  );
  const artifactCounts = new Map();
  const operationCounts = new Map();
  const lifecycleCounts = new Map();
  for (const row of documents) {
    increment(artifactCounts, ARTIFACT_LABEL.get(row.wmkf_artifacttype) || `Unknown ${row.wmkf_artifacttype}`);
    increment(operationCounts, OPERATION_LABEL.get(row.wmkf_operationstatus) || `Unknown ${row.wmkf_operationstatus}`);
    increment(lifecycleCounts, LIFECYCLE_LABEL.get(row.wmkf_lifecyclestate) || `Unknown ${row.wmkf_lifecyclestate}`);
  }

  const promptName = 'pre-site-visit.proposal-core.generate';
  const prompts = await getAll(
    token,
    'wmkf_ai_prompts?$select=wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,'
      + 'wmkf_ai_iscurrent,wmkf_ai_model,wmkf_ai_promptstatus'
      + `&$filter=wmkf_ai_promptname eq '${promptName}'`,
  );

  console.log(JSON.stringify({
    target,
    queryScope: {
      entityDefinitions: 'all custom entities',
      attributes: ['akoya_request', 'wmkf_requestdocument'],
      searchTerms: SEARCH_RE.source,
      requestDocumentRows: documents.length,
      promptName,
    },
    matchingEntities,
    matchingAttributes,
    existingWriteupAndVisitStructures: {
      researchWriteupType: {
        displayName: label(writeupTypeMetadata.DisplayName),
        description: label(writeupTypeMetadata.Description),
        populatedRequestRows: writeupTypeRows.length,
        options: writeupTypeOptions,
      },
      siteVisit: {
        logicalName: siteVisitDefinition.LogicalName,
        entitySetName: siteVisitDefinition.EntitySetName,
        rowCount: siteVisitCountBody['@odata.count'] ?? null,
        attributes: siteVisitAttributes,
        relationships: siteVisitRelationships,
      },
    },
    requestDocumentCounts: {
      total: documents.length,
      byArtifactType: sortedCounts(artifactCounts),
      byOperationStatus: sortedCounts(operationCounts),
      byLifecycleState: sortedCounts(lifecycleCounts),
    },
    promptRows: prompts
      .map((row) => ({
        id: row.wmkf_ai_promptid,
        name: row.wmkf_ai_promptname,
        version: row.wmkf_promptversion,
        current: row.wmkf_ai_iscurrent,
        model: row.wmkf_ai_model,
        status: row.wmkf_ai_promptstatus,
      }))
      .sort((a, b) => a.version - b.version),
  }, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
