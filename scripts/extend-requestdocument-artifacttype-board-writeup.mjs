/** Dry-run-first Board Writeup option provisioning. Never changes a conflicting option.
 * node scripts/extend-requestdocument-artifacttype-board-writeup.mjs [--execute]
 * Uses the standard Dataverse client and deployment/target write interlock.
 * Set BOARD_WRITEUP_SCHEMA_READY=on only after exact successful live readback.
 */
import clientModule from '../lib/dataverse/client.js';
const { loadEnvLocal, getAccessToken, createClient } = clientModule;
loadEnvLocal();
const resourceUrl = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
if (!resourceUrl) throw new Error('Dataverse target required');
const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), solutionUniqueName: 'wmkfResearchReviewAppSuite' });
const path = "/EntityDefinitions(LogicalName='wmkf_requestdocument')/Attributes(LogicalName='wmkf_artifacttype')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)";
const value = 100000014, label = 'Board Writeup';
async function inspect() {
  const response = await client.get(path);
  if (!response.ok || !Array.isArray(response.body?.OptionSet?.Options)) throw new Error('Artifact metadata unavailable');
  const options = response.body.OptionSet.Options;
  const labels = option => (option.Label?.LocalizedLabels || []).map(x => x.Label);
  const existing = options.find(x => x.Value === value);
  if (existing && !labels(existing).includes(label)) throw new Error('Reserved Board value has a different label; stop and investigate');
  if (options.some(x => x.Value !== value && labels(x).includes(label))) throw new Error('Board label already uses a different value');
  return Boolean(existing);
}
if (await inspect()) console.log('VERIFIED: exact Board Writeup option already present.');
else if (!process.argv.includes('--execute')) console.log(`DRY RUN: ${new URL(resourceUrl).hostname} needs Board Writeup option ${value}. No changes made.`);
else {
  const response = await client.post('/InsertOptionValue', { EntityLogicalName: 'wmkf_requestdocument', AttributeLogicalName: 'wmkf_artifacttype', Value: value, Label: { '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: label, LanguageCode: 1033 }] } });
  if (!response.ok) throw new Error(`Option creation refused (${response.status}); no automatic retry`);
  let verified = false;
  for (let i = 0; i < 6 && !verified; i++) { if (i) await new Promise(resolve => setTimeout(resolve, 5000)); verified = await inspect(); }
  if (!verified) throw new Error('Option creation outcome not yet verified; leave readiness disabled');
  console.log('VERIFIED: exact Board Writeup option provisioned.');
}
