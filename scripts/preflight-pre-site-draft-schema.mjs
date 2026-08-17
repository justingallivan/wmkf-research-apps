#!/usr/bin/env node

/**
 * Read-only preflight for wave19-pre-site-draft.
 *
 * Classifies each declared attribute and relationship as absent, exact, or
 * divergent. The schema applier is creation-only, so divergent metadata blocks
 * deployment. This script never writes Dataverse data or metadata.
 *
 * Usage:
 *   node scripts/preflight-pre-site-draft-schema.mjs --target=prod
 *   node scripts/preflight-pre-site-draft-schema.mjs --target=sandbox
 *   node scripts/preflight-pre-site-draft-schema.mjs --self-test
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

const selfTest = process.argv.includes('--self-test');
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg?.slice('--target='.length) || null;
if (!selfTest && !['prod', 'sandbox'].includes(target)) {
  throw new Error('Pass --target=prod, --target=sandbox, or --self-test.');
}

const resourceUrl = target === 'prod'
  ? process.env.DYNAMICS_URL
  : target === 'sandbox'
    ? process.env.DYNAMICS_SANDBOX_URL
    : null;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!selfTest
    && (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET)) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const ROOT = 'lib/dataverse/schema/wave19-pre-site-draft';
const documentSpec = JSON.parse(readFileSync(resolve(
  process.cwd(),
  `${ROOT}/01_wmkf_requestdocument_pre_site_draft.json`,
), 'utf8'));
const requestSpec = JSON.parse(readFileSync(resolve(
  process.cwd(),
  `${ROOT}/02_akoya_request_writeup_pointers.json`,
), 'utf8'));
const CAST = {
  String: 'StringAttributeMetadata',
  Memo: 'MemoAttributeMetadata',
};

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

async function getJson(token, path) {
  const response = await fetch(`${resourceUrl}/api/data/v9.2${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (response.status === 404) return { status: 404, body: null };
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Unexpected response ${response.status} for ${path}: ${text.slice(0, 400)}`);
  }
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function result(state, notes = []) {
  return { state, notes };
}

function attributeSelect(attribute) {
  const common = ['LogicalName', 'AttributeType', 'RequiredLevel'];
  if (attribute.type === 'String') return [...common, 'MaxLength', 'FormatName'].join(',');
  if (attribute.type === 'Memo') return [...common, 'MaxLength', 'Format'].join(',');
  throw new Error(`Unsupported attribute type "${attribute.type}".`);
}

async function probeAttribute(token, entity, attribute) {
  const logicalName = attribute.schemaName.toLowerCase();
  const cast = CAST[attribute.type];
  if (!cast) throw new Error(`Unsupported attribute type "${attribute.type}".`);
  const response = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${logicalName}')/`
      + `Microsoft.Dynamics.CRM.${cast}?$select=${attributeSelect(attribute)}`,
  );
  if (response.status === 404) return result('absent');

  const notes = [];
  if (response.body?.AttributeType !== attribute.type) {
    notes.push(`AttributeType ${response.body?.AttributeType} != ${attribute.type}`);
  }
  const expectedRequired = attribute.requiredLevel || 'None';
  if (response.body?.RequiredLevel?.Value !== expectedRequired) {
    notes.push(`RequiredLevel ${response.body?.RequiredLevel?.Value} != ${expectedRequired}`);
  }
  if (response.body?.MaxLength !== attribute.maxLength) {
    notes.push(`MaxLength ${response.body?.MaxLength} != ${attribute.maxLength}`);
  }
  if (attribute.type === 'String') {
    const expectedFormat = attribute.format || 'Text';
    if (response.body?.FormatName?.Value !== expectedFormat) {
      notes.push(`FormatName ${response.body?.FormatName?.Value} != ${expectedFormat}`);
    }
  }
  if (attribute.type === 'Memo') {
    const expectedFormat = attribute.format || 'Text';
    if (response.body?.Format !== expectedFormat) {
      notes.push(`Format ${response.body?.Format} != ${expectedFormat}`);
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeRelationship(token, relationship, referencingEntity) {
  const response = await getJson(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')/`
      + 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?'
      + '$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencingAttribute,'
      + 'ReferencingEntityNavigationPropertyName',
  );
  if (response.status === 404) return result('absent');

  const notes = [];
  if (response.body?.ReferencedEntity !== relationship.referencedEntity) {
    notes.push(
      `ReferencedEntity ${response.body?.ReferencedEntity} != ${relationship.referencedEntity}`,
    );
  }
  if (response.body?.ReferencingEntity !== referencingEntity) {
    notes.push(`ReferencingEntity ${response.body?.ReferencingEntity} != ${referencingEntity}`);
  }
  const expectedAttribute = relationship.lookupSchemaName.toLowerCase();
  if (response.body?.ReferencingAttribute !== expectedAttribute) {
    notes.push(
      `ReferencingAttribute ${response.body?.ReferencingAttribute} != ${expectedAttribute}`,
    );
  }
  if (response.body?.ReferencingEntityNavigationPropertyName !== relationship.lookupSchemaName) {
    notes.push(
      'ReferencingEntityNavigationPropertyName '
        + `${response.body?.ReferencingEntityNavigationPropertyName} `
        + `!= ${relationship.lookupSchemaName}`,
    );
  }

  const lookup = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${referencingEntity}')/`
      + `Attributes(LogicalName='${expectedAttribute}')/`
      + 'Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,RequiredLevel',
  );
  if (lookup.status === 404) {
    notes.push(`Lookup attribute ${expectedAttribute} is absent`);
  } else {
    const expectedRequired = relationship.required || 'None';
    if (lookup.body?.RequiredLevel?.Value !== expectedRequired) {
      notes.push(
        `Lookup RequiredLevel ${lookup.body?.RequiredLevel?.Value} != ${expectedRequired}`,
      );
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

function validateSpecs() {
  if (documentSpec.kind !== 'extensions-on-existing'
      || documentSpec.entityLogicalName !== 'wmkf_requestdocument') {
    throw new Error('The document spec must extend wmkf_requestdocument.');
  }
  if (requestSpec.kind !== 'extensions-on-existing'
      || requestSpec.entityLogicalName !== 'akoya_request') {
    throw new Error('The request spec must extend akoya_request.');
  }
  if (documentSpec.attributes.length !== 12) {
    throw new Error(`Expected 12 request-document attributes; found ${documentSpec.attributes.length}.`);
  }
  const names = documentSpec.attributes.map((attribute) => attribute.schemaName.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Duplicate attribute schema name.');
  if (!documentSpec.attributes.every((attribute) => CAST[attribute.type])) {
    throw new Error('The preflight does not support one or more declared attribute types.');
  }
  const sectionFields = documentSpec.attributes.filter((attribute) => (
    attribute.type === 'Memo'
    && attribute.schemaName.startsWith('wmkf_PreSite')
    && !attribute.schemaName.endsWith('Json')
  ));
  if (sectionFields.length !== 8) {
    throw new Error(`Expected eight named proposal-core section fields; found ${sectionFields.length}.`);
  }
  if (requestSpec.relationships?.length !== 2) {
    throw new Error('Expected two request current-pointer relationships.');
  }
  const expectedPointers = new Map([
    ['wmkf_CurrentPreSiteVisit', 'wmkf_request_currentpresitevisit'],
    ['wmkf_CurrentFinalWriteup', 'wmkf_request_currentfinalwriteup'],
  ]);
  for (const relationship of requestSpec.relationships) {
    if (relationship.referencedEntity !== 'wmkf_requestdocument'
        || expectedPointers.get(relationship.lookupSchemaName) !== relationship.schemaName) {
      throw new Error(`Malformed writeup pointer relationship: ${relationship.schemaName}.`);
    }
    expectedPointers.delete(relationship.lookupSchemaName);
  }
  if (expectedPointers.size) throw new Error('One or more required writeup pointers are absent.');
}

function runSelfTest() {
  validateSpecs();
  const stringFields = new Set(attributeSelect({ type: 'String' }).split(','));
  const memoFields = new Set(attributeSelect({ type: 'Memo' }).split(','));
  if (!stringFields.has('FormatName') || stringFields.has('Format')) {
    throw new Error('String metadata projection is incorrect.');
  }
  if (!memoFields.has('Format') || memoFields.has('FormatName')) {
    throw new Error('Memo metadata projection is incorrect.');
  }
  console.log('PASS: wave19 spec shape and preflight metadata projections are valid.');
}

async function main() {
  validateSpecs();
  const token = await getToken();
  const checks = [];
  for (const attribute of documentSpec.attributes) {
    checks.push({
      name: `${documentSpec.entityLogicalName}.${attribute.schemaName.toLowerCase()}`,
      value: await probeAttribute(token, documentSpec.entityLogicalName, attribute),
    });
  }
  for (const relationship of requestSpec.relationships || []) {
    checks.push({
      name: `relationship:${relationship.schemaName}`,
      value: await probeRelationship(token, relationship, requestSpec.entityLogicalName),
    });
  }

  for (const check of checks) {
    console.log(`${check.value.state.toUpperCase().padEnd(10)} ${check.name}`);
    for (const note of check.value.notes) console.log(`           - ${note}`);
  }
  const divergent = checks.filter((check) => check.value.state === 'divergent');
  const absent = checks.filter((check) => check.value.state === 'absent');
  const exact = checks.length - absent.length - divergent.length;
  console.log(`Summary: ${absent.length} absent, ${divergent.length} divergent, ${exact} exact.`);
  if (divergent.length) {
    console.error('ABORT: creation-only schema apply cannot reconcile divergent live metadata.');
    process.exit(1);
  }
  console.log('READ-ONLY PREFLIGHT COMPLETE: no metadata changes were made.');
  if (absent.length > 0) {
    console.log(
      'CREATION-COMPATIBLE: after explicit approval, the apply command would be '
        + `node scripts/apply-dataverse-schema.js --target=${target} `
        + '--wave=19-pre-site-draft --execute',
    );
  } else {
    console.log('ALREADY EXACT: no schema apply is required for this target.');
  }
}

if (selfTest) runSelfTest();
else main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
