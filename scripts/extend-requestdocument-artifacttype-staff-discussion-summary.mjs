/**
 * Extend wmkf_requestdocument.wmkf_artifacttype picklist with
 * `Staff Discussion Summary = 100000010`.
 *
 * Staff Discussion Summary prerequisite (paired summaries plan,
 * docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md D7; owner decision 1, Session
 * 588; V1 read confirmed the value free in Production). Sibling of
 * scripts/extend-requestdocument-artifacttype-staff-discussion-transcript.mjs
 * (100000013); each script is single-purpose and kept as the record of its
 * insert. Same shape: read the live option set, no-op if the value exists,
 * dry-run by default, InsertOptionValue inside the app solution only with
 * --execute, then re-read and verify. 100000011 stays reserved for Stage 4.
 *
 * Wave 16 record (lib/dataverse/schema/wave16-request-document-registry/
 * wmkf_requestdocument.json) mirrors this option.
 *
 * Usage:
 *   node scripts/extend-requestdocument-artifacttype-staff-discussion-summary.mjs            # dry run (reads only)
 *   node scripts/extend-requestdocument-artifacttype-staff-discussion-summary.mjs --execute  # insert + verify
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

const NEW_VALUE = 100000010;
const NEW_LABEL = 'Staff Discussion Summary';
const ENTITY = 'wmkf_requestdocument';
const ATTRIBUTE = 'wmkf_artifacttype';

const checkUrl = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='${ATTRIBUTE}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

const check = await (await fetch(checkUrl, { headers })).json();
const opts = check.OptionSet?.Options || [];
console.log(`Current ${ATTRIBUTE} options on ${new URL(baseUrl).hostname}:`);
for (const o of opts) console.log(`  ${o.Value}: ${o.Label?.UserLocalizedLabel?.Label}`);

if (opts.find((o) => o.Value === NEW_VALUE)) {
  console.log(`\nOption ${NEW_VALUE} already exists. No-op.`);
  process.exit(0);
}
if (opts.find((o) => o.Label?.UserLocalizedLabel?.Label === NEW_LABEL)) {
  console.error(`\nLabel "${NEW_LABEL}" already exists under a different value; stopping.`);
  process.exit(1);
}
if (!process.argv.includes('--execute')) {
  console.log(`\nDry run: would insert ${NEW_VALUE} "${NEW_LABEL}". Re-run with --execute.`);
  process.exit(0);
}

const insertResp = await fetch(`${baseUrl}/api/data/v9.2/InsertOptionValue`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', 'MSCRM.SolutionUniqueName': 'wmkfResearchReviewAppSuite' },
  body: JSON.stringify({
    EntityLogicalName: ENTITY,
    AttributeLogicalName: ATTRIBUTE,
    Value: NEW_VALUE,
    Label: {
      '@odata.type': 'Microsoft.Dynamics.CRM.Label',
      LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: NEW_LABEL, LanguageCode: 1033 }],
    },
  }),
});
if (!insertResp.ok) {
  console.error(`InsertOptionValue failed (${insertResp.status}): ${await insertResp.text()}`);
  process.exit(1);
}

// The metadata read is cache-served and has lagged an insert by several
// seconds in prior runs (2026-09-14 precedent), so poll briefly instead of
// trusting one immediate read.
let found = null;
let verifyOptions = [];
for (let attempt = 0; attempt < 6 && !found; attempt += 1) {
  if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
  const verify = await (await fetch(checkUrl, { headers })).json();
  verifyOptions = verify.OptionSet?.Options || [];
  found = verifyOptions.find((o) => o.Value === NEW_VALUE) || null;
}
console.log('\nAfter:');
for (const o of verifyOptions) console.log(`  ${o.Value}: ${o.Label?.UserLocalizedLabel?.Label}`);
console.log(found ? `\n✓ ${NEW_VALUE} "${NEW_LABEL}" added` : '\n✗ verify failed');
process.exit(found ? 0 : 1);
