#!/usr/bin/env node

/**
 * Read-only preflight for wave20-guarded-reopen.
 *
 * Classifies each declared attribute as absent, exact, or divergent. The schema
 * applier is creation-only, so divergent metadata blocks deployment. This
 * script never writes Dataverse data or metadata.
 *
 * Usage:
 *   node scripts/preflight-guarded-reopen-schema.mjs --target=prod
 *   node scripts/preflight-guarded-reopen-schema.mjs --target=sandbox
 *   node scripts/preflight-guarded-reopen-schema.mjs --self-test
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

const WAVE = '20-guarded-reopen';
const SPEC_PATH = 'lib/dataverse/schema/wave20-guarded-reopen/'
  + 'wmkf_requestdocument_guarded_reopen.json';
const spec = JSON.parse(readFileSync(resolve(process.cwd(), SPEC_PATH), 'utf8'));
const CAST = Object.freeze({
  String: 'StringAttributeMetadata',
  Memo: 'MemoAttributeMetadata',
});

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

function attributeSelect(attribute) {
  const common = ['LogicalName', 'AttributeType', 'RequiredLevel', 'MaxLength'];
  if (attribute.type === 'String') return [...common, 'FormatName'].join(',');
  if (attribute.type === 'Memo') return [...common, 'Format'].join(',');
  throw new Error(`Unsupported attribute type "${attribute.type}".`);
}

function validateSpec() {
  if (spec.kind !== 'extensions-on-existing'
      || spec.entityLogicalName !== 'wmkf_requestdocument') {
    throw new Error('The wave20 spec must extend wmkf_requestdocument.');
  }
  if (spec.attributes?.length !== 3) {
    throw new Error(`Expected three guarded-reopen attributes; found ${spec.attributes?.length || 0}.`);
  }
  const expected = new Map([
    ['wmkf_reopencycleid', { type: 'String', maxLength: 36 }],
    ['wmkf_reopenreasoncode', { type: 'String', maxLength: 50 }],
    ['wmkf_reopenreasonnote', { type: 'Memo', maxLength: 2000 }],
  ]);
  for (const attribute of spec.attributes) {
    const logicalName = attribute.schemaName.toLowerCase();
    const shape = expected.get(logicalName);
    if (!shape || attribute.type !== shape.type || attribute.maxLength !== shape.maxLength) {
      throw new Error(`Unexpected guarded-reopen attribute shape: ${attribute.schemaName}.`);
    }
    expected.delete(logicalName);
  }
  if (expected.size) throw new Error('One or more guarded-reopen attributes are missing.');
}

async function probeAttribute(token, attribute, readMetadata = getJson) {
  const logicalName = attribute.schemaName.toLowerCase();
  const cast = CAST[attribute.type];
  const basePath = `/EntityDefinitions(LogicalName='${spec.entityLogicalName}')/`
    + `Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(
    token,
    `${basePath}?$select=LogicalName,AttributeType`,
  );
  if (uncast.status === 404) return { state: 'absent', notes: [] };
  if (uncast.body?.AttributeType !== attribute.type) {
    return {
      state: 'divergent',
      notes: [`AttributeType ${uncast.body?.AttributeType} != ${attribute.type}`],
    };
  }

  const response = await readMetadata(
    token,
    `${basePath}/Microsoft.Dynamics.CRM.${cast}`
      + `?$select=${attributeSelect(attribute)}`,
  );
  if (response.status === 404) {
    return {
      state: 'divergent',
      notes: [`${cast} cast was unavailable for an existing ${attribute.type} attribute`],
    };
  }

  const notes = [];
  if (response.body?.AttributeType !== attribute.type) {
    notes.push(`AttributeType ${response.body?.AttributeType} != ${attribute.type}`);
  }
  if (response.body?.RequiredLevel?.Value !== (attribute.requiredLevel || 'None')) {
    notes.push(`RequiredLevel ${response.body?.RequiredLevel?.Value} != None`);
  }
  if (response.body?.MaxLength !== attribute.maxLength) {
    notes.push(`MaxLength ${response.body?.MaxLength} != ${attribute.maxLength}`);
  }
  if (attribute.type === 'String'
      && response.body?.FormatName?.Value !== (attribute.format || 'Text')) {
    notes.push(`FormatName ${response.body?.FormatName?.Value} != ${attribute.format || 'Text'}`);
  }
  if (attribute.type === 'Memo'
      && response.body?.Format !== (attribute.format || 'Text')) {
    notes.push(`Format ${response.body?.Format} != ${attribute.format || 'Text'}`);
  }
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

async function runSelfTest() {
  validateSpec();
  const stringFields = new Set(attributeSelect({ type: 'String' }).split(','));
  const memoFields = new Set(attributeSelect({ type: 'Memo' }).split(','));
  if (!stringFields.has('FormatName') || stringFields.has('Format')) {
    throw new Error('String metadata projection is incorrect.');
  }
  if (!memoFields.has('Format') || memoFields.has('FormatName')) {
    throw new Error('Memo metadata projection is incorrect.');
  }
  const stringAttribute = spec.attributes.find((attribute) => attribute.type === 'String');
  const absent = await probeAttribute(null, stringAttribute, async () => ({ status: 404, body: null }));
  if (absent.state !== 'absent') throw new Error('A missing uncast attribute must classify absent.');
  let readCount = 0;
  const wrongType = await probeAttribute(null, stringAttribute, async () => {
    readCount += 1;
    return {
      status: 200,
      body: { LogicalName: 'wmkf_reopencycleid', AttributeType: 'Memo' },
    };
  });
  if (wrongType.state !== 'divergent' || readCount !== 1) {
    throw new Error('An existing wrong-type attribute must classify divergent before a cast.');
  }
  readCount = 0;
  const wrongCast = await probeAttribute(null, stringAttribute, async () => {
    readCount += 1;
    return readCount === 1
      ? { status: 200, body: { LogicalName: 'wmkf_reopencycleid', AttributeType: 'String' } }
      : { status: 404, body: null };
  });
  if (wrongCast.state !== 'divergent' || readCount !== 2) {
    throw new Error('A typed-cast 404 for an existing expected-type attribute must classify divergent.');
  }
  console.log('PASS: wave20 guarded-reopen spec and metadata projections are valid.');
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
  for (const check of checks) {
    console.log(`${check.value.state.toUpperCase().padEnd(10)} ${check.name}`);
    for (const note of check.value.notes) console.log(`           - ${note}`);
  }
  const divergent = checks.filter((check) => check.value.state === 'divergent');
  const absent = checks.filter((check) => check.value.state === 'absent');
  console.log(
    `Summary: ${absent.length} absent, ${divergent.length} divergent, `
      + `${checks.length - absent.length - divergent.length} exact.`,
  );
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
