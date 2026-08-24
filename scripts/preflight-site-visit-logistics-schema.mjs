#!/usr/bin/env node

/**
 * Read-only exact metadata preflight for Wave 21 Site Visit logistics fields.
 * ABSENT and EXACT are safe; any divergent existing field blocks the
 * creation-only schema applier.
 *
 * Usage:
 *   node scripts/preflight-site-visit-logistics-schema.mjs --target=prod
 *   node scripts/preflight-site-visit-logistics-schema.mjs --target=sandbox
 *   node scripts/preflight-site-visit-logistics-schema.mjs --self-test
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { SITE_VISIT_FORMAT_LABEL } from '../shared/config/siteVisit.js';

const ENTITY = 'wmkf_sitevisit';
const FIELDS = Object.freeze([
  {
    logicalName: 'wmkf_visitformat',
    metadataType: 'PicklistAttributeMetadata',
    expected: {
      AttributeType: 'Picklist',
      RequiredLevel: 'None',
      options: Object.entries(SITE_VISIT_FORMAT_LABEL)
        .map(([value, label]) => ({ value: Number(value), label }))
        .sort((a, b) => a.value - b.value),
    },
  },
  {
    logicalName: 'wmkf_ianatimezone',
    metadataType: 'StringAttributeMetadata',
    expected: {
      AttributeType: 'String',
      RequiredLevel: 'None',
      MaxLength: 100,
      Format: 'Text',
    },
  },
  {
    logicalName: 'wmkf_locationorlink',
    metadataType: 'StringAttributeMetadata',
    expected: {
      AttributeType: 'String',
      RequiredLevel: 'None',
      MaxLength: 2000,
      Format: 'Text',
    },
  },
  {
    logicalName: 'wmkf_attendeerefsjson',
    metadataType: 'MemoAttributeMetadata',
    expected: {
      AttributeType: 'Memo',
      RequiredLevel: 'None',
      MaxLength: 32000,
      Format: 'Text',
    },
  },
]);

function label(metadata) {
  return metadata?.UserLocalizedLabel?.Label
    || metadata?.LocalizedLabels?.[0]?.Label
    || null;
}

export function classify(field, body) {
  if (body === null) return { state: 'absent', notes: [] };
  const notes = [];
  const expected = field.expected;
  for (const key of ['AttributeType', 'MaxLength', 'Format']) {
    if (expected[key] !== undefined && body[key] !== expected[key]) {
      notes.push(`${key} ${body[key]} != ${expected[key]}`);
    }
  }
  if (body.RequiredLevel?.Value !== expected.RequiredLevel) {
    notes.push(`RequiredLevel ${body.RequiredLevel?.Value} != ${expected.RequiredLevel}`);
  }
  if (expected.options) {
    const found = (body.OptionSet?.Options || [])
      .map((option) => ({ value: option.Value, label: label(option.Label) }))
      .sort((a, b) => a.value - b.value);
    if (JSON.stringify(found) !== JSON.stringify(expected.options)) {
      notes.push(`options ${JSON.stringify(found)} != ${JSON.stringify(expected.options)}`);
    }
  }
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

if (process.argv.includes('--self-test')) {
  const stringField = FIELDS[1];
  const exact = classify(stringField, {
    AttributeType: 'String',
    RequiredLevel: { Value: 'None' },
    MaxLength: 100,
    Format: 'Text',
  });
  const divergent = classify(stringField, {
    AttributeType: 'String',
    RequiredLevel: { Value: 'None' },
    MaxLength: 200,
    Format: 'Text',
  });
  const picklistExact = classify(FIELDS[0], {
    AttributeType: 'Picklist',
    RequiredLevel: { Value: 'None' },
    OptionSet: {
      Options: Object.entries(SITE_VISIT_FORMAT_LABEL).map(([value, optionLabel]) => ({
        Value: Number(value),
        Label: { UserLocalizedLabel: { Label: optionLabel } },
      })),
    },
  });
  if (classify(stringField, null).state !== 'absent'
    || exact.state !== 'exact'
    || divergent.state !== 'divergent'
    || picklistExact.state !== 'exact') {
    throw new Error('Site Visit logistics preflight classification self-test failed.');
  }
  console.log('PASS: Site Visit logistics schema preflight self-test.');
  process.exit(0);
}

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 1) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
if (!['prod', 'sandbox'].includes(target)) throw new Error('Pass --target=prod or --target=sandbox.');
const sandboxUrl = process.env.DYNAMICS_SANDBOX_URL
  || (SANDBOX_HOSTS[0] ? `https://${SANDBOX_HOSTS[0]}` : null);
const resourceUrl = target === 'prod' ? process.env.DYNAMICS_URL : sandboxUrl;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const tokenResponse = await fetch(
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
const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenBody.access_token) {
  throw new Error(`Token request failed (${tokenResponse.status}).`);
}

const headers = { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' };
const outcomes = [];
for (const field of FIELDS) {
  const select = field.expected.options
    ? '$select=AttributeType,RequiredLevel&$expand=OptionSet'
    : '$select=AttributeType,RequiredLevel,MaxLength,Format';
  const response = await fetch(
    `${resourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')`
      + `/Attributes(LogicalName='${field.logicalName}')/Microsoft.Dynamics.CRM.${field.metadataType}?${select}`,
    { headers },
  );
  let outcome;
  if (response.status === 404) outcome = classify(field, null);
  else if (!response.ok) {
    throw new Error(`Unexpected ${field.logicalName} metadata response ${response.status}: ${(await response.text()).slice(0, 400)}`);
  } else outcome = classify(field, await response.json());
  outcomes.push({ field: field.logicalName, ...outcome });
}

for (const outcome of outcomes) {
  console.log(`${ENTITY}.${outcome.field}: ${outcome.state.toUpperCase()} on target=${target}`);
  for (const note of outcome.notes) console.error(`  - ${note}`);
}
if (outcomes.some((outcome) => outcome.state === 'divergent')) process.exit(1);
console.log(`PROCEED: node scripts/apply-dataverse-schema.js --target=${target} --wave=21-site-visit-logistics --execute`);
