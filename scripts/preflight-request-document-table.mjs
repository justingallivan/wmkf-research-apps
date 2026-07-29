#!/usr/bin/env node

/**
 * Read-only preflight for wave16-request-document-registry.
 *
 * Classifies every declared artifact as absent, exact, or divergent. The schema
 * applier is creation-only, so any divergent result blocks deployment.
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

const target = (process.argv.find((arg) => arg.startsWith('--target=')) || '--target=sandbox')
  .slice('--target='.length);
if (!['sandbox', 'prod'].includes(target)) throw new Error(`Unknown target "${target}".`);
const resourceUrl = target === 'sandbox'
  ? process.env.DYNAMICS_SANDBOX_URL
  : process.env.DYNAMICS_URL;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const spec = JSON.parse(readFileSync(resolve(
  process.cwd(),
  'lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json',
), 'utf8'));
const requestExtensionSpec = JSON.parse(readFileSync(resolve(
  process.cwd(),
  'lib/dataverse/schema/wave16-request-document-registry/'
    + 'zz_akoya_request_initial_assessment_pointer.json',
), 'utf8'));
const entity = spec.schemaName.toLowerCase();
const expectedEntitySet = 'wmkf_requestdocuments';
const CAST = {
  String: 'StringAttributeMetadata',
  Memo: 'MemoAttributeMetadata',
  Picklist: 'PicklistAttributeMetadata',
  Integer: 'IntegerAttributeMetadata',
  DateTime: 'DateTimeAttributeMetadata',
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
  if (!response.ok || !body.access_token) throw new Error(`Token request failed (${response.status}).`);
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

async function probeEntity(token) {
  const response = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${entity}')?$select=LogicalName,EntitySetName,OwnershipType,PrimaryNameAttribute`,
  );
  if (response.status === 404) return result('absent');
  const notes = [];
  if (response.body?.OwnershipType !== spec.ownershipType) {
    notes.push(`OwnershipType ${response.body?.OwnershipType} != ${spec.ownershipType}`);
  }
  if (response.body?.EntitySetName !== expectedEntitySet) {
    notes.push(`EntitySetName ${response.body?.EntitySetName} != ${expectedEntitySet}`);
  }
  if (response.body?.PrimaryNameAttribute !== spec.primaryNameAttribute.schemaName.toLowerCase()) {
    notes.push(`PrimaryNameAttribute ${response.body?.PrimaryNameAttribute} is unexpected`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeAttribute(token, attribute) {
  const logical = attribute.schemaName.toLowerCase();
  const cast = CAST[attribute.type];
  const select = attribute.type === 'Picklist'
    ? '$select=LogicalName,AttributeType,RequiredLevel&$expand=OptionSet'
    : '$select=LogicalName,AttributeType,RequiredLevel,MaxLength,Format,FormatName,'
      + 'MinValue,MaxValue,DateTimeBehavior,IsPrimaryName';
  const response = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${logical}')/Microsoft.Dynamics.CRM.${cast}?${select}`,
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
  if (attribute.maxLength != null && response.body?.MaxLength !== attribute.maxLength) {
    notes.push(`MaxLength ${response.body?.MaxLength} != ${attribute.maxLength}`);
  }
  if (attribute.type === 'Integer') {
    const expectedMin = attribute.minValue ?? -2147483648;
    const expectedMax = attribute.maxValue ?? 2147483647;
    if (response.body?.MinValue !== expectedMin) {
      notes.push(`MinValue ${response.body?.MinValue} != ${expectedMin}`);
    }
    if (response.body?.MaxValue !== expectedMax) {
      notes.push(`MaxValue ${response.body?.MaxValue} != ${expectedMax}`);
    }
  }
  if (attribute.type === 'String') {
    const expectedFormat = attribute.format || 'Text';
    if (response.body?.FormatName?.Value !== expectedFormat) {
      notes.push(`FormatName ${response.body?.FormatName?.Value} != ${expectedFormat}`);
    }
  }
  if (attribute.type === 'DateTime') {
    const expectedFormat = attribute.format || 'DateAndTime';
    const expectedBehavior = attribute.behavior || 'UserLocal';
    if (response.body?.Format !== expectedFormat) {
      notes.push(`Format ${response.body?.Format} != ${expectedFormat}`);
    }
    if (response.body?.DateTimeBehavior?.Value !== expectedBehavior) {
      notes.push(`DateTimeBehavior ${response.body?.DateTimeBehavior?.Value} != ${expectedBehavior}`);
    }
  }
  if (attribute.type === 'Memo') {
    const expectedFormat = attribute.format || 'Text';
    if (response.body?.Format !== expectedFormat) {
      notes.push(`Format ${response.body?.Format} != ${expectedFormat}`);
    }
  }
  if (attribute.isPrimaryName && response.body?.IsPrimaryName !== true) {
    notes.push(`IsPrimaryName ${response.body?.IsPrimaryName} != true`);
  }
  if (attribute.type === 'Picklist') {
    const expected = new Map(attribute.options.map((option) => [option.value, option.label]));
    const found = new Map((response.body?.OptionSet?.Options || []).map((option) => [
      option.Value,
      option.Label?.UserLocalizedLabel?.Label,
    ]));
    for (const [value, label] of expected) {
      if (found.get(value) !== label) notes.push(`Option ${value} != "${label}"`);
    }
    for (const value of found.keys()) {
      if (!expected.has(value)) notes.push(`Unexpected option ${value}`);
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeRelationship(token, relationship, referencingEntity = entity) {
  const response = await getJson(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?`
      + '$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencingAttribute,'
      + 'ReferencingEntityNavigationPropertyName',
  );
  if (response.status === 404) return result('absent');
  const notes = [];
  if (response.body?.ReferencedEntity !== relationship.referencedEntity) {
    notes.push(`ReferencedEntity ${response.body?.ReferencedEntity} != ${relationship.referencedEntity}`);
  }
  if (response.body?.ReferencingEntity !== referencingEntity) {
    notes.push(`ReferencingEntity ${response.body?.ReferencingEntity} != ${referencingEntity}`);
  }
  const expectedAttribute = relationship.lookupSchemaName.toLowerCase();
  if (response.body?.ReferencingAttribute !== expectedAttribute) {
    notes.push(`ReferencingAttribute ${response.body?.ReferencingAttribute} != ${expectedAttribute}`);
  }
  if (response.body?.ReferencingEntityNavigationPropertyName !== relationship.lookupSchemaName) {
    notes.push(
      `ReferencingEntityNavigationPropertyName `
      + `${response.body?.ReferencingEntityNavigationPropertyName} != ${relationship.lookupSchemaName}`,
    );
  }
  const lookupResponse = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${referencingEntity}')/Attributes(LogicalName='${expectedAttribute}')`
      + '/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,RequiredLevel',
  );
  if (lookupResponse.status === 404) {
    notes.push(`Lookup attribute ${expectedAttribute} is absent`);
  } else {
    const expectedRequired = relationship.required || 'None';
    if (lookupResponse.body?.RequiredLevel?.Value !== expectedRequired) {
      notes.push(
        `Lookup RequiredLevel ${lookupResponse.body?.RequiredLevel?.Value} != ${expectedRequired}`,
      );
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeKey(token, key) {
  const response = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${entity}')/Keys?`
      + '$select=SchemaName,KeyAttributes,EntityKeyIndexStatus',
  );
  if (response.status === 404) return result('absent');
  const found = (response.body?.value || []).find((candidate) => candidate.SchemaName === key.schemaName);
  if (!found) return result('absent');
  const actual = [...(found.KeyAttributes || [])].sort();
  const expected = [...key.keyAttributes].sort();
  const notes = [];
  if (actual.join('|') !== expected.join('|')) {
    notes.push(`KeyAttributes [${actual.join(', ')}] != [${expected.join(', ')}]`);
  }
  if (found.EntityKeyIndexStatus !== 'Active') {
    notes.push(`EntityKeyIndexStatus ${found.EntityKeyIndexStatus} != Active`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function main() {
  const token = await getToken();
  const checks = [{ name: entity, value: await probeEntity(token) }];
  checks.push({
    name: `${entity}.${spec.primaryNameAttribute.schemaName.toLowerCase()}`,
    value: await probeAttribute(token, {
      type: 'String',
      ...spec.primaryNameAttribute,
      isPrimaryName: true,
    }),
  });
  for (const attribute of spec.attributes) {
    checks.push({
      name: `${entity}.${attribute.schemaName.toLowerCase()}`,
      value: await probeAttribute(token, attribute),
    });
  }
  for (const relationship of spec.relationships) {
    checks.push({
      name: `relationship:${relationship.schemaName}`,
      value: await probeRelationship(token, relationship),
    });
  }
  for (const relationship of requestExtensionSpec.relationships || []) {
    checks.push({
      name: `relationship:${relationship.schemaName}`,
      value: await probeRelationship(
        token,
        relationship,
        requestExtensionSpec.entityLogicalName,
      ),
    });
  }
  for (const key of spec.alternateKeys) {
    checks.push({ name: `key:${key.schemaName}`, value: await probeKey(token, key) });
  }

  for (const check of checks) {
    console.log(`${check.value.state.toUpperCase().padEnd(10)} ${check.name}`);
    for (const note of check.value.notes) console.log(`           - ${note}`);
  }
  const divergent = checks.filter((check) => check.value.state === 'divergent');
  const absent = checks.filter((check) => check.value.state === 'absent');
  console.log(`Summary: ${absent.length} absent, ${divergent.length} divergent, ${checks.length - absent.length - divergent.length} exact.`);
  if (divergent.length) {
    console.error('ABORT: creation-only schema apply cannot reconcile divergent live metadata.');
    process.exit(1);
  }
  console.log(
    `PROCEED: node scripts/apply-dataverse-schema.js --target=${target} --wave=16-request-document-registry --execute`,
  );
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
