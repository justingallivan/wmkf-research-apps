#!/usr/bin/env node

/**
 * Read-only preflight for Wave 28 Meeting Tracker schema.
 *
 * Classifies both new entities, their declared fields and relationships, and
 * the deliberate absence of alternate keys as absent, exact, or divergent.
 * This script never writes Dataverse.
 *
 * Usage:
 *   node scripts/preflight-meeting-tracker-schema.mjs --target=sandbox
 *   node scripts/preflight-meeting-tracker-schema.mjs --target=prod
 *   node scripts/preflight-meeting-tracker-schema.mjs --self-test
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';

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
if (!selfTest && !['sandbox', 'prod'].includes(target)) {
  throw new Error('Pass --target=sandbox, --target=prod, or --self-test.');
}

const sandboxUrl = process.env.DYNAMICS_SANDBOX_URL
  || (SANDBOX_HOSTS[0] ? `https://${SANDBOX_HOSTS[0]}` : null);
const resourceUrl = target === 'sandbox'
  ? sandboxUrl
  : target === 'prod'
    ? process.env.DYNAMICS_URL
    : null;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!selfTest
    && (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET)) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const WAVE = '28-meeting-tracker';
const SPEC_DIR = `lib/dataverse/schema/wave${WAVE}`;
const specs = [
  'wmkf_deliberationsession.json',
  'wmkf_deliberationslot.json',
].map((filename) => JSON.parse(readFileSync(resolve(process.cwd(), SPEC_DIR, filename), 'utf8')));

const CAST = Object.freeze({
  String: 'StringAttributeMetadata',
  Memo: 'MemoAttributeMetadata',
  Integer: 'IntegerAttributeMetadata',
  DateTime: 'DateTimeAttributeMetadata',
  Picklist: 'PicklistAttributeMetadata',
});
const DEFAULT_CASCADE = Object.freeze({
  Assign: 'NoCascade',
  Delete: 'Restrict',
  Merge: 'NoCascade',
  Reparent: 'NoCascade',
  Share: 'NoCascade',
  Unshare: 'NoCascade',
});

function result(state, notes = [], details = {}) {
  return { state, notes, ...details };
}

function sameOptions(left = [], right = []) {
  const normalize = (options) => options
    .map((option) => [option.value, option.label])
    .sort(([a], [b]) => a - b);
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function requiredLevel(value) {
  return value || 'None';
}

function validateAttribute(attribute, expected) {
  if (!attribute || attribute.type !== expected.type
      || requiredLevel(attribute.requiredLevel) !== requiredLevel(expected.requiredLevel)) {
    return false;
  }
  for (const key of ['maxLength', 'minValue', 'maxValue', 'format', 'behavior', 'defaultValue']) {
    if ((attribute[key] ?? null) !== (expected[key] ?? null)) return false;
  }
  if (expected.options && !sameOptions(attribute.options, expected.options)) return false;
  return true;
}

function validateEntitySpec(spec, expected) {
  const logicalName = spec.schemaName?.toLowerCase();
  if (spec.kind !== 'new-entity'
      || logicalName !== expected.logicalName
      || spec.ownershipType !== 'OrganizationOwned'
      || spec.primaryNameAttribute?.schemaName !== 'wmkf_Name'
      || spec.primaryNameAttribute?.maxLength !== 200
      || spec.primaryNameAttribute?.requiredLevel !== 'ApplicationRequired') {
    throw new Error(`Unexpected Wave 28 entity identity: ${spec.name || '(missing)'}.`);
  }
  const attributes = new Map((spec.attributes || []).map((attribute) => [
    attribute.schemaName.toLowerCase(),
    attribute,
  ]));
  for (const [name, shape] of Object.entries(expected.attributes)) {
    if (!validateAttribute(attributes.get(name), shape)) {
      throw new Error(`Unexpected Wave 28 attribute contract: ${logicalName}.${name}.`);
    }
    attributes.delete(name);
  }
  if (attributes.size) throw new Error(`Unexpected attributes on ${logicalName}.`);

  const relationships = new Map((spec.relationships || []).map((relationship) => [
    relationship.lookupSchemaName,
    relationship,
  ]));
  for (const [lookup, shape] of Object.entries(expected.relationships)) {
    const relationship = relationships.get(lookup);
    if (!relationship
        || relationship.kind !== 'N:1'
        || relationship.schemaName !== shape.schemaName
        || relationship.referencedEntity !== shape.referencedEntity
        || requiredLevel(relationship.required) !== requiredLevel(shape.required)) {
      throw new Error(`Unexpected Wave 28 relationship contract: ${logicalName}.${lookup}.`);
    }
    relationships.delete(lookup);
  }
  if (relationships.size) throw new Error(`Unexpected relationships on ${logicalName}.`);
  if ((spec.alternateKeys || []).length !== 0) {
    throw new Error(`${logicalName} must not declare alternate keys.`);
  }
}

function validateSpecs() {
  const byName = new Map(specs.map((spec) => [spec.schemaName.toLowerCase(), spec]));
  validateEntitySpec(byName.get('wmkf_deliberationsession'), {
    logicalName: 'wmkf_deliberationsession',
    attributes: {
      wmkf_scheduledstart: {
        type: 'DateTime', format: 'DateAndTime', behavior: 'UserLocal', requiredLevel: 'ApplicationRequired',
      },
      wmkf_scheduledend: {
        type: 'DateTime', format: 'DateAndTime', behavior: 'UserLocal', requiredLevel: 'ApplicationRequired',
      },
      wmkf_ianatimezone: { type: 'String', maxLength: 100, requiredLevel: 'ApplicationRequired' },
      wmkf_location: { type: 'String', maxLength: 2000 },
      wmkf_meetinglink: { type: 'String', maxLength: 1000, format: 'Url' },
      wmkf_attendeerefsjson: { type: 'Memo', maxLength: 32000 },
      wmkf_notes: { type: 'Memo', maxLength: 10000 },
      wmkf_status: {
        type: 'Picklist',
        requiredLevel: 'ApplicationRequired',
        defaultValue: 100000000,
        options: [
          { value: 100000000, label: 'Planned' },
          { value: 100000001, label: 'Held' },
          { value: 100000002, label: 'Cancelled' },
        ],
      },
    },
    relationships: {
      wmkf_UpdatedBy: {
        schemaName: 'wmkf_deliberationsession_updatedby',
        referencedEntity: 'systemuser',
        required: 'ApplicationRequired',
      },
    },
  });
  validateEntitySpec(byName.get('wmkf_deliberationslot'), {
    logicalName: 'wmkf_deliberationslot',
    attributes: {
      wmkf_order: {
        type: 'Integer', minValue: 1, maxValue: 1000, requiredLevel: 'ApplicationRequired',
      },
      wmkf_minutes: {
        type: 'Integer', minValue: 1, maxValue: 1440, requiredLevel: 'ApplicationRequired',
      },
      wmkf_notes: { type: 'Memo', maxLength: 10000 },
    },
    relationships: {
      wmkf_Session: {
        schemaName: 'wmkf_deliberationslot_session',
        referencedEntity: 'wmkf_deliberationsession',
        required: 'ApplicationRequired',
      },
      wmkf_Request: {
        schemaName: 'wmkf_deliberationslot_request',
        referencedEntity: 'akoya_request',
        required: 'ApplicationRequired',
      },
      wmkf_LeadPd: {
        schemaName: 'wmkf_deliberationslot_leadpd',
        referencedEntity: 'systemuser',
        required: 'None',
      },
      wmkf_UpdatedBy: {
        schemaName: 'wmkf_deliberationslot_updatedby',
        referencedEntity: 'systemuser',
        required: 'ApplicationRequired',
      },
    },
  });
  if (byName.size !== 2) throw new Error('Wave 28 must contain exactly two entity specs.');
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

async function probeEntity(token, spec, readMetadata = getJson) {
  const logicalName = spec.schemaName.toLowerCase();
  const response = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${logicalName}')?`
      + '$select=LogicalName,EntitySetName,OwnershipType,PrimaryNameAttribute',
  );
  if (response.status === 404) return result('absent');
  const notes = [];
  const expectedEntitySet = `${logicalName}s`;
  if (response.body?.LogicalName !== logicalName) {
    notes.push(`LogicalName ${response.body?.LogicalName} != ${logicalName}`);
  }
  if (response.body?.EntitySetName !== expectedEntitySet) {
    notes.push(`EntitySetName ${response.body?.EntitySetName} != ${expectedEntitySet}`);
  }
  if (response.body?.OwnershipType !== spec.ownershipType) {
    notes.push(`OwnershipType ${response.body?.OwnershipType} != ${spec.ownershipType}`);
  }
  if (response.body?.PrimaryNameAttribute !== spec.primaryNameAttribute.schemaName.toLowerCase()) {
    notes.push(`PrimaryNameAttribute ${response.body?.PrimaryNameAttribute} is unexpected`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

function attributeSelect(attribute) {
  const common = ['LogicalName', 'AttributeType', 'RequiredLevel'];
  if (attribute.type === 'String') return [...common, 'MaxLength', 'FormatName', 'IsPrimaryName'];
  if (attribute.type === 'Memo') return [...common, 'MaxLength', 'Format'];
  if (attribute.type === 'Integer') return [...common, 'MinValue', 'MaxValue'];
  if (attribute.type === 'DateTime') return [...common, 'Format', 'DateTimeBehavior'];
  if (attribute.type === 'Picklist') return [...common, 'DefaultFormValue'];
  throw new Error(`Unsupported attribute type ${attribute.type}.`);
}

async function probeAttribute(token, spec, attribute, readMetadata = getJson) {
  const entity = spec.schemaName.toLowerCase();
  const logicalName = attribute.schemaName.toLowerCase();
  const cast = CAST[attribute.type];
  const base = `/EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(
    token,
    `${base}?$select=LogicalName,AttributeType`,
  );
  if (uncast.status === 404) return result('absent');
  if (uncast.body?.AttributeType !== attribute.type) {
    return result('divergent', [
      `AttributeType ${uncast.body?.AttributeType} != ${attribute.type}`,
    ]);
  }
  const expand = attribute.type === 'Picklist' ? '&$expand=OptionSet' : '';
  const response = await readMetadata(
    token,
    `${base}/`
      + `Microsoft.Dynamics.CRM.${cast}?$select=${attributeSelect(attribute).join(',')}${expand}`,
  );
  if (response.status === 404) {
    return result('divergent', ['Attribute exists but typed metadata is unavailable']);
  }
  const body = response.body || {};
  const notes = [];
  if (body.AttributeType !== attribute.type) {
    notes.push(`AttributeType ${body.AttributeType} != ${attribute.type}`);
  }
  if (body.RequiredLevel?.Value !== requiredLevel(attribute.requiredLevel)) {
    notes.push(`RequiredLevel ${body.RequiredLevel?.Value} != ${requiredLevel(attribute.requiredLevel)}`);
  }
  if (attribute.maxLength != null && body.MaxLength !== attribute.maxLength) {
    notes.push(`MaxLength ${body.MaxLength} != ${attribute.maxLength}`);
  }
  if (attribute.type === 'Integer') {
    if (body.MinValue !== attribute.minValue) notes.push(`MinValue ${body.MinValue} != ${attribute.minValue}`);
    if (body.MaxValue !== attribute.maxValue) notes.push(`MaxValue ${body.MaxValue} != ${attribute.maxValue}`);
  }
  if (attribute.type === 'String') {
    const expectedFormat = attribute.format || 'Text';
    if (body.FormatName?.Value !== expectedFormat) {
      notes.push(`FormatName ${body.FormatName?.Value} != ${expectedFormat}`);
    }
    if (attribute.isPrimaryName && body.IsPrimaryName !== true) {
      notes.push(`IsPrimaryName ${body.IsPrimaryName} != true`);
    }
  }
  if (attribute.type === 'Memo' && body.Format !== (attribute.format || 'Text')) {
    notes.push(`Format ${body.Format} != ${attribute.format || 'Text'}`);
  }
  if (attribute.type === 'DateTime') {
    if (body.Format !== attribute.format) notes.push(`Format ${body.Format} != ${attribute.format}`);
    if (body.DateTimeBehavior?.Value !== attribute.behavior) {
      notes.push(`DateTimeBehavior ${body.DateTimeBehavior?.Value} != ${attribute.behavior}`);
    }
  }
  if (attribute.type === 'Picklist') {
    if (body.DefaultFormValue !== (attribute.defaultValue ?? -1)) {
      notes.push(`DefaultFormValue ${body.DefaultFormValue} != ${attribute.defaultValue ?? -1}`);
    }
    const actual = (body.OptionSet?.Options || []).map((option) => ({
      value: option.Value,
      label: option.Label?.UserLocalizedLabel?.Label,
    }));
    if (!sameOptions(actual, attribute.options)) {
      notes.push(`Options ${JSON.stringify(actual)} != ${JSON.stringify(attribute.options.map(({ value, label }) => ({ value, label })))}`);
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeRelationship(token, spec, relationship, readMetadata = getJson) {
  const entity = spec.schemaName.toLowerCase();
  const uncast = await readMetadata(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')?`
      + '$select=SchemaName,RelationshipType',
  );
  if (uncast.status === 404) return result('absent');
  if (uncast.body?.RelationshipType !== 'OneToManyRelationship') {
    return result('divergent', [
      `RelationshipType ${uncast.body?.RelationshipType} != OneToManyRelationship`,
    ]);
  }
  const response = await readMetadata(
    token,
    `/RelationshipDefinitions(SchemaName='${relationship.schemaName}')/`
      + 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?'
      + '$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencingAttribute,'
      + 'ReferencingEntityNavigationPropertyName,CascadeConfiguration',
  );
  if (response.status === 404) {
    return result('divergent', ['Relationship exists but typed metadata is unavailable']);
  }
  const body = response.body || {};
  const notes = [];
  const lookupLogicalName = relationship.lookupSchemaName.toLowerCase();
  if (body.ReferencedEntity !== relationship.referencedEntity) {
    notes.push(`ReferencedEntity ${body.ReferencedEntity} != ${relationship.referencedEntity}`);
  }
  if (body.ReferencingEntity !== entity) {
    notes.push(`ReferencingEntity ${body.ReferencingEntity} != ${entity}`);
  }
  if (body.ReferencingAttribute !== lookupLogicalName) {
    notes.push(`ReferencingAttribute ${body.ReferencingAttribute} != ${lookupLogicalName}`);
  }
  if (body.ReferencingEntityNavigationPropertyName !== relationship.lookupSchemaName) {
    notes.push(`NavigationProperty ${body.ReferencingEntityNavigationPropertyName} != ${relationship.lookupSchemaName}`);
  }
  for (const [operation, expected] of Object.entries(DEFAULT_CASCADE)) {
    if (body.CascadeConfiguration?.[operation] !== expected) {
      notes.push(`CascadeConfiguration.${operation} ${body.CascadeConfiguration?.[operation]} != ${expected}`);
    }
  }
  const lookup = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${lookupLogicalName}')/`
      + 'Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,RequiredLevel',
  );
  if (lookup.status === 404) notes.push(`Lookup attribute ${lookupLogicalName} is absent`);
  else if (lookup.body?.RequiredLevel?.Value !== requiredLevel(relationship.required)) {
    notes.push(`Lookup RequiredLevel ${lookup.body?.RequiredLevel?.Value} != ${requiredLevel(relationship.required)}`);
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeNoAlternateKeys(token, spec, readMetadata = getJson) {
  const entity = spec.schemaName.toLowerCase();
  const response = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${entity}')/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus`,
  );
  if (response.status === 404) return result('exact', ['Entity is absent, so no alternate key can exist.']);
  const keys = response.body?.value || [];
  if (keys.length === 0) return result('exact');
  return result('divergent', keys.map((key) => (
    `Unexpected alternate key ${key.SchemaName} [${(key.KeyAttributes || []).join(', ')}]`
  )));
}

async function probeSpec(token, spec, readMetadata = getJson) {
  const entity = spec.schemaName.toLowerCase();
  const checks = [{ name: `entity:${entity}`, value: await probeEntity(token, spec, readMetadata) }];
  const entityAbsent = checks[0].value.state === 'absent';
  const primary = {
    type: 'String',
    ...spec.primaryNameAttribute,
    isPrimaryName: true,
  };
  for (const attribute of [primary, ...spec.attributes]) {
    checks.push({
      name: `${entity}.${attribute.schemaName.toLowerCase()}`,
      value: entityAbsent ? result('absent') : await probeAttribute(token, spec, attribute, readMetadata),
    });
  }
  for (const relationship of spec.relationships) {
    checks.push({
      name: `relationship:${relationship.schemaName}`,
      value: entityAbsent
        ? result('absent')
        : await probeRelationship(token, spec, relationship, readMetadata),
    });
  }
  checks.push({
    name: `no-alternate-keys:${entity}`,
    value: await probeNoAlternateKeys(token, spec, readMetadata),
  });
  return checks;
}

function exactAttributeBody(attribute, overrides = {}) {
  const body = {
    LogicalName: attribute.schemaName.toLowerCase(),
    AttributeType: attribute.type,
    RequiredLevel: { Value: requiredLevel(attribute.requiredLevel) },
    ...overrides,
  };
  if (attribute.maxLength != null) body.MaxLength = attribute.maxLength;
  if (attribute.type === 'Integer') {
    body.MinValue = attribute.minValue;
    body.MaxValue = attribute.maxValue;
  }
  if (attribute.type === 'String') body.FormatName = { Value: attribute.format || 'Text' };
  if (attribute.type === 'Memo') body.Format = attribute.format || 'Text';
  if (attribute.type === 'DateTime') {
    body.Format = attribute.format;
    body.DateTimeBehavior = { Value: attribute.behavior };
  }
  if (attribute.type === 'Picklist') {
    body.DefaultFormValue = attribute.defaultValue ?? -1;
    body.OptionSet = {
      Options: attribute.options.map((option) => ({
        Value: option.value,
        Label: { UserLocalizedLabel: { Label: option.label } },
      })),
    };
  }
  return body;
}

function typedAttributeReader(attribute, mutate = () => {}) {
  let reads = 0;
  return async () => {
    reads += 1;
    if (reads === 1) {
      return { status: 200, body: { AttributeType: attribute.type } };
    }
    const body = exactAttributeBody(attribute);
    mutate(body);
    return { status: 200, body };
  };
}

async function runSelfTest() {
  validateSpecs();
  const session = specs.find((spec) => spec.schemaName.toLowerCase() === 'wmkf_deliberationsession');
  const slot = specs.find((spec) => spec.schemaName.toLowerCase() === 'wmkf_deliberationslot');

  const missing = await probeEntity(null, session, async () => ({ status: 404, body: null }));
  if (missing.state !== 'absent') throw new Error('A missing entity must classify absent.');

  const wrongEntitySet = await probeEntity(null, session, async () => ({
    status: 200,
    body: {
      LogicalName: 'wmkf_deliberationsession',
      EntitySetName: 'wmkf_wrong',
      OwnershipType: 'OrganizationOwned',
      PrimaryNameAttribute: 'wmkf_name',
    },
  }));
  if (wrongEntitySet.state !== 'divergent') {
    throw new Error('A wrong entity set must classify divergent.');
  }

  const meetingLink = session.attributes.find((attribute) => attribute.schemaName === 'wmkf_MeetingLink');
  const wrongUrl = await probeAttribute(null, session, meetingLink, typedAttributeReader(meetingLink, (body) => {
    body.FormatName = { Value: 'Text' };
  }));
  if (wrongUrl.state !== 'divergent') throw new Error('A non-URL meeting link must classify divergent.');

  const wrongType = await probeAttribute(null, session, meetingLink, async () => ({
    status: 200,
    body: { AttributeType: 'Memo' },
  }));
  if (wrongType.state !== 'divergent') {
    throw new Error('An existing attribute with the wrong type must classify divergent.');
  }

  const status = session.attributes.find((attribute) => attribute.schemaName === 'wmkf_Status');
  const wrongOptions = await probeAttribute(null, session, status, typedAttributeReader(status, (body) => {
    body.OptionSet.Options.push({ Value: 100000003, Label: { UserLocalizedLabel: { Label: 'Other' } } });
  }));
  if (wrongOptions.state !== 'divergent') throw new Error('An extra status option must classify divergent.');

  const minutes = slot.attributes.find((attribute) => attribute.schemaName === 'wmkf_Minutes');
  const wrongMinutes = await probeAttribute(null, slot, minutes, typedAttributeReader(minutes, (body) => {
    body.MaxValue = minutes.maxValue - 1;
  }));
  if (wrongMinutes.state !== 'divergent') throw new Error('A wrong integer bound must classify divergent.');

  const relationship = slot.relationships.find((candidate) => candidate.lookupSchemaName === 'wmkf_Request');
  let relationshipRead = 0;
  const wrongRelationship = await probeRelationship(null, slot, relationship, async () => {
    relationshipRead += 1;
    if (relationshipRead === 1) {
      return { status: 200, body: { RelationshipType: 'OneToManyRelationship' } };
    }
    if (relationshipRead === 2) {
      return {
        status: 200,
        body: {
          ReferencedEntity: relationship.referencedEntity,
          ReferencingEntity: slot.schemaName.toLowerCase(),
          ReferencingAttribute: relationship.lookupSchemaName.toLowerCase(),
          ReferencingEntityNavigationPropertyName: relationship.lookupSchemaName,
          CascadeConfiguration: { ...DEFAULT_CASCADE, Delete: 'Cascade' },
        },
      };
    }
    return { status: 200, body: { RequiredLevel: { Value: relationship.required } } };
  });
  if (wrongRelationship.state !== 'divergent' || relationshipRead !== 3) {
    throw new Error('A wrong relationship cascade must classify divergent.');
  }

  const wrongRelationshipType = await probeRelationship(null, slot, relationship, async () => ({
    status: 200,
    body: { RelationshipType: 'ManyToManyRelationship' },
  }));
  if (wrongRelationshipType.state !== 'divergent') {
    throw new Error('A wrong relationship type must classify divergent.');
  }

  const noKeys = await probeNoAlternateKeys(null, slot, async () => ({
    status: 200,
    body: { value: [] },
  }));
  if (noKeys.state !== 'exact') throw new Error('No alternate keys must classify exact.');
  const unexpectedKey = await probeNoAlternateKeys(null, slot, async () => ({
    status: 200,
    body: { value: [{ SchemaName: 'unexpected', KeyAttributes: ['wmkf_request'] }] },
  }));
  if (unexpectedKey.state !== 'divergent') {
    throw new Error('An unexpected alternate key must classify divergent.');
  }

  console.log('PASS: Wave 28 Meeting Tracker specs and metadata classifiers are valid.');
}

async function main() {
  validateSpecs();
  const token = await getToken();
  const checks = [];
  for (const spec of specs) checks.push(...await probeSpec(token, spec));
  for (const check of checks) {
    console.log(`${check.value.state.toUpperCase().padEnd(10)} ${check.name}`);
    for (const note of check.value.notes) console.log(`           - ${note}`);
  }
  const counts = Object.fromEntries(['absent', 'exact', 'divergent'].map((state) => [
    state,
    checks.filter((check) => check.value.state === state).length,
  ]));
  console.log(
    `Summary: ${counts.absent} absent, ${counts.exact} exact, ${counts.divergent} divergent.`,
  );
  if (counts.divergent) {
    console.error('ABORT: creation-only schema apply cannot reconcile divergent live metadata.');
    process.exit(1);
  }
  console.log('READ-ONLY PREFLIGHT COMPLETE: no metadata changes were made.');
  if (counts.absent) {
    console.log(
      'CREATION-COMPATIBLE: after explicit owner approval, the apply command would be '
        + `node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE} --execute`,
    );
  } else {
    console.log('ALREADY EXACT: all 22 checks passed; no schema apply is required for this target.');
  }
}

if (selfTest) runSelfTest().catch((error) => {
  console.error(`SELF-TEST ERROR: ${error.message}`);
  process.exit(1);
});
else main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
