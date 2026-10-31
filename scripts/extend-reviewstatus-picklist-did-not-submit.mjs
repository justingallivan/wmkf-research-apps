/**
 * Owner-gated provisioning helper for
 * wmkf_appreviewersuggestion.wmkf_reviewstatus:
 *   did_not_submit = 100000007 ("Did not submit")
 * (docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md, decision A).
 * Adapted from scripts/extend-reviewstatus-picklist-terminal.mjs.
 *
 * DO NOT run as part of a deploy. This mutates Dataverse metadata and requires
 * separate owner approval for each target environment.
 *
 * Usage:
 *   node scripts/extend-reviewstatus-picklist-did-not-submit.mjs --target=sandbox
 *   node scripts/extend-reviewstatus-picklist-did-not-submit.mjs --target=sandbox --execute
 *   node scripts/extend-reviewstatus-picklist-did-not-submit.mjs --target=prod
 *   DATAVERSE_PROD_WRITE_ACK="did not submit option $(date -u +%F)" \
 *     node scripts/extend-reviewstatus-picklist-did-not-submit.mjs --target=prod --execute
 *
 * Without --execute it only reads and prints what it would add. Production
 * runs need DATAVERSE_TARGET_INTERLOCK=on and DATAVERSE_ALLOW_PROD_READS=yes,
 * and --execute also needs a same-UTC-day DATAVERSE_PROD_WRITE_ACK
 * (scripts/lib/dataverse-script-target.cjs). Every call goes through
 * lib/dataverse/client.js, so the target interlock guards each one.
 *
 * Safety contract:
 * - print and inspect the live option set first;
 * - refuse value/label collisions and duplicate labels at another value;
 * - require the missing declared values to be exactly the next free values;
 * - assert InsertOptionValue.NewOptionValue equals the requested value;
 * - publish only wmkf_appreviewersuggestion (PublishXml, not PublishAllXml,
 *   which would also publish anyone else's pending customizations);
 * - re-read and verify the option;
 * - a second run is a clean no-op.
 */

import { DID_NOT_SUBMIT_REVIEW_STATUS_VALUE } from '../shared/config/reviewerOutcome.js';
const solutionName = 'wmkfResearchReviewAppSuite';
const desired = [
  { key: 'did_not_submit', value: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE, label: 'Did not submit' },
];
const ENTITY = 'wmkf_appreviewersuggestion';
const OPTIONS_PATH = `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='wmkf_reviewstatus')`
  + '/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet';

async function readOptions(client) {
  const response = await client.get(OPTIONS_PATH);
  if (!response.ok) {
    throw new Error(`Review Status metadata read failed (${response.status}): ${response.text}`);
  }
  return response.body?.OptionSet?.Options || [];
}

function labelOf(option) {
  return option?.Label?.UserLocalizedLabel?.Label || null;
}

function printOptions(options, heading) {
  console.log(heading);
  for (const option of options) console.log(`  ${option.Value}: ${labelOf(option)}`);
}

function assertNoCollisions(options) {
  for (const wanted of desired) {
    const byValue = options.find((option) => option.Value === wanted.value);
    if (byValue && labelOf(byValue) !== wanted.label) {
      throw new Error(
        `Option ${wanted.value} already exists as '${labelOf(byValue)}', not '${wanted.label}'. Refusing to continue.`,
      );
    }
    const byLabel = options.find((option) => labelOf(option) === wanted.label && option.Value !== wanted.value);
    if (byLabel) {
      throw new Error(
        `Label '${wanted.label}' already exists at ${byLabel.Value}, not ${wanted.value}. Refusing to continue.`,
      );
    }
  }
}

function nextFreeValue(options) {
  const values = options.map((option) => option.Value).filter(Number.isInteger);
  if (values.length === 0) throw new Error('Live Review Status option set is empty; refusing to guess a starting value.');
  return Math.max(...values) + 1;
}

function planMissingOptions(options) {
  assertNoCollisions(options);
  const missing = desired.filter((wanted) => !options.some((option) => option.Value === wanted.value));
  const simulated = [...options];
  for (const wanted of missing) {
    const next = nextFreeValue(simulated);
    if (next !== wanted.value) {
      throw new Error(
        `Live next free Review Status value is ${next}, but ${wanted.key} is declared as ${wanted.value}. `
        + 'Refusing to insert or silently remap runtime code.',
      );
    }
    simulated.push({ Value: wanted.value, Label: { UserLocalizedLabel: { Label: wanted.label } } });
  }
  return missing;
}

