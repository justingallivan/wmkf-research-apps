/**
 * Extend wmkf_appreviewersuggestion.wmkf_responsetype picklist with
 * `held = 100000004`.
 *
 * Reviewer "hold step" chunk 1 prereq (docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md).
 * Distinct from `accepted` (full finalize: COI/AI acks + payment + honorarium)
 * and `no_response` (timeout): `held` is "agreed in principle, sitting tight
 * until proposals are released." It never sets wmkf_accepted and never triggers
 * honorarium onboarding.
 *
 * Idempotent: if the option already exists, it's a no-op.
 *
 * Per the withdrawn_sufficient precedent (S143, extend-responsetype-picklist.mjs):
 * existing options were 100000000=Accepted, 100000001=Declined,
 * 100000002=No Response, then 100000003=Withdrawn-Sufficient. Next free
 * integer = 100000004. (This script probes the LIVE optionset and no-ops if
 * 100000004 is already taken — do not hand-assert the live value.)
 */

import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');

const baseUrl = process.env.DYNAMICS_URL;
const token = await DynamicsService.getAccessToken();

const NEW_VALUE = 100000004;
const NEW_LABEL = 'Held';

// Check current state
const checkUrl = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')/Attributes(LogicalName='wmkf_responsetype')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`;
const checkResp = await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
const check = await checkResp.json();
const opts = check.OptionSet?.Options || [];
console.log('Current options:');
for (const o of opts) {
  console.log(`  ${o.Value}: ${o.Label?.UserLocalizedLabel?.Label}`);
}

const existing = opts.find(o => o.Value === NEW_VALUE);
if (existing) {
  const label = existing.Label?.UserLocalizedLabel?.Label;
  if (label !== NEW_LABEL) {
    console.error(`\n✗ Option ${NEW_VALUE} already exists but is labelled '${label}', not '${NEW_LABEL}'. `
      + 'Refusing to no-op — the held value may be colliding with another option.');
    process.exit(1);
  }
  console.log(`\nOption ${NEW_VALUE} (${NEW_LABEL}) already exists. No-op.`);
  process.exit(0);
}

// Use InsertOptionValue action — the proper Dataverse Web API for adding options to local picklists
const insertUrl = `${baseUrl}/api/data/v9.2/InsertOptionValue`;
const insertResp = await fetch(insertUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'MSCRM.SolutionUniqueName': 'wmkfResearchReviewAppSuite',
  },
  body: JSON.stringify({
    EntityLogicalName: 'wmkf_appreviewersuggestion',
    AttributeLogicalName: 'wmkf_responsetype',
    Value: NEW_VALUE,
    Label: {
      '@odata.type': 'Microsoft.Dynamics.CRM.Label',
      LocalizedLabels: [{
        '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
        Label: NEW_LABEL,
        LanguageCode: 1033,
      }],
    },
  }),
});

// Always surface the raw InsertOptionValue response — a 2xx with no visible option
// means either a different value was assigned or the verify read hit stale metadata.
const insertBody = await insertResp.text();
console.log(`\nInsertOptionValue → HTTP ${insertResp.status}`);
console.log(`Response body: ${insertBody || '(empty)'}`);
if (!insertResp.ok) {
  console.error('InsertOptionValue failed — see body above.');
  process.exit(1);
}
// The action returns { NewOptionValue: <int> } on success — it MUST match the value we
// asked for. A drift (publisher option-value-prefix remap) means the code maps are wrong.
try {
  const parsed = JSON.parse(insertBody);
  if (parsed && parsed.NewOptionValue !== undefined && parsed.NewOptionValue !== NEW_VALUE) {
    console.error(`\n✗ Dataverse assigned NewOptionValue ${parsed.NewOptionValue}, not the requested ${NEW_VALUE}. `
      + 'The code maps (RESPONSE_TYPE_MAP/RESPONSE_TYPE_BY_VALUE) assume 100000004 — do NOT proceed.');
    process.exit(1);
  }
  if (parsed && parsed.NewOptionValue !== undefined) {
    console.log(`NewOptionValue assigned by Dataverse: ${parsed.NewOptionValue} (matches request)`);
  }
} catch { /* non-JSON body — already printed above */ }

// Publish so the metadata read below reflects the change (entity metadata reads are
// cached org-wide; without a publish the verify can return a stale optionset).
const pubResp = await fetch(`${baseUrl}/api/data/v9.2/PublishAllXml`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
});
console.log(`PublishAllXml → HTTP ${pubResp.status}`);
if (!pubResp.ok) {
  console.error(`✗ PublishAllXml failed (${pubResp.status}): ${await pubResp.text()}`);
  process.exit(1);
}

// Verify
const verifyResp = await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
const verify = await verifyResp.json();
console.log('\nAfter:');
for (const o of verify.OptionSet?.Options || []) {
  console.log(`  ${o.Value}: ${o.Label?.UserLocalizedLabel?.Label}`);
}
const found = (verify.OptionSet?.Options || []).find(o => o.Value === NEW_VALUE);
if (!found) {
  console.error(`\n✗ verify still does not show ${NEW_VALUE} after publish — InsertOptionValue returned ok `
    + 'but the option is absent. Investigate before relying on it.');
  process.exit(1);
}
console.log(`\n✓ ${NEW_VALUE} (${NEW_LABEL}) added and verified`);
