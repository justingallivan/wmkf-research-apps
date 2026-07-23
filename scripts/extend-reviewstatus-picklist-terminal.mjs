/**
 * Owner-gated provisioning helper for
 * wmkf_appreviewersuggestion.wmkf_reviewstatus:
 *   withdrew = 100000005
 *   released = 100000006
 *
 * DO NOT run as part of a deploy. This mutates Dataverse metadata and requires
 * separate owner approval for each target environment.
 *
 * Safety contract:
 * - print and inspect the live option set first;
 * - refuse value/label collisions and duplicate labels at another value;
 * - require the missing declared values to be exactly the next free values;
 * - assert InsertOptionValue.NewOptionValue equals the requested value;
 * - publish, re-read, and verify both options;
 * - a second run is a clean no-op.
 */

import { TERMINAL_REVIEW_STATUS_VALUES } from '../shared/config/reviewerStatus.js';
const solutionName = 'wmkfResearchReviewAppSuite';
const desired = [
  { key: 'withdrew', value: TERMINAL_REVIEW_STATUS_VALUES.withdrew, label: 'Withdrew' },
  { key: 'released', value: TERMINAL_REVIEW_STATUS_VALUES.released, label: 'Released' },
];
let baseUrl;
let token;
let checkUrl;

async function readOptions() {
  const response = await fetch(checkUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Review Status metadata read failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  return body.OptionSet?.Options || [];
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

async function insertOption(option) {
  const response = await fetch(`${baseUrl}/api/data/v9.2/InsertOptionValue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'MSCRM.SolutionUniqueName': solutionName,
    },
    body: JSON.stringify({
      EntityLogicalName: 'wmkf_appreviewersuggestion',
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
    }),
  });
  const raw = await response.text();
  console.log(`InsertOptionValue ${option.key} → HTTP ${response.status}`);
  console.log(`Response body: ${raw || '(empty)'}`);
  if (!response.ok) throw new Error(`InsertOptionValue failed for ${option.key}.`);

  assertAssignedOption(raw, option);
}

if (process.argv.includes('--self-test')) {
  const option = (Value, label) => ({ Value, Label: { UserLocalizedLabel: { Label: label } } });
  const existing = [
    option(100000000, 'Accepted'), option(100000001, 'Materials Sent'),
    option(100000002, 'Under Review'), option(100000003, 'Review Received'),
    option(100000004, 'Complete'),
  ];
  const expectThrow = (label, fn) => {
    try { fn(); } catch { console.log(`ok - ${label}`); return; }
    throw new Error(`self-test expected failure: ${label}`);
  };
  if (planMissingOptions(existing).map((entry) => entry.key).join(',') !== 'withdrew,released') {
    throw new Error('self-test failed: next-free plan');
  }
  console.log('ok - next-free pair planned');
  if (planMissingOptions([...existing, option(100000005, 'Withdrew'), option(100000006, 'Released')]).length !== 0) {
    throw new Error('self-test failed: idempotent no-op');
  }
  console.log('ok - second run is a no-op');
  expectThrow('value/label collision refused', () => planMissingOptions([...existing, option(100000005, 'Something Else')]));
  expectThrow('unexpected next-free value refused', () => planMissingOptions([...existing, option(100000010, 'Another Status')]));
  expectThrow('unexpected NewOptionValue refused', () => assertAssignedOption('{"NewOptionValue":100000099}', desired[0]));
  assertAssignedOption('{"NewOptionValue":100000005}', desired[0]);
  console.log('ok - requested NewOptionValue accepted');
  process.exit(0);
}

const { default: fs } = await import('fs');
const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
baseUrl = process.env.DYNAMICS_URL;
token = await DynamicsService.getAccessToken();
checkUrl = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')/Attributes(LogicalName='wmkf_reviewstatus')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`;

let options = await readOptions();
printOptions(options, 'Current Review Status options:');
const missing = planMissingOptions(options);
if (missing.length === 0) {
  console.log('\nWithdrew and Released already exist with the declared values. No-op.');
  process.exit(0);
}

for (const wanted of missing) {
  await insertOption(wanted);
  options = [...options, { Value: wanted.value, Label: { UserLocalizedLabel: { Label: wanted.label } } }];
}

const publish = await fetch(`${baseUrl}/api/data/v9.2/PublishAllXml`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
});
console.log(`PublishAllXml → HTTP ${publish.status}`);
if (!publish.ok) throw new Error(`PublishAllXml failed (${publish.status}): ${await publish.text()}`);

const verified = await readOptions();
printOptions(verified, '\nReview Status options after publish:');
assertNoCollisions(verified);
for (const wanted of desired) {
  const found = verified.find((option) => option.Value === wanted.value && labelOf(option) === wanted.label);
  if (!found) throw new Error(`Verification failed: ${wanted.value} (${wanted.label}) is absent after publish.`);
}
console.log('\nWithdrew and Released added and verified.');
