#!/usr/bin/env node

/**
 * Read-only preflight for the Meeting Tracker transcript bundle field and its
 * existing Request Document generation-key alternate key.
 *
 * Usage:
 *   node scripts/preflight-meeting-transcript-bundle-schema.mjs --target=sandbox
 *   node scripts/preflight-meeting-transcript-bundle-schema.mjs --target=prod
 *   node scripts/preflight-meeting-transcript-bundle-schema.mjs --self-test
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PRODUCTION_HOSTS,
  SANDBOX_HOSTS,
} from '../lib/dataverse/core/target-registry.js';

for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of content.split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 0) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
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

const FIELD_SPEC_PATH = 'lib/dataverse/schema/wave31-meeting-transcript-bundle/'
  + 'wmkf_requestdocument_transcript_bundle.json';
const REGISTRY_SPEC_PATH = 'lib/dataverse/schema/wave16-request-document-registry/'
  + 'wmkf_requestdocument.json';
const fieldSpec = JSON.parse(readFileSync(resolve(process.cwd(), FIELD_SPEC_PATH), 'utf8'));
const registrySpec = JSON.parse(readFileSync(resolve(process.cwd(), REGISTRY_SPEC_PATH), 'utf8'));
const entity = 'wmkf_requestdocument';
const fieldLogicalName = 'wmkf_transcriptbundlejson';
const keySchemaName = 'wmkf_requestdocument_generation_key';
const keyAttribute = 'wmkf_generationkey';

function result(state, notes = []) {
  return { state, notes };
}

function sameSet(actual = [], expected = []) {
  const left = [...actual].map(String).sort();
  const right = [...expected].map(String).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function trackedTargetUrl(rawUrl, selectedTarget) {
  const allowedHosts = selectedTarget === 'sandbox' ? SANDBOX_HOSTS : PRODUCTION_HOSTS;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`Missing Dataverse URL for target=${selectedTarget}.`);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Dataverse URL for target=${selectedTarget}.`);
  }
  if (parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || parsed.search
      || parsed.hash
      || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Dataverse URL host is not registered for target=${selectedTarget}.`);
  }
  return parsed.origin;
}

function validateSpecs() {
  if (fieldSpec.kind !== 'extensions-on-existing'
      || fieldSpec.entityLogicalName !== entity
      || (fieldSpec.relationships || []).length !== 0) {
    throw new Error('Unexpected Wave 31 Request Document extension.');
  }
  const fields = fieldSpec.attributes || [];
  if (fields.length !== 1
      || fields[0].schemaName?.toLowerCase() !== fieldLogicalName
      || fields[0].type !== 'Memo'
      || fields[0].maxLength !== 32000
      || (fields[0].requiredLevel && fields[0].requiredLevel !== 'None')) {
    throw new Error('Unexpected Wave 31 transcript bundle Memo contract.');
  }

  if (registrySpec.schemaName?.toLowerCase() !== entity) {
    throw new Error('Unexpected Wave 16 Request Document entity.');
  }
  const keys = (registrySpec.alternateKeys || []).filter(
    (key) => key.schemaName === keySchemaName,
  );
  if (keys.length !== 1 || !sameSet(keys[0].keyAttributes, [keyAttribute])) {
    throw new Error('Unexpected Wave 16 generation-key alternate-key contract.');
  }
}

async function getToken(resourceUrl) {
  const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
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

async function getJson(resourceUrl, token, path) {
  const response = await fetch(`${resourceUrl}/api/data/v9.2${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new Error(`Dataverse metadata request failed (${response.status}).`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function probeField(resourceUrl, token, readMetadata = (auth, path) => (
  getJson(resourceUrl, auth, path)
)) {
  const base = `/EntityDefinitions(LogicalName='${entity}')/`
    + `Attributes(LogicalName='${fieldLogicalName}')`;
  const uncast = await readMetadata(token, `${base}?$select=LogicalName,AttributeType`);
  if (uncast.status === 404) return result('absent');
  if (uncast.body?.LogicalName?.toLowerCase() !== fieldLogicalName
      || uncast.body?.AttributeType !== 'Memo') {
    return result('divergent', [
      `Field identity/type ${uncast.body?.LogicalName || '(missing)'}/`
        + `${uncast.body?.AttributeType || '(missing)'} != ${fieldLogicalName}/Memo`,
    ]);
  }
  const typed = await readMetadata(
    token,
    `${base}/Microsoft.Dynamics.CRM.MemoAttributeMetadata?`
      + '$select=LogicalName,AttributeType,RequiredLevel,MaxLength',
  );
  if (typed.status === 404) {
    return result('divergent', ['Memo typed metadata is unavailable.']);
  }
  const body = typed.body || {};
  const notes = [];
  if (body.LogicalName?.toLowerCase() !== fieldLogicalName) {
    notes.push(`LogicalName ${body.LogicalName || '(missing)'} != ${fieldLogicalName}`);
  }
  if (body.AttributeType !== 'Memo') notes.push(`AttributeType ${body.AttributeType || '(missing)'} != Memo`);
  if (body.RequiredLevel?.Value !== 'None') {
    notes.push(`RequiredLevel ${body.RequiredLevel?.Value || '(missing)'} != None`);
  }
  if (body.MaxLength !== 32000) notes.push(`MaxLength ${body.MaxLength ?? '(missing)'} != 32000`);
  return result(notes.length ? 'divergent' : 'exact', notes);
}

async function probeKey(resourceUrl, token, readMetadata = (auth, path) => (
  getJson(resourceUrl, auth, path)
)) {
  const response = await readMetadata(
    token,
    `/EntityDefinitions(LogicalName='${entity}')/Keys?`
      + '$select=SchemaName,KeyAttributes,EntityKeyIndexStatus',
  );
  if (response.status === 404) return result('absent');
  const found = (response.body?.value || []).find((candidate) => (
    candidate.SchemaName === keySchemaName
  ));
  if (!found) return result('absent');
  if (!sameSet(found.KeyAttributes, [keyAttribute])) {
    return result('divergent', [
      `KeyAttributes [${(found.KeyAttributes || []).join(', ')}] != [${keyAttribute}]`,
    ]);
  }
  if (found.EntityKeyIndexStatus !== 'Active') {
    return result('inactive', [
      `EntityKeyIndexStatus ${found.EntityKeyIndexStatus || '(missing)'} != Active`,
    ]);
  }
  return result('exact');
}

function exactFieldReader(mutate = () => {}) {
  let reads = 0;
  return async () => {
    reads += 1;
    if (reads === 1) return {
      status: 200,
      body: { LogicalName: fieldLogicalName, AttributeType: 'Memo' },
    };
    const body = {
      LogicalName: fieldLogicalName,
      AttributeType: 'Memo',
      RequiredLevel: { Value: 'None' },
      MaxLength: 32000,
    };
    mutate(body);
    return { status: 200, body };
  };
}

async function runSelfTest() {
  validateSpecs();
  trackedTargetUrl('https://orgd9e66399.crm.dynamics.com', 'sandbox');
  trackedTargetUrl('https://wmkf.crm.dynamics.com/', 'prod');
  for (const [url, targetName] of [
    ['https://wmkf.crm.dynamics.com', 'sandbox'],
    ['https://example.com', 'prod'],
    ['http://wmkf.crm.dynamics.com', 'prod'],
    ['https://wmkf.crm.dynamics.com/path', 'prod'],
    ['https://wmkf.crm.dynamics.com:444', 'prod'],
  ]) {
    let rejected = false;
    try { trackedTargetUrl(url, targetName); } catch { rejected = true; }
    if (!rejected) throw new Error(`Unregistered or unsafe target URL was accepted for ${targetName}.`);
  }

  const absentField = await probeField(null, null, async () => ({ status: 404, body: null }));
  if (absentField.state !== 'absent') throw new Error('Missing memo field must classify absent.');
  const wrongType = await probeField(null, null, async () => ({
    status: 200,
    body: { LogicalName: fieldLogicalName, AttributeType: 'String' },
  }));
  if (wrongType.state !== 'divergent') throw new Error('Wrong memo field type must classify divergent.');
  const wrongLength = await probeField(null, null, exactFieldReader((body) => { body.MaxLength = 31999; }));
  if (wrongLength.state !== 'divergent') throw new Error('Wrong memo length must classify divergent.');
  const wrongRequired = await probeField(null, null, exactFieldReader((body) => {
    body.RequiredLevel = { Value: 'ApplicationRequired' };
  }));
  if (wrongRequired.state !== 'divergent') throw new Error('Required memo field must classify divergent.');
  const exactField = await probeField(null, null, exactFieldReader());
  if (exactField.state !== 'exact') throw new Error('Exact memo field must classify exact.');

  const keyResponse = (row) => async () => ({
    status: 200,
    body: { value: row ? [row] : [] },
  });
  const absentKey = await probeKey(null, null, async () => ({ status: 404, body: null }));
  if (absentKey.state !== 'absent') throw new Error('Missing key metadata must classify absent.');
  const missingKey = await probeKey(null, null, keyResponse(null));
  if (missingKey.state !== 'absent') throw new Error('Missing alternate key must classify absent.');
  const wrongKey = await probeKey(null, null, keyResponse({
    SchemaName: keySchemaName,
    KeyAttributes: ['wmkf_wrongkey'],
    EntityKeyIndexStatus: 'Active',
  }));
  if (wrongKey.state !== 'divergent') throw new Error('Wrong key attribute must classify divergent.');
  for (const status of ['Pending', 'InProgress', 'Failed', undefined]) {
    const inactive = await probeKey(null, null, keyResponse({
      SchemaName: keySchemaName,
      KeyAttributes: [keyAttribute],
      EntityKeyIndexStatus: status,
    }));
    if (inactive.state !== 'inactive') {
      throw new Error(`Non-active key status ${status || '(missing)'} must block readiness.`);
    }
  }
  const exactKey = await probeKey(null, null, keyResponse({
    SchemaName: keySchemaName,
    KeyAttributes: [keyAttribute],
    EntityKeyIndexStatus: 'Active',
  }));
  if (exactKey.state !== 'exact') throw new Error('Active exact key must classify exact.');
  console.log('PASS: Wave 31 Memo and Wave 16 generation-key readiness checks are valid.');
}

async function main() {
  validateSpecs();
  const selectedUrl = target === 'prod' ? process.env.DYNAMICS_URL : process.env.DYNAMICS_SANDBOX_URL;
  const resourceUrl = trackedTargetUrl(selectedUrl, target);
  const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
  if (!DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
    throw new Error(`Missing Dataverse credentials for target=${target}.`);
  }

  const token = await getToken(resourceUrl);
  const checks = [
    {
      name: `${entity}.${fieldLogicalName}`,
      value: await probeField(resourceUrl, token),
    },
    {
      name: `key:${keySchemaName} [${keyAttribute}]`,
      value: await probeKey(resourceUrl, token),
    },
  ];
  for (const check of checks) {
    console.log(`${check.value.state.toUpperCase().padEnd(10)} ${check.name}`);
    for (const note of check.value.notes) console.log(`           - ${note}`);
  }
  const ready = checks.every((check) => check.value.state === 'exact');
  console.log(`Summary: ${ready ? 'ready' : 'blocked'} (${target}); read-only metadata probe.`);
  if (!ready) process.exitCode = 1;
}

if (selfTest) runSelfTest().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
else main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
