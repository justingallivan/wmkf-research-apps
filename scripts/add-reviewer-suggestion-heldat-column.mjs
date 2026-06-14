/**
 * Add the `wmkf_heldat` (DateTime) column to wmkf_appreviewersuggestion.
 *
 * Reviewer "hold step" chunk 1 prereq (docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md).
 * Records WHEN a reviewer placed a hold (agreed in principle). Distinct from
 * wmkf_responsereceivedat, which finalize (held→accepted) overwrites — a
 * dedicated column preserves the hold moment for audit.
 *
 * Idempotent: probes for the attribute first and no-ops if it already exists.
 *
 * ⚠ SEQUENCING: run this (and the picklist script) BEFORE shipping any code that
 * adds `wmkf_heldat` to a $select list. Selecting a column that does not yet
 * exist returns a 400 and breaks every reviewer-suggestion read.
 *
 * No prior column-create script existed in scripts/; this mirrors the
 * probe-first/idempotent style of extend-responsetype-picklist*.mjs and uses the
 * CreateAttribute Web API (POST to the entity's Attributes collection).
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

const ENTITY = 'wmkf_appreviewersuggestion';
const SCHEMA_NAME = 'wmkf_heldat'; // logical name is the lowercased schema name
const LOGICAL_NAME = 'wmkf_heldat';

// Probe: does the attribute already exist?
const probeUrl = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='${LOGICAL_NAME}')`;
const probeResp = await fetch(probeUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
if (probeResp.ok) {
  console.log(`Attribute ${LOGICAL_NAME} already exists on ${ENTITY}. No-op.`);
  process.exit(0);
}
if (probeResp.status !== 404) {
  const text = await probeResp.text();
  console.error(`Unexpected probe response (${probeResp.status}): ${text}`);
  process.exit(1);
}

// Create the DateTime attribute. UserLocal behavior + DateAndTime format match
// the existing reviewer lifecycle timestamps (e.g. wmkf_responsereceivedat).
const createUrl = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')/Attributes`;
const createResp = await fetch(createUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'MSCRM.SolutionUniqueName': 'wmkfResearchReviewAppSuite',
  },
  body: JSON.stringify({
    '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
    SchemaName: SCHEMA_NAME,
    Format: 'DateAndTime',
    DateTimeBehavior: { Value: 'UserLocal' },
    RequiredLevel: { Value: 'None' },
    DisplayName: {
      '@odata.type': 'Microsoft.Dynamics.CRM.Label',
      LocalizedLabels: [{
        '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
        Label: 'Held At',
        LanguageCode: 1033,
      }],
    },
    Description: {
      '@odata.type': 'Microsoft.Dynamics.CRM.Label',
      LocalizedLabels: [{
        '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
        Label: 'When the reviewer placed a hold (agreed in principle). Preserved across finalize for audit.',
        LanguageCode: 1033,
      }],
    },
  }),
});

if (!createResp.ok) {
  const text = await createResp.text();
  console.error(`CreateAttribute failed (${createResp.status}): ${text}`);
  process.exit(1);
}
console.log(`CreateAttribute → HTTP ${createResp.status} (ok)`);

// Publish so the verify read reflects the change (entity metadata reads are cached
// org-wide; without a publish the verify can 404 a column that was just created — a
// stale-read false alarm, same as the picklist script's first run).
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
const verifyResp = await fetch(probeUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
if (!verifyResp.ok) {
  console.error(`\n✗ verify did not find ${LOGICAL_NAME} after publish — CreateAttribute returned ok but the `
    + 'column is absent. Re-run (the probe will report "already exists") to rule out a stale metadata read; '
    + 'if it persists, investigate before relying on the column.');
  process.exit(1);
}
console.log(`\n✓ ${LOGICAL_NAME} created on ${ENTITY} and verified`);
