/** Add only the three owner-approved decline reasons; dry run by default.
 * node scripts/extend-request-decline-reasons.mjs --target=prod [--execute]
 * Owner provisions with the standard target/write interlock; no request rows
 * are changed. All existing options and notes are preserved. Runtime validates
 * published values/labels; an unapplied option stays unavailable in the UI.
 */
import clientModule from '../lib/dataverse/client.js';
import { classifyTarget } from '../lib/dataverse/core/interlock.js';
import { TRIAGE_REASONS } from '../shared/config/triageReasons.js';
const args = process.argv.slice(2);
if (!args.includes('--target=prod') || args.some(a => !['--target=prod', '--execute'].includes(a))) throw new Error('Specify --target=prod [--execute]');
const { loadEnvLocal, getAccessToken, createClient } = clientModule;
loadEnvLocal();
const resourceUrl = process.env.DYNAMICS_URL;
if (classifyTarget(resourceUrl) !== 'production') throw new Error('Registered Production target required');
const execute = args.includes('--execute');
const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), solutionUniqueName: 'wmkfResearchReviewAppSuite', dryRun: !execute });
const path = "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_declinereason')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet($select=Options,IsGlobal)";
async function inspect() {
  const result = await client.get(path);
  if (!result.ok || !Array.isArray(result.body?.OptionSet?.Options)) throw new Error('Decline Reason metadata unavailable');
  if (result.body.OptionSet.IsGlobal === true) throw new Error('Expected a local picklist; stop before changing a shared option set');
  const options = result.body.OptionSet.Options;
  const missing = [];
  for (const intended of TRIAGE_REASONS) {
    const live = options.find(option => option.Value === intended.value);
    const label = option => option.Label?.LocalizedLabels?.find(l => l.LanguageCode === 1033)?.Label;
    if (live && label(live) !== intended.label) throw new Error(`Value ${intended.value} has a conflicting label`);
    if (options.some(option => option.Value !== intended.value && label(option) === intended.label)) throw new Error(`Label ${intended.label} has a different value`);
    if (!live) {
      if (intended.value < 682090005) throw new Error(`Expected existing option ${intended.value} is missing`);
      missing.push(intended);
    }
  }
  return missing;
}
const missing = await inspect();
if (!execute) console.log(JSON.stringify({ dryRun: true, target: new URL(resourceUrl).hostname, additions: missing }, null, 2));
else {
  for (const option of missing) {
    const result = await client.post('/InsertOptionValue', {
      EntityLogicalName: 'akoya_request', AttributeLogicalName: 'wmkf_declinereason', Value: option.value,
      Label: { '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: option.label, LanguageCode: 1033 }] },
    });
    if (!result.ok || result.body?.NewOptionValue !== option.value) throw new Error(`Insertion unconfirmed for ${option.value}; inspect before retrying`);
    console.log(`Inserted ${option.value}: ${option.label}`);
  }
  { // Publish on execute reruns too: a previous insertion may have stopped before publish.
    const published = await client.post('/PublishXml', { ParameterXml: '<importexportxml><entities><entity>akoya_request</entity></entities></importexportxml>' });
    if (!published.ok) throw new Error('Publish failed; inserted options may exist unpublished. Inspect before retrying');
  }
  if ((await inspect()).length) throw new Error('Published metadata readback incomplete; do not release');
  console.log('Verified: all eight decline reasons present with expected values and labels.');
}
