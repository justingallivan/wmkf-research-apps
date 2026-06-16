#!/usr/bin/env node

/**
 * Pre-deploy metadata probe for the Workbench triage field
 * (`akoya_request.wmkf_triagestatus`).
 *
 * WHY this exists (Codex r2 RISK C): schema-apply is CREATION-ONLY
 * (lib/dataverse/schema-apply.js:264) — it will NOT reconcile a divergent
 * pre-existing field. `scripts/probe-picklist.js` can't be used directly as the
 * preflight: it exits non-zero when the field is ABSENT, but absent is the
 * ALLOWED creation path here. So this wrapper has a 3-way exit contract.
 *
 * Exit contract:
 *   0  PROCEED — field is ABSENT (schema-apply will create it), OR
 *               field EXISTS with EXACTLY the expected option set (idempotent no-op).
 *   1  ABORT   — field EXISTS with a DIVERGENT option set. schema-apply cannot
 *               reconcile it; manual reconciliation in Dataverse is required.
 *   2  ERROR   — usage / missing credentials / network / unexpected response.
 *
 * Usage:
 *   node scripts/preflight-triagestatus-field.mjs                 # prod (DYNAMICS_URL)
 *   node scripts/preflight-triagestatus-field.mjs --target=sandbox
 *
 * Read-only — metadata GET against EntityDefinitions; no writes.
 * Reads Dynamics credentials from .env / .env.local.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TRIAGE_STATUS, TRIAGE_LABEL } from '../shared/config/triageStatus.js';

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
const FIELD = 'wmkf_triagestatus';

const target = (process.argv.slice(2).find((a) => a.startsWith('--target=')) || '--target=prod')
  .slice('--target='.length);

const resourceUrl =
  target === 'sandbox' ? process.env.DYNAMICS_SANDBOX_URL : process.env.DYNAMICS_URL;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;

if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error(`ERROR: missing Dynamics credentials for target=${target} (need DYNAMICS_${target === 'sandbox' ? 'SANDBOX_' : ''}URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET).`);
  process.exit(2);
}

// Expected option set, derived from the shared constants (never inlined).
const expected = new Map(
  Object.values(TRIAGE_STATUS).map((v) => [v, TRIAGE_LABEL[v]]),
);

async function main() {
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

  const url =
    `${resourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')` +
    `/Attributes(LogicalName='${FIELD}')` +
    `/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });

  // ABSENT — the allowed creation path.
  if (r.status === 404) {
    console.log(`PROCEED: ${ENTITY}.${FIELD} is ABSENT on target=${target}. schema-apply will create it.`);
    console.log('  Next: node scripts/apply-dataverse-schema.js --target=' + target + ' --wave=2-triagestatus --execute');
    process.exit(0);
  }

  if (!r.ok) {
    console.error(`ERROR: unexpected response probing ${ENTITY}.${FIELD} (${r.status}): ${(await r.text()).slice(0, 400)}`);
    console.error('  (A non-404 failure is NOT treated as absent — refusing to assume the creation path.)');
    process.exit(2);
  }

  const data = await r.json();
  const options = data.OptionSet?.Options || [];
  const found = new Map();
  for (const o of options) {
    found.set(o.Value, o.Label?.UserLocalizedLabel?.Label ?? '?');
  }

  console.log(`${ENTITY}.${FIELD} EXISTS on target=${target} with ${found.size} option(s):`);
  for (const [v, label] of found) console.log(`  ${String(v).padEnd(12)} ${label}`);

  // Compare against the expected set (values AND labels, both directions).
  const divergences = [];
  for (const [v, label] of expected) {
    if (!found.has(v)) divergences.push(`missing expected option ${v} '${label}'`);
    else if (found.get(v) !== label) divergences.push(`option ${v} label '${found.get(v)}' != expected '${label}'`);
  }
  for (const [v, label] of found) {
    if (!expected.has(v)) divergences.push(`unexpected option ${v} '${label}'`);
  }

  if (divergences.length === 0) {
    console.log(`PROCEED: option set matches exactly. schema-apply is an idempotent no-op (safe to run or skip).`);
    process.exit(0);
  }

  console.error('ABORT: option set DIVERGES from the expected set:');
  for (const d of divergences) console.error('  - ' + d);
  console.error('schema-apply is creation-only and will NOT reconcile this. Reconcile manually in Dataverse before deploying.');
  process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e?.message || e);
  process.exit(2);
});
