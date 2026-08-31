#!/usr/bin/env node

/**
 * Read-only preflight for Wave 23 Final Writeup review acknowledgements.
 *
 * The runtime must remain disabled until the entity, six attributes, two
 * relationships, and alternate key are exact and the key index is Active.
 * This script never writes Dataverse.
 *
 * Usage:
 *   node scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --target=prod
 *   node scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --target=sandbox
 *   node scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --self-test
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

const WAVE = '23-final-writeup-review-acknowledgement';
const SPEC_PATH = 'lib/dataverse/schema/'
  + `wave${WAVE}/wmkf_finalwriteupreviewacknowledgement.json`;
const spec = JSON.parse(readFileSync(resolve(process.cwd(), SPEC_PATH), 'utf8'));
const entityLogicalName = spec.schemaName.toLowerCase();
const primaryNameLogicalName = spec.primaryNameAttribute.schemaName.toLowerCase();

function result(state, notes = [], details = {}) {
  return { state, notes, ...details };
}

function sameSet(actual = [], expected = []) {
  const left = [...actual].map(String).sort();
  const right = [...expected].map(String).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateSpec() {
  if (spec.kind !== 'new-entity'
      || entityLogicalName !== 'wmkf_finalwriteupreviewacknowledgement'
      || spec.ownershipType !== 'OrganizationOwned') {
    throw new Error('Unexpected Wave 23 entity identity or ownership.');
  }
  if (primaryNameLogicalName !== 'wmkf_name'
      || spec.primaryNameAttribute.requiredLevel !== 'ApplicationRequired') {
    throw new Error('Unexpected Wave 23 primary-name contract.');
  }

  const expectedAttributes = new Map([
    ['wmkf_sharepointdriveid', ['String', 300]],
    ['wmkf_sharepointitemid', ['String', 300]],
    ['wmkf_publicationversionid', ['String', 300]],
    ['wmkf_acknowledgedetag', ['String', 300]],
    ['wmkf_sharepointlastmodified', ['DateTime', null]],
    ['wmkf_acknowledgedat', ['DateTime', null]],
  ]);
  for (const attribute of spec.attributes || []) {
    const logicalName = attribute.schemaName.toLowerCase();
    const expected = expectedAttributes.get(logicalName);
    if (!expected || attribute.type !== expected[0]
        || attribute.requiredLevel !== 'ApplicationRequired') {
      throw new Error(`Unexpected Wave 23 attribute contract: ${logicalName}.`);
    }
    if (attribute.type === 'String' && attribute.maxLength !== expected[1]) {
      throw new Error(`Unexpected Wave 23 String length: ${logicalName}.`);
    }
    if (attribute.type === 'DateTime'
        && (attribute.format !== 'DateAndTime' || attribute.behavior !== 'UserLocal')) {
      throw new Error(`Unexpected Wave 23 DateTime shape: ${logicalName}.`);
    }
    expectedAttributes.delete(logicalName);
  }
  if (expectedAttributes.size) throw new Error('Wave 23 attributes are incomplete.');

  const expectedRelationships = new Map([
    ['wmkf_FinalDocument', {
      referencedEntity: 'wmkf_requestdocument',
      schemaName: 'wmkf_finalwriteupreview_finaldocument',
    }],
    ['wmkf_Reviewer', {
      referencedEntity: 'systemuser',
      schemaName: 'wmkf_finalwriteupreview_reviewer',
    }],
  ]);
  for (const relationship of spec.relationships || []) {
    const expected = expectedRelationships.get(relationship.lookupSchemaName);
    if (relationship.kind !== 'N:1'
        || relationship.required !== 'ApplicationRequired'
        || expected?.referencedEntity !== relationship.referencedEntity
        || expected?.schemaName !== relationship.schemaName) {
      throw new Error(`Unexpected Wave 23 relationship: ${relationship.schemaName}.`);
    }
    expectedRelationships.delete(relationship.lookupSchemaName);
  }
  if (expectedRelationships.size) throw new Error('Wave 23 relationships are incomplete.');

  if ((spec.alternateKeys || []).length !== 1) {
    throw new Error('Wave 23 must define exactly one alternate key.');
  }
  const key = spec.alternateKeys[0];
  if (key.schemaName !== 'wmkf_finalwriteupreview_document_reviewer_key'
      || !sameSet(key.keyAttributes, ['wmkf_finaldocument', 'wmkf_reviewer'])) {
    throw new Error('Unexpected Wave 23 alternate-key contract.');
  }
}

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

async function probeEntity(token, readMetadata = getJson) {
  const response = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${entityLogicalName}')?`
      + '$select=LogicalName,EntitySetName,OwnershipType,PrimaryNameAttribute',
  );
  if (response.status === 404) return result('absent');
  const notes = [];
  if (response.body?.LogicalName !== entityLogicalName) {
    notes.push(`LogicalName ${response.body?.LogicalName} != ${entityLogicalName}`);
  }
  if (!response.body?.EntitySetName) notes.push('EntitySetName is missing');
  if (response.body?.OwnershipType !== spec.ownershipType) {
    notes.push(`OwnershipType ${response.body?.OwnershipType} != ${spec.ownershipType}`);
  }
  if (response.body?.PrimaryNameAttribute !== primaryNameLogicalName) {
    notes.push(`PrimaryNameAttribute ${response.body?.PrimaryNameAttribute} != ${primaryNameLogicalName}`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes, {
    entitySetName: response.body?.EntitySetName || null,
  });
}

async function probeAttribute(token, attribute, readMetadata = getJson) {
  const logicalName = attribute.schemaName.toLowerCase();
  const base = `/EntityDefinitions(LogicalName='${entityLogicalName}')/`
    + `Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(token, `${base}?$select=LogicalName,AttributeType`);
  if (uncast.status === 404) return result('absent');
  if (uncast.body?.AttributeType !== attribute.type) {
    return result('divergent', [`AttributeType ${uncast.body?.AttributeType} != ${attribute.type}`]);
  }
  const typedName = attribute.type === 'String'
    ? 'StringAttributeMetadata'
    : 'DateTimeAttributeMetadata';
  const select = attribute.type === 'String'
    ? 'LogicalName,RequiredLevel,MaxLength'
    : 'LogicalName,RequiredLevel,Format,DateTimeBehavior';
  const response = await readMetadata(
    token,
    `${base}/Microsoft.Dynamics.CRM.${typedName}?$select=${select}`,
  );
  if (response.status === 404) return result('divergent', ['Typed metadata is unavailable']);
  const notes = [];
  if (response.body?.RequiredLevel?.Value !== attribute.requiredLevel) {
    notes.push(`RequiredLevel ${response.body?.RequiredLevel?.Value} != ${attribute.requiredLevel}`);
  }
  if (attribute.type === 'String' && response.body?.MaxLength !== attribute.maxLength) {
    notes.push(`MaxLength ${response.body?.MaxLength} != ${attribute.maxLength}`);
  }
  if (attribute.type === 'DateTime') {
    if (response.body?.Format !== attribute.format) {
      notes.push(`Format ${response.body?.Format} != ${attribute.format}`);
    }
    if (response.body?.DateTimeBehavior?.Value !== attribute.behavior) {
      notes.push(`DateTimeBehavior ${response.body?.DateTimeBehavior?.Value} != ${attribute.behavior}`);
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeRelationship(token, relationship, readMetadata = getJson) {
  const uncast = await readMetadata(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')?`
      + '$select=SchemaName,RelationshipType',
  );
  if (uncast.status === 404) return result('absent');
  const response = await readMetadata(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')/`
      + 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?'
      + '$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencingAttribute,'
      + 'ReferencingEntityNavigationPropertyName,CascadeConfiguration',
  );
  if (response.status === 404) {
    return result('divergent', ['Relationship exists but is not one-to-many metadata']);
  }
  const expectedAttribute = relationship.lookupSchemaName.toLowerCase();
  const notes = [];
  if (response.body?.ReferencedEntity !== relationship.referencedEntity) {
    notes.push(`ReferencedEntity ${response.body?.ReferencedEntity} != ${relationship.referencedEntity}`);
  }
  if (response.body?.ReferencingEntity !== entityLogicalName) {
    notes.push(`ReferencingEntity ${response.body?.ReferencingEntity} != ${entityLogicalName}`);
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
  const expectedCascade = relationship.cascade || {
    Assign: 'NoCascade',
    Delete: 'Restrict',
    Merge: 'NoCascade',
    Reparent: 'NoCascade',
    Share: 'NoCascade',
    Unshare: 'NoCascade',
  };
  for (const [operation, expected] of Object.entries(expectedCascade)) {
    if (response.body?.CascadeConfiguration?.[operation] !== expected) {
      notes.push(
        `CascadeConfiguration.${operation} `
          + `${response.body?.CascadeConfiguration?.[operation]} != ${expected}`,
      );
    }
  }
  const lookup = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${entityLogicalName}')/`
      + `Attributes(LogicalName='${expectedAttribute}')/`
      + 'Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,RequiredLevel',
  );
  if (lookup.status === 404) notes.push(`Lookup attribute ${expectedAttribute} is absent`);
  else if (lookup.body?.RequiredLevel?.Value !== relationship.required) {
    notes.push(`Lookup RequiredLevel ${lookup.body?.RequiredLevel?.Value} != ${relationship.required}`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeKey(token, key, readMetadata = getJson) {
  const response = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${entityLogicalName}')/Keys?`
      + '$select=SchemaName,KeyAttributes,EntityKeyIndexStatus',
  );
  if (response.status === 404) return result('absent');
  const found = (response.body?.value || []).find((row) => row.SchemaName === key.schemaName);
  if (!found) return result('absent');
  const notes = [];
  if (!sameSet(found.KeyAttributes, key.keyAttributes)) {
    notes.push(`KeyAttributes ${JSON.stringify(found.KeyAttributes)} != ${JSON.stringify(key.keyAttributes)}`);
  }
  if (notes.length) return result('divergent', notes);
  if (['Pending', 'InProgress'].includes(found.EntityKeyIndexStatus)) {
    return result('pending', [`EntityKeyIndexStatus ${found.EntityKeyIndexStatus} != Active`]);
  }
  if (found.EntityKeyIndexStatus === 'Active') return result('exact');
  return result('divergent', [
    `EntityKeyIndexStatus ${found.EntityKeyIndexStatus || '(missing)'} is terminal or unknown`,
  ]);
}

async function runSelfTest() {
  validateSpec();
  const absent = await probeEntity(null, async () => ({ status: 404, body: null }));
  if (absent.state !== 'absent') throw new Error('Missing entity must classify absent.');
  const wrongOwnership = await probeEntity(null, async () => ({
    status: 200,
    body: {
      LogicalName: entityLogicalName,
      EntitySetName: `${entityLogicalName}s`,
      OwnershipType: 'UserOwned',
      PrimaryNameAttribute: primaryNameLogicalName,
    },
  }));
  if (wrongOwnership.state !== 'divergent') {
    throw new Error('Wrong entity ownership must classify divergent.');
  }

  const stringAttribute = spec.attributes.find((attribute) => attribute.type === 'String');
  let stringReads = 0;
  const wrongLength = await probeAttribute(null, stringAttribute, async () => {
    stringReads += 1;
    if (stringReads === 1) {
      return { status: 200, body: { AttributeType: 'String' } };
    }
    return {
      status: 200,
      body: {
        RequiredLevel: { Value: stringAttribute.requiredLevel },
        MaxLength: stringAttribute.maxLength - 1,
      },
    };
  });
  if (wrongLength.state !== 'divergent' || stringReads !== 2) {
    throw new Error('Wrong String MaxLength must classify divergent after the typed cast.');
  }

  const dateAttribute = spec.attributes.find((attribute) => attribute.type === 'DateTime');
  let dateReads = 0;
  const wrongBehavior = await probeAttribute(null, dateAttribute, async () => {
    dateReads += 1;
    if (dateReads === 1) {
      return { status: 200, body: { AttributeType: 'DateTime' } };
    }
    return {
      status: 200,
      body: {
        RequiredLevel: { Value: dateAttribute.requiredLevel },
        Format: dateAttribute.format,
        DateTimeBehavior: { Value: 'TimeZoneIndependent' },
      },
    };
  });
  if (wrongBehavior.state !== 'divergent' || dateReads !== 2) {
    throw new Error('Wrong DateTime behavior must classify divergent after the typed cast.');
  }

  const relationship = spec.relationships[0];
  let relationshipReads = 0;
  const wrongRelationship = await probeRelationship(null, relationship, async () => {
    relationshipReads += 1;
    if (relationshipReads === 1) {
      return { status: 200, body: { RelationshipType: 'OneToManyRelationship' } };
    }
    if (relationshipReads === 2) {
      return {
        status: 200,
        body: {
          ReferencedEntity: relationship.referencedEntity,
          ReferencingEntity: entityLogicalName,
          ReferencingAttribute: 'wmkf_wronglookup',
          ReferencingEntityNavigationPropertyName: relationship.lookupSchemaName,
          CascadeConfiguration: {
            Assign: 'NoCascade',
            Delete: 'Cascade',
            Merge: 'NoCascade',
            Reparent: 'NoCascade',
            Share: 'NoCascade',
            Unshare: 'NoCascade',
          },
        },
      };
    }
    return {
      status: 200,
      body: { RequiredLevel: { Value: relationship.required } },
    };
  });
  if (wrongRelationship.state !== 'divergent' || relationshipReads !== 3) {
    throw new Error('Wrong relationship attribute/cascade must classify divergent.');
  }

  let wrongTypeReads = 0;
  const wrongRelationshipType = await probeRelationship(null, relationship, async () => {
    wrongTypeReads += 1;
    return wrongTypeReads === 1
      ? { status: 200, body: { RelationshipType: 'ManyToManyRelationship' } }
      : { status: 404, body: null };
  });
  if (wrongRelationshipType.state !== 'divergent' || wrongTypeReads !== 2) {
    throw new Error('Existing wrong-type relationship must classify divergent.');
  }

  const wrongKeyAttributes = await probeKey(null, spec.alternateKeys[0], async () => ({
    status: 200,
    body: { value: [{
      SchemaName: spec.alternateKeys[0].schemaName,
      KeyAttributes: ['wmkf_finaldocument'],
      EntityKeyIndexStatus: 'Active',
    }] },
  }));
  if (wrongKeyAttributes.state !== 'divergent') {
    throw new Error('Wrong key attributes must classify divergent.');
  }
  const pendingKey = await probeKey(null, spec.alternateKeys[0], async () => ({
    status: 200,
    body: { value: [{
      SchemaName: spec.alternateKeys[0].schemaName,
      KeyAttributes: spec.alternateKeys[0].keyAttributes,
      EntityKeyIndexStatus: 'Pending',
    }] },
  }));
  if (pendingKey.state !== 'pending') throw new Error('Pending key must block readiness.');
  const failedKey = await probeKey(null, spec.alternateKeys[0], async () => ({
    status: 200,
    body: { value: [{
      SchemaName: spec.alternateKeys[0].schemaName,
      KeyAttributes: spec.alternateKeys[0].keyAttributes,
      EntityKeyIndexStatus: 'Failed',
    }] },
  }));
  if (failedKey.state !== 'divergent') {
    throw new Error('Failed key index must classify terminally divergent.');
  }
  console.log('PASS: Wave 23 acknowledgement spec and metadata classifiers are valid.');
}

async function main() {
  validateSpec();
  const token = await getToken();
  const checks = [{ name: `entity:${entityLogicalName}`, value: await probeEntity(token) }];
  const entityAbsent = checks[0].value.state === 'absent';
  const primary = {
    type: 'String',
    schemaName: spec.primaryNameAttribute.schemaName,
    maxLength: spec.primaryNameAttribute.maxLength,
    requiredLevel: spec.primaryNameAttribute.requiredLevel,
  };
  for (const attribute of [primary, ...spec.attributes]) {
    checks.push({
      name: `${entityLogicalName}.${attribute.schemaName.toLowerCase()}`,
      value: entityAbsent ? result('absent') : await probeAttribute(token, attribute),
    });
  }
  for (const relationship of spec.relationships) {
    checks.push({
      name: `relationship:${relationship.schemaName}`,
      value: entityAbsent ? result('absent') : await probeRelationship(token, relationship),
    });
  }
  checks.push({
    name: `key:${spec.alternateKeys[0].schemaName}`,
    value: entityAbsent ? result('absent') : await probeKey(token, spec.alternateKeys[0]),
  });

  for (const check of checks) {
    console.log(`${check.value.state.toUpperCase().padEnd(10)} ${check.name}`);
    for (const note of check.value.notes) console.log(`           - ${note}`);
  }
  if (checks[0].value.entitySetName) {
    console.log(`Entity set: ${checks[0].value.entitySetName}`);
  }
  const counts = Object.fromEntries(
    ['absent', 'divergent', 'pending', 'exact'].map((state) => [
      state,
      checks.filter((check) => check.value.state === state).length,
    ]),
  );
  console.log(
    `Summary: ${counts.absent} absent, ${counts.divergent} divergent, `
      + `${counts.pending} pending, ${counts.exact} exact.`,
  );
  if (counts.divergent) {
    console.error('ABORT: creation-only schema apply cannot reconcile divergent live metadata.');
    process.exit(1);
  }
  console.log('READ-ONLY PREFLIGHT COMPLETE: no metadata changes were made.');
  if (counts.pending) {
    console.log('NOT READY: wait for the alternate-key index to become Active; do not enable runtime.');
    process.exit(2);
  }
  if (counts.absent) {
    console.log(
      'CREATION-COMPATIBLE: validate again with the non-writing dry-run: '
        + `node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE}`,
    );
    console.log(
      'PRODUCTION APPLY REQUIRES EXPLICIT APPROVAL: '
        + `node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE} --execute`,
    );
  } else {
    console.log('ALREADY EXACT AND ACTIVE: acknowledgement runtime may be enabled for this target.');
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
