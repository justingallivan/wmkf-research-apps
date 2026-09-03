#!/usr/bin/env node

/**
 * Read-only preflight for wave25-review-answer-question-options.
 * Classifies the Memo attribute as absent, exact, or divergent. Never writes.
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

const WAVE = '25-review-answer-question-options';
const SPEC_PATH = `lib/dataverse/schema/wave${WAVE}/01_wmkf_appreviewanswer_question_options.json`;
const spec = JSON.parse(readFileSync(resolve(process.cwd(), SPEC_PATH), 'utf8'));

function validateSpec() {
  const attribute = spec.attributes?.[0];
  if (spec.kind !== 'extensions-on-existing'
      || spec.entityLogicalName !== 'wmkf_appreviewanswer'
      || spec.attributes?.length !== 1
      || attribute?.schemaName !== 'wmkf_QuestionOptions'
      || attribute?.type !== 'Memo'
      || attribute?.maxLength !== 20000) {
    throw new Error('Unexpected Wave 25 question-options spec shape.');
  }
  return attribute;
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
  if (!response.ok || !body.access_token) throw new Error(`Token request failed (${response.status}).`);
  return body.access_token;
}

async function getJson(token, apiPath) {
  const response = await fetch(`${resourceUrl}/api/data/v9.2${apiPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (response.status === 404) return { status: 404, body: null };
  const text = await response.text();
  if (!response.ok) throw new Error(`Unexpected response ${response.status}: ${text.slice(0, 400)}`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function probe(attribute, readMetadata = getJson, token = null) {
  const logicalName = attribute.schemaName.toLowerCase();
  const base = `/EntityDefinitions(LogicalName='${spec.entityLogicalName}')/Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(token, `${base}?$select=LogicalName,AttributeType`);
  if (uncast.status === 404) return { state: 'absent', notes: [] };
  if (uncast.body?.AttributeType !== 'Memo') {
    return { state: 'divergent', notes: [`AttributeType ${uncast.body?.AttributeType} != Memo`] };
  }
  const typed = await readMetadata(
    token,
    `${base}/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,AttributeType,RequiredLevel,MaxLength`,
  );
  if (typed.status === 404) return { state: 'divergent', notes: ['Typed Memo metadata unavailable'] };
  const notes = [];
  if (typed.body?.RequiredLevel?.Value !== 'None') notes.push(`RequiredLevel ${typed.body?.RequiredLevel?.Value} != None`);
  if (typed.body?.MaxLength !== attribute.maxLength) notes.push(`MaxLength ${typed.body?.MaxLength} != ${attribute.maxLength}`);
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

async function main() {
  const attribute = validateSpec();
  if (selfTest) {
    const absent = await probe(attribute, async () => ({ status: 404, body: null }));
    if (absent.state !== 'absent') throw new Error('Missing attribute must classify absent.');
    let calls = 0;
    const wrongType = await probe(attribute, async () => {
      calls += 1;
      return { status: 200, body: { AttributeType: 'String' } };
    });
    if (wrongType.state !== 'divergent' || calls !== 1) throw new Error('Wrong type must fail before typed metadata read.');
    console.log('PASS: Wave 25 question-options spec and metadata projections are valid.');
    return;
  }

  const state = await probe(attribute, getJson, await getToken());
  console.log(`${state.state.toUpperCase()} ${spec.entityLogicalName}.${attribute.schemaName.toLowerCase()}`);
  for (const note of state.notes) console.log(`  - ${note}`);
  if (state.state === 'divergent') {
    throw new Error('ABORT: creation-only schema apply cannot reconcile divergent live metadata.');
  }
  if (state.state === 'absent') {
    console.log(`PROCEED: node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE} --execute`);
  } else {
    console.log('NO-OP: live metadata already matches the Wave 25 contract.');
  }
}

await main();
