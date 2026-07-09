/**
 * Seed one wmkf_policy parent (`grantee-waiver`) plus one Active
 * wmkf_policyversion child. Idempotent: matches the parent by wmkf_code; if a
 * child already exists for the version label it leaves it alone and only flips
 * wmkf_activeversion if missing.
 *
 * The initial body is lifted VERBATIM from the hardcoded WAIVER_LABEL constant
 * in shared/components/external/GranteeDeliverableForm.js (owner-provided, S278),
 * so seeding does not change the wording grantees see — it just moves the source
 * of truth into the versioned policy machinery.
 *
 * IMPORTANT: this script must NOT be re-run with a new body to "update" an
 * existing version row. Per policy immutability, body changes are made by staff
 * publishing a NEW version from the admin Policies section (which flips
 * wmkf_activeversion and retires the prior row). This script is first-seed only.
 *
 * Usage:
 *   node scripts/seed-grantee-waiver-policy.mjs
 * (reads .env.local; writes to whatever Dynamics env those creds point at)
 */

import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

// Lifted verbatim from shared/components/external/GranteeDeliverableForm.js WAIVER_LABEL.
// Keep byte-identical to the constant at seed time so the initial version matches
// what grantees have been consenting to.
const WAIVER_BODY =
  "By submitting, I give the W. M. Keck Foundation permission to publish the abstract, project title, my name and institution, and the image and caption I provide here in materials announcing this award, in print and online. I further confirm that I have the right to share the image I've uploaded.";

const VERSION_LABEL = '2026-07-09';

const SLOT = {
  code: 'grantee-waiver',
  displayName: 'Grantee Publication Waiver',
  description: 'Publication-consent waiver acknowledged by the grantee at deliverable submit. Surfaced on /external/grantee/[token]; the acknowledged version is pinned on the wmkf_granteedeliverable row (wmkf_WaiverPolicyVersion + wmkf_waiverackedat).',
  title: 'Publication Consent Waiver',
  body: WAIVER_BODY,
};

await bypassDynamicsRestrictions('seed-grantee-waiver-policy', async () => {
  console.log(`\n── ${SLOT.code} ──`);

  // 1) Find or create the parent slot.
  const existingParents = await DynamicsService.queryRecords('wmkf_policies', {
    select: ['wmkf_policyid', 'wmkf_code', 'wmkf_displayname', '_wmkf_activeversion_value'],
    filter: `wmkf_code eq '${SLOT.code}'`,
    top: 1,
  });
  const parentRecords = existingParents.value || existingParents.records || [];

  let parentId;
  if (parentRecords.length > 0) {
    parentId = parentRecords[0].wmkf_policyid;
    console.log(`· parent exists ${parentId}`);
  } else {
    const created = await DynamicsService.createRecord('wmkf_policies', {
      wmkf_code: SLOT.code,
      wmkf_displayname: SLOT.displayName,
      wmkf_description: SLOT.description,
    });
    parentId = created.wmkf_policyid || created.id;
    console.log(`✓ parent created ${parentId}`);
  }

  // 2) Find or create the version child for this label.
  const existingVersions = await DynamicsService.queryRecords('wmkf_policyversions', {
    select: ['wmkf_policyversionid', 'wmkf_versionlabel', 'wmkf_policytitle'],
    filter: `_wmkf_policy_value eq ${parentId} and wmkf_versionlabel eq '${VERSION_LABEL}'`,
    top: 1,
  });
  const versionRecords = existingVersions.value || existingVersions.records || [];

  let versionId;
  if (versionRecords.length > 0) {
    versionId = versionRecords[0].wmkf_policyversionid;
    console.log(`· version ${VERSION_LABEL} exists ${versionId}`);
  } else {
    const createdVersion = await DynamicsService.createRecord('wmkf_policyversions', {
      wmkf_versionlabel: VERSION_LABEL,
      wmkf_policytitle: SLOT.title,
      wmkf_policybody: SLOT.body,
      wmkf_effectivedate: new Date().toISOString(),
      'wmkf_Policy@odata.bind': `/wmkf_policies(${parentId})`,
    });
    versionId = createdVersion.wmkf_policyversionid || createdVersion.id;
    console.log(`✓ version created ${versionId}`);
  }

  // 3) Point the parent's active_version lookup at the version if missing/different.
  const currentActiveValue = parentRecords[0]?.['_wmkf_activeversion_value'];
  if (currentActiveValue === versionId) {
    console.log(`· active_version already points at ${versionId}`);
  } else {
    await DynamicsService.updateRecord('wmkf_policies', parentId, {
      'wmkf_ActiveVersion@odata.bind': `/wmkf_policyversions(${versionId})`,
    });
    console.log(`✓ active_version → ${versionId}`);
  }

  console.log('\nDone. Verify with: node scripts/probe-grantee-waiver-slot.mjs');
});
