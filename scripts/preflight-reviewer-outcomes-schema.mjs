#!/usr/bin/env node

/**
 * Read-only preflight for Wave 35 reviewer outcomes: the "Ended By" field
 * (wmkf_appreviewersuggestion.wmkf_endedby). Adapted from the Wave 26
 * reviewer-closeout preflight.
 *
 * Classifies the manually-created field as absent, exact, or divergent and
 * proves the published entity set accepts the field in a bounded $select.
 * Never writes schema or business data.
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

const WAVE = '35-reviewer-outcomes';
const SPEC_PATH = `lib/dataverse/schema/wave${WAVE}/01_wmkf_appreviewersuggestion_ended_by.json`;
const spec = JSON.parse(readFileSync(resolve(process.cwd(), SPEC_PATH), 'utf8'));

function validateSpec() {
  const attribute = spec.attributes?.[0];
  const expectedOptions = [
    [100000000, 'Reviewer before accepting'],
    [100000001, 'Reviewer after accepting'],
    [100000002, 'Foundation'],
  ];
  const actualOptions = (attribute?.options || []).map((option) => [option.value, option.label]);
  if (spec.kind !== 'extensions-on-existing'
      || spec.entityLogicalName !== 'wmkf_appreviewersuggestion'
      || spec.attributes?.length !== 1
      || attribute?.schemaName !== 'wmkf_EndedBy'
      || attribute?.type !== 'Picklist'
      || attribute?.requiredLevel !== 'None'
      || attribute?.defaultValue !== -1
      || JSON.stringify(actualOptions) !== JSON.stringify(expectedOptions)) {
    throw new Error('Unexpected Wave 35 reviewer-outcomes spec shape.');
  }
  return attribute;
}

function labelText(label) {
  return label?.UserLocalizedLabel?.Label
    || label?.LocalizedLabels?.find((entry) => entry.LanguageCode === 1033)?.Label
    || '';
}

function classifyTypedMetadata(body, attribute) {
  const notes = [];
  if (body?.AttributeType !== 'Picklist') notes.push(`AttributeType ${body?.AttributeType} != Picklist`);
  if (body?.RequiredLevel?.Value !== 'None') notes.push(`RequiredLevel ${body?.RequiredLevel?.Value} != None`);
  if (![null, -1].includes(body?.DefaultFormValue)) {
    notes.push(`DefaultFormValue ${body?.DefaultFormValue} is not empty`);
  }
  if (labelText(body?.DisplayName) !== attribute.displayName) {
    notes.push(`DisplayName '${labelText(body?.DisplayName)}' != '${attribute.displayName}'`);
  }
  const description = labelText(body?.Description);
  if (!/initiated/i.test(description) || !/not who recorded/i.test(description)) {
    notes.push('Description does not say the field records the initiator, not the recorder');
  }
  if (body?.OptionSet?.IsGlobal !== false) notes.push('OptionSet must be local (IsGlobal=false)');
  const actualOptions = (body?.OptionSet?.Options || []).map((option) => [
    option.Value,
    labelText(option.Label),
  ]);
  const expectedOptions = attribute.options.map((option) => [option.value, option.label]);
  if (JSON.stringify(actualOptions) !== JSON.stringify(expectedOptions)) {
    notes.push(`Options ${JSON.stringify(actualOptions)} != ${JSON.stringify(expectedOptions)}`);
  }
  return { state: notes.length ? 'divergent' : 'exact', notes };
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
  if (uncast.status === 404) return { state: 'absent', notes: [], runtimeReadable: false };
  if (uncast.body?.AttributeType !== 'Picklist') {
    return {
      state: 'divergent',
      notes: [`AttributeType ${uncast.body?.AttributeType} != Picklist`],
      runtimeReadable: false,
    };
  }
  const typed = await readMetadata(
    token,
    `${base}/Microsoft.Dynamics.CRM.PicklistAttributeMetadata`
      + '?$select=LogicalName,AttributeType,RequiredLevel,DefaultFormValue,DisplayName,Description'
      + '&$expand=OptionSet',
  );
  if (typed.status === 404) {
    return { state: 'divergent', notes: ['Typed Picklist metadata unavailable'], runtimeReadable: false };
  }
  const outcome = classifyTypedMetadata(typed.body, attribute);
  const runtime = await readMetadata(
    token,
    `/wmkf_appreviewersuggestions?$select=${logicalName}&$top=1`,
  );
  return { ...outcome, runtimeReadable: runtime.status === 200 };
}

async function main() {
  const attribute = validateSpec();
  if (selfTest) {
    const exactBody = {
      AttributeType: 'Picklist',
      RequiredLevel: { Value: 'None' },
      DefaultFormValue: -1,
      DisplayName: { UserLocalizedLabel: { Label: 'Ended By' } },
      Description: {
        UserLocalizedLabel: {
          Label: 'Who ended it. This records who initiated the ending, not who recorded it.',
        },
      },
      OptionSet: {
        IsGlobal: false,
        Options: attribute.options.map((option) => ({
          Value: option.value,
          Label: { UserLocalizedLabel: { Label: option.label } },
        })),
      },
    };
    if (classifyTypedMetadata(exactBody, attribute).state !== 'exact') {
      throw new Error('Exact Picklist metadata must pass.');
    }
    if (classifyTypedMetadata({ ...exactBody, DefaultFormValue: 100000000 }, attribute).state !== 'divergent') {
      throw new Error('A defaulted Picklist must fail.');
    }
    if (classifyTypedMetadata({ ...exactBody, OptionSet: { ...exactBody.OptionSet, IsGlobal: true } }, attribute).state !== 'divergent') {
      throw new Error('A global option set must fail.');
    }
    console.log('PASS: Wave 35 reviewer-outcomes schema preflight self-test.');
    return;
  }

  const outcome = await probe(attribute, getJson, await getToken());
  console.log(`${outcome.state.toUpperCase()} ${spec.entityLogicalName}.${attribute.schemaName.toLowerCase()}`);
  console.log(`RUNTIME_SELECT: ${outcome.runtimeReadable ? 'READABLE' : 'UNAVAILABLE'}`);
  for (const note of outcome.notes) console.log(`  - ${note}`);
  if (outcome.state === 'divergent' || (outcome.state === 'exact' && !outcome.runtimeReadable)) {
    throw new Error('ABORT: live field does not satisfy the Wave 35 runtime contract.');
  }
  if (outcome.state === 'absent') {
    console.log(`PROCEED: node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE} --execute`);
  } else {
    console.log('NO-OP: live metadata already matches the Wave 35 contract.');
  }
}

await main();
