#!/usr/bin/env node

/**
 * Read-only ABSENT / EXACT / DIVERGENT metadata preflight for the additive
 * reviewer identity-binding wave.
 *
 * The schema apply engine creates missing attributes but does not reconcile an
 * existing divergent definition. This probe derives its expected contract
 * directly from the two Wave 13 JSON specs, checks every field, and exits:
 *
 *   0  every field is ABSENT and/or EXACT
 *   1  at least one field is DIVERGENT
 *   2  usage, credentials, authentication, network, or unexpected response
 *
 * Usage:
 *   node scripts/preflight-reviewer-identity-binding-fields.mjs --target=sandbox
 *   node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod
 *   node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod --include-population
 *   node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod --include-timestamp-samples
 *   node scripts/preflight-reviewer-identity-binding-fields.mjs --self-test
 *
 * This script never writes to Dataverse.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const WAVE_FILES = [
  '../lib/dataverse/schema/wave13-reviewer-identity-binding/01_wmkf_potentialreviewers_identity_binding.json',
  '../lib/dataverse/schema/wave13-reviewer-identity-binding/02_wmkf_appreviewersuggestion_identity_coi.json',
];

const TYPE_CAST = Object.freeze({
  String: 'StringAttributeMetadata',
  Memo: 'MemoAttributeMetadata',
  Integer: 'IntegerAttributeMetadata',
  DateTime: 'DateTimeAttributeMetadata',
});
const ENTITY_SETS = Object.freeze({
  wmkf_potentialreviewers: 'wmkf_potentialreviewerses',
  wmkf_appreviewersuggestion: 'wmkf_appreviewersuggestions',
});

export function loadExpectedEntities() {
  return WAVE_FILES.map((relativePath) => {
    const spec = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
    return {
      entity: spec.entityLogicalName,
      fields: spec.attributes.map((attribute) => ({
        ...attribute,
        logical: attribute.schemaName.toLowerCase(),
        attributeType: attribute.type,
        cast: TYPE_CAST[attribute.type],
      })),
    };
  });
}

function expectedRequiredLevel(field) {
  return field.requiredLevel || 'None';
}

function actualValue(value) {
  return value && typeof value === 'object' && 'Value' in value ? value.Value : value;
}

export function compareFieldMetadata(field, data) {
  const notes = [];
  if (data.AttributeType !== field.attributeType) {
    notes.push(`type '${data.AttributeType}' != expected '${field.attributeType}'`);
    return notes;
  }

  const required = actualValue(data.RequiredLevel);
  if (required !== expectedRequiredLevel(field)) {
    notes.push(`RequiredLevel '${required}' != expected '${expectedRequiredLevel(field)}'`);
  }

  if (field.attributeType === 'String') {
    if (data.MaxLength !== field.maxLength) notes.push(`MaxLength ${data.MaxLength} != expected ${field.maxLength}`);
    const format = actualValue(data.FormatName);
    const expectedFormat = field.format || 'Text';
    if (format !== expectedFormat) notes.push(`FormatName '${format}' != expected '${expectedFormat}'`);
  } else if (field.attributeType === 'Memo') {
    if (data.MaxLength !== field.maxLength) notes.push(`MaxLength ${data.MaxLength} != expected ${field.maxLength}`);
    const format = actualValue(data.Format);
    const expectedFormat = field.format || 'Text';
    if (format !== expectedFormat) notes.push(`Format '${format}' != expected '${expectedFormat}'`);
  } else if (field.attributeType === 'Integer') {
    if (data.MinValue !== field.minValue) notes.push(`MinValue ${data.MinValue} != expected ${field.minValue}`);
    if (data.MaxValue !== field.maxValue) notes.push(`MaxValue ${data.MaxValue} != expected ${field.maxValue}`);
  } else if (field.attributeType === 'DateTime') {
    const expectedFormat = field.format || 'DateAndTime';
    const expectedBehavior = field.behavior || 'UserLocal';
    if (data.Format !== expectedFormat) notes.push(`Format '${data.Format}' != expected '${expectedFormat}'`);
    const behavior = actualValue(data.DateTimeBehavior);
    if (behavior !== expectedBehavior) notes.push(`DateTimeBehavior '${behavior}' != expected '${expectedBehavior}'`);
  }
  return notes;
}

export function classifyCollectionRows(field, rows) {
  if (!Array.isArray(rows)) throw new Error('metadata collection response is missing value[]');
  if (rows.length === 0) return { state: 'absent', notes: [] };
  if (rows.length > 1) throw new Error(`metadata collection returned ${rows.length} rows for ${field.logical}`);
  if (rows[0].AttributeType !== field.attributeType) {
    return {
      state: 'divergent',
      notes: [`type '${rows[0].AttributeType}' != expected '${field.attributeType}'`],
    };
  }
  return { state: 'present', notes: [] };
}

export function buildAnyNonNullFilter(fields) {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('population probe requires fields');
  return fields.map((field) => `${field.logical} ne null`).join(' or ');
}

function typedSelect(type) {
  const common = 'LogicalName,AttributeType,RequiredLevel';
  if (type === 'String') return `${common},MaxLength,FormatName`;
  if (type === 'Memo') return `${common},MaxLength,Format`;
  if (type === 'Integer') return `${common},MinValue,MaxValue`;
  if (type === 'DateTime') return `${common},Format,DateTimeBehavior`;
  throw new Error(`unsupported Wave 13 attribute type '${type}'`);
}

async function probeField({ resourceUrl, token, entity, field }) {
  const base =
    `${resourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')` +
    `/Attributes(LogicalName='${field.logical}')`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  // Dataverse can 404 the direct untyped Attributes(LogicalName='x') endpoint
  // for non-String subtypes. Use the collection-filter pattern from
  // schema-apply.attributeExists so Integer/DateTime fields cannot be mistaken
  // for absent after deployment.
  const collectionUrl =
    `${resourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')/Attributes` +
    `?$filter=LogicalName eq '${field.logical}'&$select=LogicalName,AttributeType`;
  const collectionResponse = await fetch(collectionUrl, { headers });
  if (!collectionResponse.ok) {
    throw new Error(`unexpected response probing ${entity}.${field.logical} (${collectionResponse.status}): ${(await collectionResponse.text()).slice(0, 400)}`);
  }
  const collectionData = await collectionResponse.json();
  const existence = classifyCollectionRows(field, collectionData.value);
  if (existence.state !== 'present') return existence;

  const typedUrl =
    `${base}/Microsoft.Dynamics.CRM.${field.cast}` +
    `?$select=${typedSelect(field.attributeType)}`;
  const typedResponse = await fetch(typedUrl, { headers });
  if (!typedResponse.ok) {
    throw new Error(`unexpected typed-metadata response probing ${entity}.${field.logical} (${typedResponse.status}): ${(await typedResponse.text()).slice(0, 400)}`);
  }
  const notes = compareFieldMetadata(field, await typedResponse.json());
  return { state: notes.length === 0 ? 'exact' : 'divergent', notes };
}

async function countRowsWithAnyIdentityField({ resourceUrl, token, entity, fields }) {
  const filter = buildAnyNonNullFilter(fields);
  const entitySet = ENTITY_SETS[entity];
  if (!entitySet) throw new Error(`population probe has no entity-set mapping for ${entity}`);
  const url =
    `${resourceUrl}/api/data/v9.2/${entitySet}`
    + `?$filter=${encodeURIComponent(filter)}&$count=true&$top=1&$select=${fields[0].logical}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`unexpected population response probing ${entity} (${response.status}): ${(await response.text()).slice(0, 400)}`);
  }
  const data = await response.json();
  if (!Number.isInteger(data['@odata.count']) || data['@odata.count'] < 0) {
    throw new Error(`population response for ${entity} is missing @odata.count`);
  }
  return data['@odata.count'];
}

async function samplePersistedResolvedTimestamps({ resourceUrl, token }) {
  const field = 'wmkf_identityresolvedat';
  const url =
    `${resourceUrl}/api/data/v9.2/wmkf_potentialreviewerses`
    + `?$select=${field}&$filter=${field}%20ne%20null&$top=5`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`unexpected timestamp-sample response (${response.status}): ${(await response.text()).slice(0, 400)}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.value)) throw new Error('timestamp-sample response is missing value[]');
  return data.value.map((row) => row[field]).filter((value) => typeof value === 'string');
}

function loadEnvironment() {
  for (const envFile of ['.env', '.env.local']) {
    try {
      const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator === -1) continue;
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {}
  }
}

async function getToken({ resourceUrl, tenantId, clientId, clientSecret }) {
  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: `${resourceUrl}/.default`,
      }).toString(),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`failed to acquire Dynamics token (${response.status})`);
  }
  return body.access_token;
}

function runSelfTest() {
  const entities = loadExpectedEntities();
  const fields = entities.flatMap((entry) => entry.fields);
  if (entities.length !== 2 || fields.length !== 10) throw new Error('expected two entities and ten fields');
  for (const field of fields) {
    if (!field.cast) throw new Error(`unsupported field type for ${field.logical}`);
  }

  const stringField = fields.find((field) => field.attributeType === 'String');
  const exact = compareFieldMetadata(stringField, {
    AttributeType: 'String',
    RequiredLevel: { Value: 'None' },
    MaxLength: stringField.maxLength,
    FormatName: { Value: stringField.format || 'Text' },
  });
  if (exact.length !== 0) throw new Error(`exact fixture diverged: ${exact.join('; ')}`);

  const divergent = compareFieldMetadata(stringField, {
    AttributeType: 'String',
    RequiredLevel: { Value: 'None' },
    MaxLength: stringField.maxLength + 1,
    FormatName: { Value: stringField.format || 'Text' },
  });
  if (!divergent.some((note) => note.startsWith('MaxLength'))) {
    throw new Error('divergent fixture did not detect MaxLength mismatch');
  }

  for (const type of ['Integer', 'DateTime']) {
    const field = fields.find((candidate) => candidate.attributeType === type);
    const existing = classifyCollectionRows(field, [
      { LogicalName: field.logical, AttributeType: field.attributeType },
    ]);
    if (existing.state !== 'present') {
      throw new Error(`existing ${type} fixture was misclassified as ${existing.state}`);
    }
  }
  const absent = classifyCollectionRows(stringField, []);
  if (absent.state !== 'absent') throw new Error('empty metadata collection was not classified absent');
  const expectedFilter = fields.map((field) => `${field.logical} ne null`).join(' or ');
  if (buildAnyNonNullFilter(fields) !== expectedFilter) throw new Error('population filter is incomplete');

  console.log('PASS: Wave 13 preflight self-test (2 entities, 10 fields, metadata comparison and complete population filter).');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const targetArg = process.argv.slice(2).find((arg) => arg.startsWith('--target='));
  const target = (targetArg || '--target=prod').slice('--target='.length);
  if (!['sandbox', 'prod'].includes(target)) {
    throw new Error("--target must be 'sandbox' or 'prod'");
  }

  loadEnvironment();
  const resourceUrl = target === 'sandbox' ? process.env.DYNAMICS_SANDBOX_URL : process.env.DYNAMICS_URL;
  const tenantId = process.env.DYNAMICS_TENANT_ID;
  const clientId = process.env.DYNAMICS_CLIENT_ID;
  const clientSecret = process.env.DYNAMICS_CLIENT_SECRET;
  if (!resourceUrl || !tenantId || !clientId || !clientSecret) {
    throw new Error(`missing Dynamics credentials for target=${target}`);
  }

  const token = await getToken({ resourceUrl, tenantId, clientId, clientSecret });
  const results = [];
  for (const { entity, fields } of loadExpectedEntities()) {
    for (const field of fields) {
      const result = await probeField({ resourceUrl, token, entity, field });
      results.push({ entity, field, result });
    }
  }

  const absent = results.filter(({ result }) => result.state === 'absent');
  const exact = results.filter(({ result }) => result.state === 'exact');
  const divergent = results.filter(({ result }) => result.state === 'divergent');

  console.log(`Reviewer identity-binding Wave 13 preflight (target=${target}):`);
  for (const { entity, field, result } of results) {
    console.log(`  ${result.state.toUpperCase().padEnd(9)} ${entity}.${field.logical}`);
    for (const note of result.notes) console.log(`            - ${note}`);
  }
  console.log(`Summary: ${absent.length} absent, ${exact.length} exact, ${divergent.length} divergent.`);

  if (divergent.length > 0) {
    console.error('ABORT: schema-apply is creation-only and cannot reconcile divergent fields.');
    process.exitCode = 1;
    return;
  }
  console.log('PROCEED: every field is absent or matches the Wave 13 contract exactly.');
  if (absent.length > 0) {
    console.log(`  Next: node scripts/apply-dataverse-schema.js --target=${target} --wave=13-reviewer-identity-binding --execute`);
  }
  if (process.argv.includes('--include-population')) {
    if (absent.length > 0) {
      console.log('Population snapshot skipped: one or more Wave 13 fields are absent.');
    } else {
      console.log(`Wave 13 population snapshot (target=${target}):`);
      for (const expected of loadExpectedEntities()) {
        const count = await countRowsWithAnyIdentityField({
          resourceUrl,
          token,
          entity: expected.entity,
          fields: expected.fields,
        });
        console.log(`  ${expected.entity}: ${count} row(s) with any Wave 13 field non-null.`);
      }
    }
  }
  if (process.argv.includes('--include-timestamp-samples')) {
    const timestamps = await samplePersistedResolvedTimestamps({ resourceUrl, token });
    console.log('Persisted wmkf_identityresolvedat samples (raw Dataverse JSON):');
    if (timestamps.length === 0) console.log('  none');
    else for (const timestamp of timestamps) console.log(`  ${timestamp}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error('ERROR:', error?.message || error);
    process.exitCode = 2;
  });
}
