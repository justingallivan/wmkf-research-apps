#!/usr/bin/env node
/** Production-only provisioning; explicit env, no dotenv, no automatic role assignment.
 * --apply required. Does not import content or switch the application backend.
 */
const { resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
const schema = require('../lib/dataverse/schema-apply.js');
const roles = require('../lib/dataverse/role-apply.js');
const spec = require('../lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json');
const solution = require('../lib/dataverse/schema/solution.json');
async function main() {
  if (process.argv.slice(2).join(' ') !== '--apply') throw Error('Requires --apply and explicitly authorized production environment.');
  const resourceUrl = resolveTargetResource({ target: 'prod', write: true });
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), solutionUniqueName: solution.uniqueName });
  const publisher = await schema.ensurePublisher(client, { prefix: solution.publisherPrefix, uniqueName: solution.publisherUniqueName });
  await schema.ensureSolution(client, { ...solution, publisherId: publisher.publisherid });
  const { logical } = await schema.ensureEntity(client, spec);
  for (const attr of spec.attributes) await schema.ensureAttribute(client, logical, attr);
  for (const rel of spec.relationships) await schema.ensureLookupRelationship(client, { ...rel, referencingEntity: logical });
  for (const key of spec.alternateKeys) await schema.ensureAlternateKey(client, logical, key);
  const entityPath = `/EntityDefinitions(LogicalName='${logical}')`;
  const result = await client.patch(entityPath, { IsAuditEnabled: { Value: true } }, { 'MSCRM.MergeLabels': 'true' });
  if (!result.ok) throw Error(`Table audit configuration failed (${result.status}).`);
  for (const name of ['wmkf_name', 'statecode', 'wmkf_staffuser', ...spec.attributes.map(a => a.schemaName.toLowerCase())]) {
    const attribute = await client.get(`${entityPath}/Attributes(LogicalName='${name}')`);
    if (!attribute.ok) throw Error(`Attribute metadata unavailable: ${name}.`);
    const r = await client.patch(`${entityPath}/Attributes(LogicalName='${name}')`, {
      '@odata.type': attribute.body['@odata.type'], IsAuditEnabled: { Value: true },
    }, { 'MSCRM.MergeLabels': 'true' });
    if (!r.ok) throw Error(`Attribute auditing failed: ${name} (${r.status}).`);
  }
  const published = await client.post('/PublishXml', { ParameterXml: `<importexportxml><entities><entity>${logical}</entity></entities></importexportxml>` });
  if (!published.ok) throw Error(`Publish failed (${published.status}).`);
  const bu = await roles.getRootBusinessUnit(client);
  for (const [name, operations] of [
    ['WMKF Expertise Roster Editor', ['Read', 'Create', 'Write', 'Append']],
    ['WMKF Expertise Roster Reader', ['Read']],
  ]) {
    const role = await roles.ensureRole(client, { name, businessUnitId: bu.businessunitid, resourceUrl });
    const privileges = await roles.resolvePrivilegeIds(client, logical, operations);
    if (privileges.missing.length) throw Error('Roster privileges are not ready; retry after schema publishing.');
    // Staff User lookup requires AppendTo on User; reader needs none of those rights.
    if (operations.includes('Append')) {
      const userPrivileges = await roles.resolvePrivilegeIds(client, 'systemuser', ['Read', 'AppendTo']);
      if (userPrivileges.missing.length) throw Error('User lookup privileges unavailable.');
      privileges.resolved.push(...userPrivileges.resolved);
    }
    await roles.applyPrivileges(client, role.roleid, privileges.resolved.map(p => ({ PrivilegeId: p.privilegeId, Depth: 'Global' })));
    await roles.addRoleToSolution(client, role.roleid, solution.uniqueName);
  }
  console.log('Schema and roles provisioned. Wait for all keys to become Active; verify auditing, effective permissions and role assignments before import. No role was assigned and no roster row was imported.');
}
if (require.main === module) main().catch(error => { console.error('Provisioning stopped:', String(error.message || error.name).slice(0, 1000)); process.exitCode = 1; });
module.exports = { main };
