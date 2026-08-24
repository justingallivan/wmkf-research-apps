#!/usr/bin/env node

/**
 * Read-only Dataverse capability inventory for the Site Visit logistics slice.
 *
 * Reports entity/attribute/relationship shape, row visibility, Activity state
 * options, document-registry parity, and the app user's assigned role names.
 * It never creates, updates, sends, or deletes a record and never prints tokens
 * or credentials.
 *
 * Usage:
 *   node scripts/probe-site-visit-logistics-capabilities.mjs --target=prod
 *   node scripts/probe-site-visit-logistics-capabilities.mjs --target=sandbox
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 1) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
if (!['prod', 'sandbox'].includes(target)) {
  throw new Error('Pass --target=prod or --target=sandbox.');
}

const sandboxUrl = process.env.DYNAMICS_SANDBOX_URL
  || (SANDBOX_HOSTS[0] ? `https://${SANDBOX_HOSTS[0]}` : null);
const resourceUrl = target === 'prod' ? process.env.DYNAMICS_URL : sandboxUrl;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const IMPORTANT_ATTRIBUTES = new Set([
  'activityid',
  'subject',
  'description',
  'scheduledstart',
  'scheduledend',
  'scheduleddurationminutes',
  'organizer',
  'requiredattendees',
  'optionalattendees',
  'regardingobjectid',
  'location',
  'statecode',
  'statuscode',
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
  const body = await response.json().catch(() => ({}));
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
  };
}

async function get(token, path) {
  const response = await fetch(`${resourceUrl}/api/data/v9.2/${path}`, {
    headers: headers(token),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function label(metadata) {
  return metadata?.UserLocalizedLabel?.Label
    || metadata?.LocalizedLabels?.[0]?.Label
    || null;
}

function absent(errorResult) {
  return {
    exists: false,
    status: errorResult.status,
    error: errorResult.body?.error?.message || `HTTP ${errorResult.status}`,
  };
}

async function entityDefinition(token, logicalName) {
  const result = await get(
    token,
    `EntityDefinitions(LogicalName='${logicalName}')?`
      + '$select=LogicalName,EntitySetName,IsActivity,PrimaryIdAttribute,PrimaryNameAttribute',
  );
  if (!result.ok) return absent(result);
  return { exists: true, status: result.status, ...result.body };
}

async function activityOptions(token, logicalName) {
  const result = await get(
    token,
    `EntityDefinitions(LogicalName='wmkf_sitevisit')/Attributes(LogicalName='${logicalName}')/`
      + `Microsoft.Dynamics.CRM.${logicalName === 'statecode' ? 'State' : 'Status'}AttributeMetadata?`
      + '$select=LogicalName&$expand=OptionSet',
  );
  if (!result.ok) return { status: result.status, options: [] };
  return {
    status: result.status,
    options: (result.body.OptionSet?.Options || []).map((option) => ({
      value: option.Value,
      label: label(option.Label),
      state: option.State ?? null,
    })),
  };
}

async function textAttributeDetails(token, logicalName, metadataType = 'String') {
  const result = await get(
    token,
    `EntityDefinitions(LogicalName='wmkf_sitevisit')/Attributes(LogicalName='${logicalName}')/`
      + `Microsoft.Dynamics.CRM.${metadataType}AttributeMetadata?`
      + '$select=LogicalName,AttributeType,MaxLength',
  );
  if (!result.ok) return absent(result);
  return {
    exists: true,
    logicalName: result.body.LogicalName,
    maxLength: result.body.MaxLength,
  };
}

async function partyListAttributeDetails(token, logicalName) {
  const result = await get(
    token,
    `EntityDefinitions(LogicalName='wmkf_sitevisit')/Attributes(LogicalName='${logicalName}')/`
      + 'Microsoft.Dynamics.CRM.LookupAttributeMetadata?'
      + '$select=LogicalName,AttributeType,Targets',
  );
  if (!result.ok) return absent(result);
  return {
    exists: true,
    logicalName: result.body.LogicalName,
    attributeType: result.body.AttributeType,
    targets: result.body.Targets,
  };
}

async function main() {
  const token = await getToken();
  const siteVisit = await entityDefinition(token, 'wmkf_sitevisit');
  const requestDocument = await entityDefinition(token, 'wmkf_requestdocument');

  if (!siteVisit.exists) {
    console.log(JSON.stringify({ target, resourceUrl, siteVisit, requestDocument }, null, 2));
    process.exitCode = 1;
    return;
  }

  const [
    attributesResult,
    relationshipsResult,
    childRelationshipsResult,
    countResult,
    whoAmI,
    state,
    status,
    subjectDetails,
    descriptionDetails,
    organizerDetails,
    requiredAttendeeDetails,
    optionalAttendeeDetails,
  ] = await Promise.all([
    get(
      token,
      "EntityDefinitions(LogicalName='wmkf_sitevisit')/Attributes?"
        + '$select=LogicalName,AttributeType,IsCustomAttribute,IsValidForRead,'
        + 'IsValidForCreate,IsValidForUpdate',
    ),
    get(
      token,
      "EntityDefinitions(LogicalName='wmkf_sitevisit')/ManyToOneRelationships?"
        + '$select=SchemaName,ReferencedEntity,ReferencingAttribute,'
        + 'ReferencingEntityNavigationPropertyName',
    ),
    get(
      token,
      "EntityDefinitions(LogicalName='wmkf_sitevisit')/OneToManyRelationships?"
        + '$select=SchemaName,ReferencingEntity,ReferencedEntity,'
        + 'ReferencedEntityNavigationPropertyName,ReferencingEntityNavigationPropertyName',
    ),
    get(token, `wmkf_sitevisits?$select=${siteVisit.PrimaryIdAttribute}&$count=true&$top=1`),
    get(token, 'WhoAmI'),
    activityOptions(token, 'statecode'),
    activityOptions(token, 'statuscode'),
    textAttributeDetails(token, 'subject'),
    textAttributeDetails(token, 'description', 'Memo'),
    partyListAttributeDetails(token, 'organizer'),
    partyListAttributeDetails(token, 'requiredattendees'),
    partyListAttributeDetails(token, 'optionalattendees'),
  ]);

  const userId = whoAmI.body?.UserId;
  const rolesResult = userId
    ? await get(token, `systemusers(${userId})/systemuserroles_association?$select=name`)
    : { status: null, body: { value: [] } };

  if (!attributesResult.ok || !relationshipsResult.ok || !childRelationshipsResult.ok
    || !countResult.ok || !whoAmI.ok) {
    throw new Error(
      `Capability read failed: attributes=${attributesResult.status}, relationships=${relationshipsResult.status}, `
      + `childRelationships=${childRelationshipsResult.status}, rows=${countResult.status}, `
      + `whoAmI=${whoAmI.status}.`,
    );
  }

  const attributes = (attributesResult.body.value || [])
    .filter((row) => row.IsCustomAttribute || IMPORTANT_ATTRIBUTES.has(row.LogicalName))
    .map((row) => ({
      logicalName: row.LogicalName,
      type: row.AttributeType,
      custom: row.IsCustomAttribute,
      readable: row.IsValidForRead,
      creatable: row.IsValidForCreate,
      updatable: row.IsValidForUpdate,
    }))
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));

  const requestRelationships = (relationshipsResult.body.value || [])
    .filter((row) => row.ReferencedEntity === 'akoya_request')
    .map((row) => ({
      schemaName: row.SchemaName,
      referencedEntity: row.ReferencedEntity,
      referencingAttribute: row.ReferencingAttribute,
      navigationProperty: row.ReferencingEntityNavigationPropertyName,
    }));
  const activityPartyRelationships = (childRelationshipsResult.body.value || [])
    .filter((row) => row.ReferencingEntity === 'activityparty')
    .map((row) => ({
      schemaName: row.SchemaName,
      referencingEntity: row.ReferencingEntity,
      referencedNavigationProperty: row.ReferencedEntityNavigationPropertyName,
      referencingNavigationProperty: row.ReferencingEntityNavigationPropertyName,
    }));

  console.log(JSON.stringify({
    target,
    resourceUrl,
    access: {
      whoAmIStatus: whoAmI.status,
      roleReadStatus: rolesResult.status,
      roleNames: (rolesResult.body?.value || []).map((row) => row.name).sort(),
    },
    siteVisit: {
      exists: true,
      entitySetName: siteVisit.EntitySetName,
      isActivity: siteVisit.IsActivity,
      primaryIdAttribute: siteVisit.PrimaryIdAttribute,
      primaryNameAttribute: siteVisit.PrimaryNameAttribute,
      rowReadStatus: countResult.status,
      rowCount: countResult.body['@odata.count'] ?? null,
      attributes,
      requestRelationships,
      activityPartyRelationships,
      standardAttributeDetails: {
        subject: subjectDetails,
        description: descriptionDetails,
        organizer: organizerDetails,
        requiredAttendees: requiredAttendeeDetails,
        optionalAttendees: optionalAttendeeDetails,
      },
      stateOptions: state,
      statusOptions: status,
    },
    requestDocument,
  }, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
