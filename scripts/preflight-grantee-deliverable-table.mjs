#!/usr/bin/env node

/**
 * Pre-deploy metadata probe for the grantee deliverable package table wave:
 * lib/dataverse/schema/wave3-grantee-deliverable-table/.
 *
 * Exit contract:
 *   0  PROCEED — entity/fields/relationship/key are absent or exact.
 *   1  ABORT   — at least one existing artifact diverges from the expected spec.
 *   2  ERROR   — usage / missing credentials / network / unexpected response.
 *
 * Usage:
 *   node scripts/preflight-grantee-deliverable-table.mjs
 *   node scripts/preflight-grantee-deliverable-table.mjs --target=sandbox
 *
 * Read-only — metadata GETs against EntityDefinitions; no writes.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GRANTEE_DELIVERABLE_STATUS,
  GRANTEE_DELIVERABLE_LABEL,
} from '../shared/config/granteeDeliverableStatus.js';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const ENTITY = 'wmkf_granteedeliverable';
const RELATIONSHIP = 'wmkf_granteedeliverable_request';
const ALT_KEY = 'wmkf_granteedeliverable_request_key';

const EXPECTED_FIELDS = [
  {
    logical: 'wmkf_deliverablestatus',
    attributeType: 'Picklist',
    cast: 'PicklistAttributeMetadata',
    options: new Map(
      Object.values(GRANTEE_DELIVERABLE_STATUS).map((v) => [v, GRANTEE_DELIVERABLE_LABEL[v]]),
    ),
  },
  { logical: 'wmkf_imagefileref', attributeType: 'String', cast: 'StringAttributeMetadata', maxLength: 1000, format: 'Url' },
  { logical: 'wmkf_imagecaption', attributeType: 'Memo', cast: 'MemoAttributeMetadata', maxLength: 4000 },
  { logical: 'wmkf_inviteddate', attributeType: 'DateTime', cast: 'DateTimeAttributeMetadata', format: 'DateAndTime' },
  { logical: 'wmkf_remindeddate', attributeType: 'DateTime', cast: 'DateTimeAttributeMetadata', format: 'DateAndTime' },
  { logical: 'wmkf_request', attributeType: 'Lookup', cast: 'LookupAttributeMetadata' },
];

const target = (process.argv.slice(2).find((a) => a.startsWith('--target=')) || '--target=prod')
  .slice('--target='.length);

const resourceUrl =
  target === 'sandbox' ? process.env.DYNAMICS_SANDBOX_URL : process.env.DYNAMICS_URL;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;

if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error(`ERROR: missing Dynamics credentials for target=${target} (need DYNAMICS_${target === 'sandbox' ? 'SANDBOX_' : ''}URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET).`);
  process.exit(2);
}

async function getToken() {
  const tokenResp = await fetch(
    `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DYNAMICS_CLIENT_ID,
        client_secret: DYNAMICS_CLIENT_SECRET,
        scope: `${resourceUrl}/.default`,
      }).toString(),
    },
  );
  const token = (await tokenResp.json()).access_token;
  if (!token) {
    console.error('ERROR: failed to acquire Dynamics token.');
    process.exit(2);
  }
  return token;
}

async function getJson(token, path) {
  const r = await fetch(`${resourceUrl}/api/data/v9.2${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (r.status === 404) return { status: 404, body: null };
  const text = await r.text();
  if (!r.ok) throw new Error(`unexpected response ${r.status} for ${path}: ${text.slice(0, 400)}`);
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function probeEntity(token) {
  const r = await getJson(token, `/EntityDefinitions(LogicalName='${ENTITY}')?$select=LogicalName,OwnershipType,PrimaryNameAttribute`);
  if (r.status === 404) return { state: 'absent', notes: [] };
  const notes = [];
  if (r.body?.OwnershipType !== 'OrganizationOwned') {
    notes.push(`OwnershipType '${r.body?.OwnershipType}' != expected 'OrganizationOwned'`);
  }
  if (r.body?.PrimaryNameAttribute !== 'wmkf_name') {
    notes.push(`PrimaryNameAttribute '${r.body?.PrimaryNameAttribute}' != expected 'wmkf_name'`);
  }
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

async function probeField(token, field) {
  let select;
  if (field.attributeType === 'Picklist') select = '$select=LogicalName,AttributeType&$expand=OptionSet';
  else if (field.attributeType === 'String') select = '$select=LogicalName,AttributeType,MaxLength,FormatName';
  else if (field.attributeType === 'Memo') select = '$select=LogicalName,AttributeType,MaxLength';
  else if (field.attributeType === 'DateTime') select = '$select=LogicalName,AttributeType,Format';
  else select = '$select=LogicalName,AttributeType';

  const r = await getJson(
    token,
    `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='${field.logical}')/Microsoft.Dynamics.CRM.${field.cast}?${select}`,
  );
  if (r.status === 404) return { state: 'absent', notes: [] };

  const data = r.body || {};
  const notes = [];
  if (data.AttributeType && data.AttributeType !== field.attributeType) {
    notes.push(`type is '${data.AttributeType}', expected '${field.attributeType}'`);
  }
  if (field.maxLength != null && data.MaxLength != null && data.MaxLength !== field.maxLength) {
    notes.push(`MaxLength ${data.MaxLength} != expected ${field.maxLength}`);
  }
  if (field.format) {
    const fmt = data.FormatName?.Value || data.Format;
    if (fmt && fmt !== field.format) notes.push(`format '${fmt}' != expected '${field.format}'`);
  }
  if (field.options) {
    const found = new Map();
    for (const o of (data.OptionSet?.Options || [])) {
      found.set(o.Value, o.Label?.UserLocalizedLabel?.Label ?? '?');
    }
    for (const [v, label] of field.options) {
      if (!found.has(v)) notes.push(`missing expected option ${v} '${label}'`);
      else if (found.get(v) !== label) notes.push(`option ${v} label '${found.get(v)}' != expected '${label}'`);
    }
    for (const [v, label] of found) {
      if (!field.options.has(v)) notes.push(`unexpected option ${v} '${label}'`);
    }
  }
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

async function probeRelationship(token) {
  const r = await getJson(token, `/RelationshipDefinitions(SchemaName='${RELATIONSHIP}')?$select=SchemaName,ReferencedEntity,ReferencingEntity`);
  if (r.status === 404) return { state: 'absent', notes: [] };
  const notes = [];
  if (r.body?.ReferencedEntity !== 'akoya_request') notes.push(`ReferencedEntity '${r.body?.ReferencedEntity}' != expected 'akoya_request'`);
  if (r.body?.ReferencingEntity !== ENTITY) notes.push(`ReferencingEntity '${r.body?.ReferencingEntity}' != expected '${ENTITY}'`);
  return { state: notes.length ? 'divergent' : 'exact', notes };
}

async function probeKey(token) {
  const r = await getJson(token, `/EntityDefinitions(LogicalName='${ENTITY}')/Keys?$select=SchemaName,KeyAttributes`);
  if (r.status === 404) return { state: 'absent', notes: [] };
  const found = (r.body?.value || []).find((k) => k.SchemaName === ALT_KEY);
  if (!found) return { state: 'absent', notes: [] };
  const attrs = found.KeyAttributes || [];
  const ok = attrs.length === 1 && attrs[0] === 'wmkf_request';
  return ok
    ? { state: 'exact', notes: [] }
    : { state: 'divergent', notes: [`KeyAttributes [${attrs.join(', ')}] != expected [wmkf_request]`] };
}

async function main() {
  const token = await getToken();
  const results = [
    { name: ENTITY, res: await probeEntity(token) },
  ];
  for (const field of EXPECTED_FIELDS) {
    results.push({ name: `${ENTITY}.${field.logical}`, res: await probeField(token, field) });
  }
  results.push({ name: `relationship:${RELATIONSHIP}`, res: await probeRelationship(token) });
  results.push({ name: `key:${ALT_KEY}`, res: await probeKey(token) });

  const absent = results.filter((r) => r.res.state === 'absent');
  const exact = results.filter((r) => r.res.state === 'exact');
  const divergent = results.filter((r) => r.res.state === 'divergent');

  console.log(`Grantee-deliverable table preflight on ${ENTITY} (target=${target}):`);
  for (const { name, res } of results) {
    const tag = res.state.toUpperCase().padEnd(9);
    console.log(`  ${tag} ${name}`);
    for (const n of res.notes) console.log(`            - ${n}`);
  }
  console.log(`Summary: ${absent.length} absent, ${exact.length} exact, ${divergent.length} divergent.`);

  if (divergent.length > 0) {
    console.error('ABORT: at least one artifact EXISTS but DIVERGES from the wave spec.');
    console.error('schema-apply is creation-only and will NOT reconcile these. Reconcile manually in Dataverse before deploying.');
    process.exit(1);
  }

  console.log('PROCEED: every artifact is absent or matches exactly.');
  if (absent.length > 0) {
    console.log(`  Next: node scripts/apply-dataverse-schema.js --target=${target} --wave=3-grantee-deliverable-table --execute`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e?.message || e);
  process.exit(2);
});