function assertAssignedOption(raw, option) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`InsertOptionValue for ${option.key} did not return JSON with NewOptionValue.`);
  }
  if (parsed?.NewOptionValue !== option.value) {
    throw new Error(
      `Dataverse returned NewOptionValue ${parsed?.NewOptionValue ?? '(missing)'}, not requested ${option.value}. `
      + 'Runtime REVIEW_STATUS_MAP would be wrong; stop and reconcile before deployment.',
    );
  }
}

async function insertOption(client, option) {
  const response = await client.post('/InsertOptionValue', {
    EntityLogicalName: ENTITY,
    AttributeLogicalName: 'wmkf_reviewstatus',
    Value: option.value,
    Label: {
      '@odata.type': 'Microsoft.Dynamics.CRM.Label',
      LocalizedLabels: [{
        '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
        Label: option.label,
        LanguageCode: 1033,
      }],
    },
  });
  console.log(`InsertOptionValue ${option.key} → HTTP ${response.status}`);
  console.log(`Response body: ${response.text || '(empty)'}`);
  if (!response.ok) throw new Error(`InsertOptionValue failed for ${option.key}.`);

  assertAssignedOption(response.text, option);
}

if (process.argv.includes('--self-test')) {
  const option = (Value, label) => ({ Value, Label: { UserLocalizedLabel: { Label: label } } });
  const existing = [
    option(100000000, 'Accepted'), option(100000001, 'Materials Sent'),
    option(100000002, 'Under Review'), option(100000003, 'Review Received'),
    option(100000004, 'Complete'), option(100000005, 'Withdrew'), option(100000006, 'Released'),
  ];
  const expectThrow = (label, fn) => {
    try { fn(); } catch { console.log(`ok - ${label}`); return; }
    throw new Error(`self-test expected failure: ${label}`);
  };
  if (planMissingOptions(existing).map((entry) => entry.key).join(',') !== 'did_not_submit') {
    throw new Error('self-test failed: next-free plan');
  }
  console.log('ok - next-free value planned');
  if (planMissingOptions([...existing, option(100000007, 'Did not submit')]).length !== 0) {
    throw new Error('self-test failed: idempotent no-op');
  }
  console.log('ok - second run is a no-op');
  expectThrow('value/label collision refused', () => planMissingOptions([...existing, option(100000007, 'Something Else')]));
  expectThrow('unexpected next-free value refused', () => planMissingOptions([...existing, option(100000010, 'Another Status')]));
  expectThrow('label already at another value refused', () => planMissingOptions([...existing, option(100000008, 'Did not submit')]));
  expectThrow('unexpected NewOptionValue refused', () => assertAssignedOption('{"NewOptionValue":100000099}', desired[0]));
  assertAssignedOption('{"NewOptionValue":100000007}', desired[0]);
  console.log('ok - requested NewOptionValue accepted');
  process.exit(0);
}

const execute = process.argv.includes('--execute');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const { parseTargetArg, resolveTargetResource } = require('./lib/dataverse-script-target.cjs');

const target = parseTargetArg(process.argv);
loadEnvLocal();
const resourceUrl = resolveTargetResource({ target, write: execute });
console.log(`Target: ${target} (${resourceUrl})`);
console.log(`Mode:   ${execute ? 'EXECUTE' : 'PREVIEW (no writes)'}\n`);
const client = createClient({
  resourceUrl,
  token: await getAccessToken(resourceUrl),
  solutionUniqueName: solutionName,
});

let options = await readOptions(client);
printOptions(options, 'Current Review Status options:');
const missing = planMissingOptions(options);
if (missing.length === 0) {
  console.log('\nDid not submit already exists with the declared value. No-op.');
  process.exit(0);
}
if (!execute) {
  for (const wanted of missing) console.log(`\nWould add ${wanted.value}: ${wanted.label}`);
  console.log('Preview only. Re-run with --execute to add it.');
  process.exit(0);
}

for (const wanted of missing) {
  await insertOption(client, wanted);
  options = [...options, { Value: wanted.value, Label: { UserLocalizedLabel: { Label: wanted.label } } }];
}

const publish = await client.post(
  '/PublishXml',
  { ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>` },
  { 'MSCRM.SolutionUniqueName': '' },
);
console.log(`PublishXml (${ENTITY}) → HTTP ${publish.status}`);
if (!publish.ok) throw new Error(`PublishXml failed (${publish.status}): ${publish.text}`);

const verified = await readOptions(client);
printOptions(verified, '\nReview Status options after publish:');
assertNoCollisions(verified);
for (const wanted of desired) {
  const found = verified.find((option) => option.Value === wanted.value && labelOf(option) === wanted.label);
  if (!found) throw new Error(`Verification failed: ${wanted.value} (${wanted.label}) is absent after publish.`);
}
console.log('\nDid not submit added and verified.');
