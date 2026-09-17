/**
 * Extend wmkf_requestdocument.wmkf_artifacttype picklist with
 * `Pre-Research Presentation Brief = 100000009`.
 *
 * Pre-Research Presentation Brief slice 1 prerequisite
 * (docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §3, §5
 * slice 1). Sibling of scripts/extend-requestdocument-artifacttype.mjs
 * (which added Consultant Feedback = 100000008 at S512) — that script is
 * kept as the record of that insert and is not edited in place (plan §7
 * finding "extend script is single-purpose"). Same shape: read the live
 * option set, no-op if the value exists, dry-run by default,
 * InsertOptionValue inside the app solution only with --execute, then
 * re-read and verify.
 *
 * Wave 16 options (lib/dataverse/schema/wave16-request-document-registry/
 * wmkf_requestdocument.json): 100000000..100000008. Next free integer = 100000009.
 *
 * Usage:
 *   node scripts/extend-requestdocument-artifacttype-pre-rp-brief.mjs            # dry run (reads only)
 *   node scripts/extend-requestdocument-artifacttype-pre-rp-brief.mjs --execute  # insert + verify
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

const NEW_VALUE = 100000009;
const NEW_LABEL = 'Pre-Research Presentation Brief';
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
