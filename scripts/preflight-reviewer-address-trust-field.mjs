#!/usr/bin/env node

/**
 * Read-only metadata preflight for wave17-reviewer-address-trust.
 * Absent and exact are safe; a divergent existing column blocks the
 * creation-only schema applier.
 *
 * Usage:
 *   node scripts/preflight-reviewer-address-trust-field.mjs --target=prod
 *   node scripts/preflight-reviewer-address-trust-field.mjs --target=sandbox
 *   node scripts/preflight-reviewer-address-trust-field.mjs --self-test
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY = 'wmkf_potentialreviewers';
const FIELD = 'wmkf_addresstruststatejson';
const EXPECTED = Object.freeze({ AttributeType: 'Memo', MaxLength: 50000, RequiredLevel: 'None', Format: 'Text' });

function classify(body) {
  if (body === null) return { state: 'absent', notes: [] };
  const notes = [];
  if (body.AttributeType !== EXPECTED.AttributeType) notes.push(`AttributeType ${body.AttributeType} != ${EXPECTED.AttributeType}`);
  if (body.MaxLength !== EXPECTED.MaxLength) notes.push(`MaxLength ${body.MaxLength} != ${EXPECTED.MaxLength}`);
  if (body.RequiredLevel?.Value !== EXPECTED.RequiredLevel) notes.push(`RequiredLevel ${body.RequiredLevel?.Value} != ${EXPECTED.RequiredLevel}`);
  if (body.Format !== EXPECTED.Format) notes.push(`Format ${body.Format} != ${EXPECTED.Format}`);
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

if (process.argv.includes('--self-test')) {
  const exact = classify({ AttributeType: 'Memo', MaxLength: 50000, RequiredLevel: { Value: 'None' }, Format: 'Text' });
  const divergent = classify({ AttributeType: 'Memo', MaxLength: 10000, RequiredLevel: { Value: 'None' }, Format: 'Text' });
  if (classify(null).state !== 'absent' || exact.state !== 'exact' || divergent.state !== 'divergent') {
    throw new Error('Preflight classification self-test failed.');
  }
  console.log('PASS: reviewer address-trust field preflight self-test.');
  process.exit(0);
}

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
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

const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg?.slice('--target='.length);
if (!['sandbox', 'prod'].includes(target)) throw new Error('Missing --target=sandbox or --target=prod.');
const resourceUrl = target === 'sandbox' ? process.env.DYNAMICS_SANDBOX_URL : process.env.DYNAMICS_URL;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const tokenResponse = await fetch(`https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: DYNAMICS_CLIENT_ID,
    client_secret: DYNAMICS_CLIENT_SECRET,
    scope: `${resourceUrl}/.default`,
  }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(`Token request failed (${tokenResponse.status}).`);

const response = await fetch(
  `${resourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')`
    + `/Attributes(LogicalName='${FIELD}')/Microsoft.Dynamics.CRM.MemoAttributeMetadata`
    + '?$select=AttributeType,MaxLength,RequiredLevel,Format',
  { headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' } },
);
let outcome;
if (response.status === 404) outcome = classify(null);
else if (!response.ok) throw new Error(`Unexpected metadata response ${response.status}: ${(await response.text()).slice(0, 400)}`);
else outcome = classify(await response.json());

console.log(`${ENTITY}.${FIELD}: ${outcome.state.toUpperCase()} on target=${target}`);
for (const note of outcome.notes) console.error(`  - ${note}`);
if (outcome.state === 'divergent') process.exit(1);
console.log(`PROCEED: node scripts/apply-dataverse-schema.js --target=${target} --wave=17-reviewer-address-trust --execute`);
