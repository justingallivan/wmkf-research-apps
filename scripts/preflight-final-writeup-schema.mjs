#!/usr/bin/env node

/**
 * Read-only preflight for wave22-final-writeup-transition.
 *
 * Classifies the two DateTime attributes and two systemuser relationships as
 * absent, exact, or divergent. The schema applier is creation-only, so any
 * divergent metadata blocks deployment. This script never writes Dataverse.
 *
 * Usage:
 *   node scripts/preflight-final-writeup-schema.mjs --target=prod
 *   node scripts/preflight-final-writeup-schema.mjs --target=sandbox
 *   node scripts/preflight-final-writeup-schema.mjs --self-test
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

const WAVE = '22-final-writeup-transition';
const SPEC_PATH = 'lib/dataverse/schema/wave22-final-writeup-transition/'
  + 'wmkf_requestdocument_final_writeup_transition.json';
const spec = JSON.parse(readFileSync(resolve(process.cwd(), SPEC_PATH), 'utf8'));

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

function validateSpec() {
  if (spec.kind !== 'extensions-on-existing'
      || spec.entityLogicalName !== 'wmkf_requestdocument') {
    throw new Error('The wave22 spec must extend wmkf_requestdocument.');
  }
  const attributes = new Map((spec.attributes || []).map((attribute) => [
    attribute.schemaName.toLowerCase(),
    attribute,
  ]));
  for (const name of ['wmkf_groupreviewstartedat', 'wmkf_leadershipreviewstartedat']) {
    const attribute = attributes.get(name);
    if (!attribute
      || attribute.type !== 'DateTime'
      || attribute.format !== 'DateAndTime'
      || attribute.behavior !== 'UserLocal') {
      throw new Error(`Unexpected Final Writeup DateTime shape: ${name}.`);
    }
    attributes.delete(name);
  }
  if (attributes.size) throw new Error('Unexpected attributes in the wave22 spec.');

  const relationships = new Map((spec.relationships || []).map((relationship) => [
    relationship.lookupSchemaName,
    relationship,
  ]));
  for (const name of ['wmkf_GroupReviewStartedBy', 'wmkf_LeadershipReviewStartedBy']) {
    const relationship = relationships.get(name);
    if (!relationship
      || relationship.kind !== 'N:1'
      || relationship.referencedEntity !== 'systemuser'
      || relationship.required !== 'None') {
      throw new Error(`Unexpected Final Writeup lookup shape: ${name}.`);
    }
    relationships.delete(name);
  }
  if (relationships.size) throw new Error('Unexpected relationships in the wave22 spec.');
}

async function probeAttribute(token, attribute, readMetadata = getJson) {
  const logicalName = attribute.schemaName.toLowerCase();
  const base = `/EntityDefinitions(LogicalName='${spec.entityLogicalName}')/`
    + `Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(token, `${base}?$select=LogicalName,AttributeType`);
  if (uncast.status === 404) return result('absent');
  if (uncast.body?.AttributeType !== 'DateTime') {
    return result('divergent', [`AttributeType ${uncast.body?.AttributeType} != DateTime`]);
  }
  const response = await readMetadata(
    token,
    `${base}/Microsoft.Dynamics.CRM.DateTimeAttributeMetadata?`
      + '$select=LogicalName,AttributeType,RequiredLevel,Format,DateTimeBehavior',
  );
  if (response.status === 404) {
    return result('divergent', ['DateTime typed metadata was unavailable for an existing field']);
  }
  const notes = [];
  if (response.body?.RequiredLevel?.Value !== (attribute.requiredLevel || 'None')) {
    notes.push(`RequiredLevel ${response.body?.RequiredLevel?.Value} != None`);
  }
  if (response.body?.Format !== attribute.format) {
    notes.push(`Format ${response.body?.Format} != ${attribute.format}`);
  }
  if (response.body?.DateTimeBehavior?.Value !== attribute.behavior) {
    notes.push(`DateTimeBehavior ${response.body?.DateTimeBehavior?.Value} != ${attribute.behavior}`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeRelationship(token, relationship, readMetadata = getJson) {
  const response = await readMetadata(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')/`
      + 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?'
      + '$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencingAttribute,'
      + 'ReferencingEntityNavigationPropertyName',
  );
  if (response.status === 404) return result('absent');
  const notes = [];
  const expectedAttribute = relationship.lookupSchemaName.toLowerCase();
  if (response.body?.ReferencedEntity !== relationship.referencedEntity) {
    notes.push(`ReferencedEntity ${response.body?.ReferencedEntity} != ${relationship.referencedEntity}`);
  }
  if (response.body?.ReferencingEntity !== spec.entityLogicalName) {
    notes.push(`ReferencingEntity ${response.body?.ReferencingEntity} != ${spec.entityLogicalName}`);
  }
  if (response.body?.ReferencingAttribute !== expectedAttribute) {
    notes.push(`ReferencingAttribute ${response.body?.ReferencingAttribute} != ${expectedAttribute}`);
  }
  if (response.body?.ReferencingEntityNavigationPropertyName !== relationship.lookupSchemaName) {
    notes.push(
      `NavigationProperty ${response.body?.ReferencingEntityNavigationPropertyName} `
        + `!= ${relationship.lookupSchemaName}`,
    );
  }
  const lookup = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${spec.entityLogicalName}')/`
      + `Attributes(LogicalName='${expectedAttribute}')/`
      + 'Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,RequiredLevel',
  );
  if (lookup.status === 404) {
    notes.push(`Lookup attribute ${expectedAttribute} is absent`);
  } else if (lookup.body?.RequiredLevel?.Value !== (relationship.required || 'None')) {
    notes.push(`Lookup RequiredLevel ${lookup.body?.RequiredLevel?.Value} != ${relationship.required}`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function runSelfTest() {
  validateSpec();
  const attribute = spec.attributes[0];
  const absent = await probeAttribute(null, attribute, async () => ({ status: 404, body: null }));
  if (absent.state !== 'absent') throw new Error('A missing DateTime must classify absent.');
  let reads = 0;
  const wrongType = await probeAttribute(null, attribute, async () => {
    reads += 1;
    return { status: 200, body: { AttributeType: 'String' } };
  });
  if (wrongType.state !== 'divergent' || reads !== 1) {
    throw new Error('A wrong-type attribute must classify divergent before the typed cast.');
  }
  const relationship = await probeRelationship(null, spec.relationships[0], async () => ({
    status: 404,
    body: null,
  }));
  if (relationship.state !== 'absent') throw new Error('A missing relationship must classify absent.');
  console.log('PASS: wave22 Final Writeup spec and metadata projections are valid.');
}

async function main() {
  validateSpec();
  const token = await getToken();
  const checks = [];
  for (const attribute of spec.attributes) {
    checks.push({
      name: `${spec.entityLogicalName}.${attribute.schemaName.toLowerCase()}`,
      value: await probeAttribute(token, attribute),
    });
  }
  for (const relationship of spec.relationships) {
    checks.push({
      name: `relationship:${relationship.schemaName}`,
      value: await probeRelationship(token, relationship),
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
  if (absent.length) {
    console.log(
      'CREATION-COMPATIBLE: after explicit approval, the apply command would be '
        + `node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE} --execute`,
    );
  } else {
    console.log('ALREADY EXACT: no schema apply is required for this target.');
  }
}

if (selfTest) runSelfTest().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
else main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
