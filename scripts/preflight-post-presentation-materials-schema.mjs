#!/usr/bin/env node

/**
 * Read-only preflight for wave30-post-presentation-materials.
 *
 * Classifies the exact URL String and bounded Integer metadata as absent,
 * exact, or divergent. This script never writes Dataverse metadata.
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

const WAVE = '30-post-presentation-materials';
const SPEC_PATH = 'lib/dataverse/schema/wave30-post-presentation-materials/'
  + 'wmkf_requestdocument_post_presentation_materials.json';
const spec = JSON.parse(readFileSync(resolve(process.cwd(), SPEC_PATH), 'utf8'));
const CAST = {
  String: 'StringAttributeMetadata',
  Integer: 'IntegerAttributeMetadata',
};

function result(state, notes = []) {
  return { state, notes };
}

function validateSpec() {
  if (spec.kind !== 'extensions-on-existing'
      || spec.entityLogicalName !== 'wmkf_requestdocument') {
    throw new Error('Wave 30 must extend wmkf_requestdocument.');
  }
  const attributes = new Map((spec.attributes || []).map((attribute) => [
    attribute.schemaName.toLowerCase(),
    attribute,
  ]));
  const externalUrl = attributes.get('wmkf_externalurl');
  if (!externalUrl
      || externalUrl.type !== 'String'
      || externalUrl.format !== 'Url'
      || externalUrl.maxLength !== 2000) {
    throw new Error('Unexpected Wave 30 ExternalUrl shape.');
  }
  attributes.delete('wmkf_externalurl');
  const slotVersion = attributes.get('wmkf_slotversion');
  if (!slotVersion
      || slotVersion.type !== 'Integer'
      || slotVersion.minValue !== 1
      || slotVersion.maxValue !== 2147483647) {
    throw new Error('Unexpected Wave 30 SlotVersion shape.');
  }
  attributes.delete('wmkf_slotversion');
  if (attributes.size || (spec.relationships || []).length) {
    throw new Error('Unexpected artifacts in the Wave 30 spec.');
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

async function probeAttribute(token, attribute, readMetadata = getJson) {
  const logicalName = attribute.schemaName.toLowerCase();
  const base = `/EntityDefinitions(LogicalName='${spec.entityLogicalName}')/`
    + `Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(token, `${base}?$select=LogicalName,AttributeType`);
  if (uncast.status === 404) return result('absent');
  if (uncast.body?.AttributeType !== attribute.type) {
    return result('divergent', [
      `AttributeType ${uncast.body?.AttributeType} != ${attribute.type}`,
    ]);
  }
  const fields = attribute.type === 'String'
    ? 'LogicalName,AttributeType,RequiredLevel,MaxLength,FormatName'
    : 'LogicalName,AttributeType,RequiredLevel,MinValue,MaxValue';
  const response = await readMetadata(
    token,
    `${base}/Microsoft.Dynamics.CRM.${CAST[attribute.type]}?$select=${fields}`,
  );
  if (response.status === 404) {
    return result('divergent', ['Attribute exists but typed metadata is unavailable']);
  }
  const body = response.body || {};
  const notes = [];
  if (body.RequiredLevel?.Value !== (attribute.requiredLevel || 'None')) {
    notes.push(`RequiredLevel ${body.RequiredLevel?.Value} != ${attribute.requiredLevel || 'None'}`);
  }
  if (attribute.type === 'String') {
    if (body.MaxLength !== attribute.maxLength) {
      notes.push(`MaxLength ${body.MaxLength} != ${attribute.maxLength}`);
    }
    if (body.FormatName?.Value !== attribute.format) {
      notes.push(`FormatName ${body.FormatName?.Value} != ${attribute.format}`);
    }
  } else {
    if (body.MinValue !== attribute.minValue) {
      notes.push(`MinValue ${body.MinValue} != ${attribute.minValue}`);
    }
    if (body.MaxValue !== attribute.maxValue) {
      notes.push(`MaxValue ${body.MaxValue} != ${attribute.maxValue}`);
    }
  }
  return result(notes.length ? 'divergent' : 'exact', notes);
}

function exactReader(attribute, mutate = () => {}) {
  let reads = 0;
  return async () => {
    reads += 1;
    if (reads === 1) return { status: 200, body: { AttributeType: attribute.type } };
    const body = {
      LogicalName: attribute.schemaName.toLowerCase(),
      AttributeType: attribute.type,
      RequiredLevel: { Value: attribute.requiredLevel || 'None' },
    };
    if (attribute.type === 'String') {
      body.MaxLength = attribute.maxLength;
      body.FormatName = { Value: attribute.format };
    } else {
      body.MinValue = attribute.minValue;
      body.MaxValue = attribute.maxValue;
    }
    mutate(body);
    return { status: 200, body };
  };
}

async function runSelfTest() {
  validateSpec();
  const [externalUrl, slotVersion] = spec.attributes;
  const absent = await probeAttribute(null, externalUrl, async () => ({ status: 404, body: null }));
  if (absent.state !== 'absent') throw new Error('A missing attribute must classify absent.');
  const wrongType = await probeAttribute(null, externalUrl, async () => ({
    status: 200,
    body: { AttributeType: 'Memo' },
  }));
  if (wrongType.state !== 'divergent') throw new Error('A wrong type must classify divergent.');
  const wrongFormat = await probeAttribute(null, externalUrl, exactReader(externalUrl, (body) => {
    body.FormatName = { Value: 'Text' };
  }));
  if (wrongFormat.state !== 'divergent') throw new Error('A non-URL String must classify divergent.');
  const wrongBound = await probeAttribute(null, slotVersion, exactReader(slotVersion, (body) => {
    body.MaxValue -= 1;
  }));
  if (wrongBound.state !== 'divergent') throw new Error('A wrong fence bound must classify divergent.');
  for (const attribute of spec.attributes) {
    const exact = await probeAttribute(null, attribute, exactReader(attribute));
    if (exact.state !== 'exact') throw new Error(`${attribute.schemaName} must classify exact.`);
  }
  console.log('PASS: Wave 30 post-presentation schema spec and metadata projections are valid.');
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
