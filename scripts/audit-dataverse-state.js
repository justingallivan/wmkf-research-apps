#!/usr/bin/env node
/**
 * Audit live Dataverse state for the entities the app suite uses.
 *
 *   - Custom entities (`wmkf_app*`): row count, primary fields, alt keys.
 *   - Vendor entities with extension fields: probe a sample for field
 *     population (akoya_request, contact, account, wmkf_potentialreviewers,
 *     wmkf_appreviewersuggestions if surfaced as vendor extension).
 *
 * Read-only. Capture results to seed the Application State Atlas.
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

async function getToken() {
  const tenant = process.env.DYNAMICS_TENANT_ID;
  const clientId = process.env.DYNAMICS_CLIENT_ID;
  const secret = process.env.DYNAMICS_CLIENT_SECRET;
  const resource = process.env.DYNAMICS_URL;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret,
      scope: `${resource}/.default`,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function odataGet(token, urlPath) {
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Prefer: 'odata.maxpagesize=500',
    },
  });
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
}

// Using $count via header is more reliable than $count=true on big tables.
async function countRecords(token, entitySet, filter) {
  const q = filter ? `?$filter=${encodeURIComponent(filter)}` : '';
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/${entitySet}${q}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*",odata.maxpagesize=1',
    },
  });
  if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 200)}` };
  // Use $count separately
  const c = await fetch(
    `${process.env.DYNAMICS_URL}/api/data/v9.2/${entitySet}/$count${filter ? `?$filter=${encodeURIComponent(filter)}` : ''}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/plain',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      },
    },
  );
  if (!c.ok) return { error: `count: ${c.status} ${(await c.text()).slice(0, 200)}` };
  return { count: parseInt(await c.text(), 10) };
}

const CUSTOM_ENTITIES = [
  // Wave 2 — reviewer finder. (S213: the wmkf_appresearcher bibliometric sidecar +
  // wmkf_apppublication/author tables were collapsed into wmkf_potentialreviewers
  // and DROPPED — see docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md.)
  { entitySet: 'wmkf_appreviewersuggestions', describe: 'Suggestion lifecycle ledger ((reviewer, request) pairs)' },
  { entitySet: 'wmkf_appgrantcycles', describe: 'Grant cycle definitions (per Wave 2 schema-as-code)' },
  // NOTE unconventional plural: entity-set is `wmkf_appproposalsearchs` (no `e` before `s`)
  // because the singular logical name is `wmkf_appproposalsearch` (auto-pluralized).
  // S188 audit caught the script previously using `wmkf_appproposalsearches` and 404-ing.
  { entitySet: 'wmkf_appproposalsearchs', describe: 'Proposal search history (per Wave 2 schema-as-code)' },
  // INTENTIONALLY NOT DEPLOYED per docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:113 —
  // zero data on both sides + the consuming researchers.js admin UI was retired.
  // Probe stays as a presence-confirmation guard: a 404 here is the EXPECTED state;
  // a 200 would signal someone deployed it without updating the atlas.
  { entitySet: 'wmkf_app_z_publication_authors', describe: 'Publication ↔ researcher junction (EXPECTED 404 — not deployed)' },
  // Wave 1 — user/access foundation (live entity sets, no underscore between app and <name>)
  { entitySet: 'wmkf_appsystemsettings', describe: 'Wave 1: system_settings → Dataverse (flag flipped 2026-05-03)' },
  { entitySet: 'wmkf_appuserpreferences', describe: 'Wave 1: user_preferences → Dataverse' },
  { entitySet: 'wmkf_appuserappaccesses', describe: 'Wave 1: user_app_access → Dataverse' },
  // Vendor entities with extensions
  { entitySet: 'wmkf_potentialreviewerses', describe: 'Vendor person record (Connor) — has extension fields' },
];

// Picked these as the load-bearing vendor entities the app reads/writes.
const VENDOR_ENTITIES = [
  { entitySet: 'akoya_requests', describe: 'Grant request (master record)' },
  { entitySet: 'contacts', describe: 'CRM contact (reviewer promotion target)' },
  { entitySet: 'accounts', describe: 'Organization (institutional contacts pivot)' },
  { entitySet: 'systemusers', describe: 'Internal staff users' },
  { entitySet: 'wmkf_ai_prompts', describe: 'Prompt rows for Executor contract' },
  { entitySet: 'wmkf_ai_runs', describe: 'AI run audit ledger' },
];

async function main() {
  console.log(`Dataverse host: ${process.env.DYNAMICS_URL}\n`);
  const token = await getToken();

  console.log('=== CUSTOM ENTITIES ===\n');
  for (const e of CUSTOM_ENTITIES) {
    const r = await countRecords(token, e.entitySet);
    if (r.error) {
      console.log(`  ${e.entitySet.padEnd(40)} ERR ${r.error.slice(0, 80)}`);
    } else {
      console.log(`  ${e.entitySet.padEnd(40)} ${String(r.count).padStart(7)} rows  — ${e.describe}`);
    }
  }

  console.log('\n=== VENDOR ENTITIES ===\n');
  for (const e of VENDOR_ENTITIES) {
    const r = await countRecords(token, e.entitySet);
    if (r.error) {
      console.log(`  ${e.entitySet.padEnd(40)} ERR ${r.error.slice(0, 80)}`);
    } else {
      console.log(`  ${e.entitySet.padEnd(40)} ${String(r.count).padStart(7)} rows  — ${e.describe}`);
    }
  }

  // Probe for extension fields by hitting one record from each load-bearing entity
  console.log('\n=== EXTENSION FIELD PROBE (sample 1 row, list non-null wmkf_*/akoya_* fields) ===\n');
  const probeTargets = [
    { entitySet: 'wmkf_potentialreviewerses', primary: 'wmkf_potentialreviewersid' },
    { entitySet: 'wmkf_appreviewersuggestions', primary: 'wmkf_appreviewersuggestionid' },
    { entitySet: 'akoya_requests', primary: 'akoya_requestid', filter: 'wmkf_ai_summary ne null' },
  ];

  for (const p of probeTargets) {
    const url = `/${p.entitySet}?$top=1${p.filter ? `&$filter=${encodeURIComponent(p.filter)}` : ''}`;
    const r = await odataGet(token, url);
    if (r.status !== 200) {
      console.log(`\n  ${p.entitySet}: ERR ${r.status} ${String(r.body).slice(0, 120)}`);
      continue;
    }
    const row = r.body.value && r.body.value[0];
    if (!row) {
      console.log(`\n  ${p.entitySet}: no rows match probe filter`);
      continue;
    }
    console.log(`\n  ${p.entitySet} — sample row keys (${Object.keys(row).length} total):`);
    const keys = Object.keys(row).filter(k => !k.startsWith('@') && row[k] !== null && row[k] !== '');
    for (const k of keys.sort()) {
      const v = row[k];
      const display = typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v;
      console.log(`    ${k.padEnd(50)} ${typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? display : typeof v}`);
    }
  }

  // Confirm wmkf_appgrantcycle "claimed but missing" fields
  console.log('\n=== wmkf_appgrantcycles SCHEMA PROBE ===\n');
  const acgcSchema = await odataGet(
    token,
    `/EntityDefinitions(LogicalName='wmkf_appgrantcycle')/Attributes?$select=LogicalName,AttributeType&$filter=startswith(LogicalName,'wmkf_')`,
  );
  if (acgcSchema.status === 200) {
    for (const a of acgcSchema.body.value) {
      console.log(`  ${a.LogicalName.padEnd(40)} ${a.AttributeType}`);
    }
  } else {
    console.log(`  ERR ${acgcSchema.status} ${String(acgcSchema.body).slice(0, 120)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
