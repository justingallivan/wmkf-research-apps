#!/usr/bin/env node

/**
 * Read-only preflight for Wave 35 reviewer outcomes: the "Ended By" and
 * "Ended At" fields (wmkf_appreviewersuggestion.wmkf_endedby, wmkf_endedat).
 * Adapted from the Wave 26 reviewer-closeout preflight.
 *
 * Classifies each field as absent, exact, or divergent and proves the
 * published entity set accepts it in a bounded $select.
 * Never writes schema or business data. Reads go through
 * lib/dataverse/client.js (target interlock); a Production run needs
 * DATAVERSE_TARGET_INTERLOCK=on and DATAVERSE_ALLOW_PROD_READS=yes
 * (scripts/lib/dataverse-script-target.cjs).
 *
 * Usage: node scripts/preflight-reviewer-outcomes-schema.mjs --target=prod|sandbox
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const selfTest = process.argv.includes('--self-test');

const WAVE = '35-reviewer-outcomes';
const SPEC_DIR = `lib/dataverse/schema/wave${WAVE}`;
const readSpec = (file) => JSON.parse(readFileSync(resolve(process.cwd(), SPEC_DIR, file), 'utf8'));
const spec = readSpec('01_wmkf_appreviewersuggestion_ended_by.json');
const endedAtSpec = readSpec('02_wmkf_appreviewersuggestion_ended_at.json');

function validateEndedAtSpec() {
  const attribute = endedAtSpec.attributes?.[0];
  if (endedAtSpec.kind !== 'extensions-on-existing'
      || endedAtSpec.entityLogicalName !== spec.entityLogicalName
      || endedAtSpec.attributes?.length !== 1
      || attribute?.schemaName !== 'wmkf_EndedAt'
      || attribute?.type !== 'DateTime'
      || attribute?.format !== 'DateAndTime'
      || attribute?.behavior !== 'UserLocal') {
    throw new Error('Unexpected Wave 35 Ended At spec shape.');
  }
  return attribute;
}

function classifyDateTimeMetadata(body, attribute) {
  const notes = [];
  if (body?.AttributeType !== 'DateTime') notes.push(`AttributeType ${body?.AttributeType} != DateTime`);
  if (body?.RequiredLevel?.Value !== 'None') notes.push(`RequiredLevel ${body?.RequiredLevel?.Value} != None`);
  if (body?.Format !== attribute.format) notes.push(`Format ${body?.Format} != ${attribute.format}`);
  if (body?.DateTimeBehavior?.Value !== attribute.behavior) {
    notes.push(`DateTimeBehavior ${body?.DateTimeBehavior?.Value} != ${attribute.behavior}`);
  }
  if (labelText(body?.DisplayName) !== attribute.displayName) {
    notes.push(`DisplayName '${labelText(body?.DisplayName)}' != '${attribute.displayName}'`);
  }
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

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

let client = null;

async function getJson(_token, apiPath) {
  const response = await client.get(apiPath);
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new Error(`Unexpected response ${response.status}: ${response.text.slice(0, 400)}`);
  return { status: response.status, body: response.body };
}

const FIELD_KINDS = {
  Picklist: {
    typedPath: '/Microsoft.Dynamics.CRM.PicklistAttributeMetadata'
      + '?$select=LogicalName,AttributeType,RequiredLevel,DefaultFormValue,DisplayName,Description'
      + '&$expand=OptionSet',
    classify: classifyTypedMetadata,
  },
  DateTime: {
    typedPath: '/Microsoft.Dynamics.CRM.DateTimeAttributeMetadata'
      + '?$select=LogicalName,AttributeType,RequiredLevel,Format,DateTimeBehavior,DisplayName',
    classify: classifyDateTimeMetadata,
  },
};

async function probe(attribute, readMetadata = getJson, token = null) {
  const kind = FIELD_KINDS[attribute.type];
  const logicalName = attribute.schemaName.toLowerCase();
  const base = `/EntityDefinitions(LogicalName='${spec.entityLogicalName}')/Attributes(LogicalName='${logicalName}')`;
  const uncast = await readMetadata(token, `${base}?$select=LogicalName,AttributeType`);
  if (uncast.status === 404) return { state: 'absent', notes: [], runtimeReadable: false };
  if (uncast.body?.AttributeType !== attribute.type) {
    return {
      state: 'divergent',
      notes: [`AttributeType ${uncast.body?.AttributeType} != ${attribute.type}`],
      runtimeReadable: false,
    };
  }
  const typed = await readMetadata(token, `${base}${kind.typedPath}`);
  if (typed.status === 404) {
    return { state: 'divergent', notes: [`Typed ${attribute.type} metadata unavailable`], runtimeReadable: false };
  }
  const outcome = kind.classify(typed.body, attribute);
  const runtime = await readMetadata(
    token,
    `/wmkf_appreviewersuggestions?$select=${logicalName}&$top=1`,
  );
  return { ...outcome, runtimeReadable: runtime.status === 200 };
}

async function main() {
  const attribute = validateSpec();
  const endedAt = validateEndedAtSpec();
  if (selfTest) {
    const exactDate = {
      AttributeType: 'DateTime',
      RequiredLevel: { Value: 'None' },
      Format: 'DateAndTime',
      DateTimeBehavior: { Value: 'UserLocal' },
      DisplayName: { UserLocalizedLabel: { Label: 'Ended At' } },
    };
    if (classifyDateTimeMetadata(exactDate, endedAt).state !== 'exact') throw new Error('Exact DateTime metadata must pass.');
    if (classifyDateTimeMetadata({ ...exactDate, Format: 'DateOnly' }, endedAt).state !== 'divergent') {
      throw new Error('A date-only field must fail.');
    }
    if (classifyDateTimeMetadata({ ...exactDate, DateTimeBehavior: { Value: 'TimeZoneIndependent' } }, endedAt).state !== 'divergent') {
      throw new Error('A different DateTime behavior must fail.');
    }
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

  const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
  const { parseTargetArg, resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
  const target = parseTargetArg(process.argv);
  loadEnvLocal();
  const resourceUrl = resolveTargetResource({ target, write: false });
  console.log(`Target: ${target} (${resourceUrl})`);
  client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const outcomes = [];
  for (const field of [attribute, endedAt]) {
    const outcome = await probe(field, getJson);
    outcomes.push(outcome);
    console.log(`${outcome.state.toUpperCase()} ${spec.entityLogicalName}.${field.schemaName.toLowerCase()}`);
    console.log(`  RUNTIME_SELECT: ${outcome.runtimeReadable ? 'READABLE' : 'UNAVAILABLE'}`);
    for (const note of outcome.notes) console.log(`  - ${note}`);
  }
  if (outcomes.some((o) => o.state === 'divergent' || (o.state === 'exact' && !o.runtimeReadable))) {
    throw new Error('ABORT: a live field does not satisfy the Wave 35 runtime contract.');
  }
  if (outcomes.some((o) => o.state === 'absent')) {
    console.log(`PROCEED: node scripts/apply-dataverse-schema.js --target=${target} --wave=${WAVE} (dry run first, then --execute)`);
  } else {
    console.log('NO-OP: live metadata already matches the Wave 35 contract.');
  }
}

await main();
