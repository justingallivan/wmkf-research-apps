#!/usr/bin/env node

/**
 * Pre-deploy metadata probe for the Grantee Deliverables Portal field wave on
 * `akoya_request` (lib/dataverse/schema/wave2-grantee-deliverables/).
 *
 * WHY this exists: schema-apply is CREATION-ONLY (lib/dataverse/schema-apply.js
 * header + ensureAttribute) — it will NOT reconcile a divergent pre-existing
 * field. A generic probe can't be used: it would need to treat ABSENT as a
 * failure, but absent is the ALLOWED creation path here. So this wrapper checks
 * EACH field in the wave and uses a 3-way exit contract over the aggregate.
 *
 * Fields checked (logical names; schemaNames PascalCase in the wave JSON):
 *   wmkf_abstractformatted        Memo
 *   wmkf_abstractapproved         Memo
 *   wmkf_granteeimagefileref      String (Url)
 *   wmkf_granteeimagecaption      Memo
 *   wmkf_granteedeliverablestatus Picklist (option set from shared config)
 *
 * Exit contract (aggregate):
 *   0  PROCEED — every field is ABSENT (schema-apply will create it) and/or
 *               EXISTS EXACTLY as expected (idempotent no-op).
 *   1  ABORT   — at least one field EXISTS but DIVERGES (wrong type, maxLength,
 *               format, or option set). schema-apply cannot reconcile it; fix
 *               manually in Dataverse first.
 *   2  ERROR   — usage / missing credentials / network / unexpected response.
 *
 * Usage:
 *   node scripts/preflight-grantee-deliverables-fields.mjs                 # prod (DYNAMICS_URL)
 *   node scripts/preflight-grantee-deliverables-fields.mjs --target=sandbox
 *
 * Read-only — metadata GETs against EntityDefinitions; no writes.
 * Reads Dynamics credentials from .env / .env.local.
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

const ENTITY = 'akoya_request';

// Expected fields. Each: logical name, AttributeType, the typed-cast segment for
// deep props, and the props we compare. Picklist options are derived from the
// shared constants (never inlined).
const EXPECTED_FIELDS = [
  { logical: 'wmkf_abstractformatted', attributeType: 'Memo', cast: 'MemoAttributeMetadata', maxLength: 32000 },
  { logical: 'wmkf_abstractapproved', attributeType: 'Memo', cast: 'MemoAttributeMetadata', maxLength: 32000 },
  { logical: 'wmkf_granteeimagefileref', attributeType: 'String', cast: 'StringAttributeMetadata', maxLength: 1000, format: 'Url' },
  { logical: 'wmkf_granteeimagecaption', attributeType: 'Memo', cast: 'MemoAttributeMetadata', maxLength: 4000 },
  {
    logical: 'wmkf_granteedeliverablestatus',
    attributeType: 'Picklist',
    cast: 'PicklistAttributeMetadata',
    options: new Map(
      Object.values(GRANTEE_DELIVERABLE_STATUS).map((v) => [v, GRANTEE_DELIVERABLE_LABEL[v]]),
    ),
  },
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

/**
 * Probe one field. Returns { state: 'absent'|'exact'|'divergent', notes: [] }.
 * Throws on unexpected (non-404) HTTP errors so the caller can exit(2).
 */
async function probeField(token, field) {
  // $select must be type-correct: PicklistAttributeMetadata has no MaxLength,
  // and MemoAttributeMetadata exposes `Format` (not String's `FormatName`).
  // Selecting a property the cast type lacks 400s instead of 404-ing on absence.
  let select;
  if (field.attributeType === 'Picklist') {
    select = '$select=LogicalName,AttributeType&$expand=OptionSet';
  } else if (field.attributeType === 'String') {
    select = '$select=LogicalName,AttributeType,MaxLength,FormatName';
  } else {
    // Memo (and any other simple length-bearing type)
    select = '$select=LogicalName,AttributeType,MaxLength';
  }
  const url =
    `${resourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')` +
    `/Attributes(LogicalName='${field.logical}')` +
    `/Microsoft.Dynamics.CRM.${field.cast}?${select}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });

  if (r.status === 404) return { state: 'absent', notes: [] };
  if (!r.ok) {
    throw new Error(`unexpected response probing ${ENTITY}.${field.logical} (${r.status}): ${(await r.text()).slice(0, 400)}`);
  }

  const data = await r.json();
  const notes = [];

  // Type mismatch: the typed cast still returns the row, but AttributeType reveals
  // a different underlying type → unreconcilable.
  if (data.AttributeType && data.AttributeType !== field.attributeType) {
    notes.push(`type is '${data.AttributeType}', expected '${field.attributeType}'`);
  }

  if (field.maxLength != null && data.MaxLength != null && data.MaxLength !== field.maxLength) {
    notes.push(`MaxLength ${data.MaxLength} != expected ${field.maxLength}`);
  }

  if (field.format) {
    const fmt = data.FormatName?.Value;
    if (fmt && fmt !== field.format) notes.push(`FormatName '${fmt}' != expected '${field.format}'`);
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

  return { state: notes.length === 0 ? 'exact' : 'divergent', notes };
}

async function main() {
  const token = await getToken();

  const results = [];
  for (const field of EXPECTED_FIELDS) {
    const res = await probeField(token, field);
    results.push({ field, res });
  }

  const absent = results.filter((r) => r.res.state === 'absent');
  const exact = results.filter((r) => r.res.state === 'exact');
  const divergent = results.filter((r) => r.res.state === 'divergent');

  console.log(`Grantee-deliverables field preflight on ${ENTITY} (target=${target}):`);
  for (const { field, res } of results) {
    const tag = res.state.toUpperCase().padEnd(9);
    console.log(`  ${tag} ${field.logical}`);
    for (const n of res.notes) console.log(`            - ${n}`);
  }
  console.log(`Summary: ${absent.length} absent, ${exact.length} exact, ${divergent.length} divergent.`);

  if (divergent.length > 0) {
    console.error('ABORT: at least one field EXISTS but DIVERGES from the wave spec.');
    console.error('schema-apply is creation-only and will NOT reconcile these. Reconcile manually in Dataverse before deploying.');
    process.exit(1);
  }

  console.log('PROCEED: every field is absent or matches exactly.');
  if (absent.length > 0) {
    console.log(`  Next: node scripts/apply-dataverse-schema.js --target=${target} --wave=2-grantee-deliverables --execute`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e?.message || e);
  process.exit(2);
});
