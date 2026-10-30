#!/usr/bin/env node
/** Offline request preparation only. No env, network, credentials or execute mode. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const spec = require('../dataverse/prompt-publication/registration/schema-v1.json');
const decisions = require('../dataverse/prompt-publication/registration/test-environment-decisions.json');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };
const label = text => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: text, LanguageCode: 1033 }] });
function attributeBody(field, primary = false) {
  requireValue(['String', 'Memo', 'Integer'].includes(field.type), 'unsupported_attribute_type');
  return { '@odata.type': `Microsoft.Dynamics.CRM.${field.type}AttributeMetadata`, SchemaName: field.name, DisplayName: label(field.label), RequiredLevel: { Value: 'None' },
    ...(field.type === 'Integer' ? { MinValue: field.minValue, MaxValue: field.maxValue } : { MaxLength: field.maxLength }),
    ...(field.type === 'String' ? { FormatName: { Value: 'Text' } } : {}), ...(field.type === 'Memo' ? { Format: 'Text' } : {}), ...(primary ? { IsPrimaryName: true } : {}) };
}
function compatible(actual, desired) {
  return actual.type === desired.type && actual.read === true && actual.create === true && actual.update === true
    && (desired.maxLength === undefined || actual.maxLength >= desired.maxLength)
    && (desired.minValue === undefined || actual.minValue <= desired.minValue && actual.maxValue >= desired.maxValue);
}
function prepare(schema, registration) {
  requireValue(schema.reportVersion === 2 && schema.readOnly === true && schema.targetClass === 'sandbox' && schema.targetHost === decisions.targetHost, 'schema_target_mismatch');
  requireValue(registration.readOnly === true && registration.host === decisions.targetHost && registration.identity?.organizationId === '3d52a072-b138-ef11-8e4b-000d3a106422', 'registration_target_mismatch');
  const read = name => { const entry = registration.inventory?.[name]; requireValue(entry?.status === 'read-complete' && Array.isArray(entry.rows), 'incomplete_registration_inventory'); return entry.rows; };
  const publisher = read('publishers').filter(row => row.uniquename === decisions.publisherUniqueName && row.customizationprefix === decisions.publisherPrefix);
  requireValue(publisher.length === 1, 'publisher_not_unique');
  const solution = read('solutions').filter(row => row.uniquename === decisions.solutionUniqueName && row._publisherid_value === publisher[0].publisherid && row.ismanaged === false);
  requireValue(solution.length === 1, 'selected_solution_mismatch');
  const prompt = schema.entities?.filter(entity => entity.logicalName === spec.existingPrompt.logicalName);
  requireValue(prompt?.length === 1 && prompt[0].metadataReadComplete === true && prompt[0].optimisticConcurrency === true && Array.isArray(prompt[0].attributes), 'incomplete_prompt_inventory');
  const requests = [], blockers = [], unchanged = [];
  const add = (id, target, body, dependsOn = []) => { requests.push({ id, method: 'POST', path: target, headers: { 'MSCRM.SolutionUniqueName': decisions.solutionUniqueName }, body, dependsOn }); return id; };
  for (const field of spec.existingPrompt.attributes) {
    const found = prompt[0].attributes.filter(actual => actual.name === field.name);
    if (found.length === 0) add(`attribute:${field.name}`, `/EntityDefinitions(LogicalName='wmkf_ai_prompt')/Attributes`, attributeBody(field));
    else if (found.length !== 1 || !compatible(found[0], field)) blockers.push({ code: 'existing_attribute_conflict', field: field.name });
    else unchanged.push(field.name);
  }
  const covers = (report, pathname, filter) => Array.isArray(report.requests) && report.requests.some(value => { const url = new URL(value, `https://${decisions.targetHost}`); return url.origin === `https://${decisions.targetHost}` && url.pathname === pathname && url.searchParams.get('$filter') === filter; });
  const tableFilter = "LogicalName eq 'wmkf_promptpublicationhead' or LogicalName eq 'wmkf_promptpublicationreceipt'";
  requireValue(covers(registration,'/api/data/v9.2/EntityDefinitions',tableFilter),'new_table_inventory_scope_mismatch');
  requireValue(covers(schema,"/api/data/v9.2/EntityDefinitions(LogicalName='wmkf_ai_prompt')/Attributes",null),'prompt_inventory_scope_mismatch');
  const knownTables = read('requiredTables');
  for (const table of spec.newTables) {
    if (knownTables.some(actual => actual.LogicalName === table.name)) {
      // Presence alone never attests attributes, lookup/key state or ownership.
      blockers.push({ code: 'existing_table_requires_full_metadata_validation', table: table.name }); continue;
    }
    const id = add(`table:${table.name}`, '/EntityDefinitions', { '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata', SchemaName: table.name, DisplayName: label(table.label), DisplayCollectionName: label(table.pluralLabel), OwnershipType: table.ownership, HasActivities: false, HasNotes: false, IsActivity: false, PrimaryNameAttribute: table.primaryName, Attributes: table.attributes.filter(field => field.name === table.primaryName).map(field => attributeBody(field, true)) });
    for (const field of table.attributes.filter(field => field.name !== table.primaryName)) add(`attribute:${table.name}:${field.name}`, `/EntityDefinitions(LogicalName='${table.name}')/Attributes`, attributeBody(field), [id]);
    const keyDependencies=[id,...table.uniqueKey.attributes.filter(name=>name!==table.primaryName).map(name=>`attribute:${table.name}:${name}`)];
    add(`key:${table.name}`, `/EntityDefinitions(LogicalName='${table.name}')/Keys`, { '@odata.type': 'Microsoft.Dynamics.CRM.EntityKeyMetadata', SchemaName: table.uniqueKey.name, DisplayName: label(table.uniqueKey.name), KeyAttributes: table.uniqueKey.attributes }, keyDependencies);
  }
  const rel = spec.relationship;
  if (!knownTables.some(actual => actual.LogicalName === rel.referencingEntity)) add('relationship:active-prompt', '/RelationshipDefinitions', { '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata', SchemaName: rel.name, ReferencedEntity: rel.referencedEntity, ReferencedAttribute: rel.referencedAttribute, ReferencingEntity: rel.referencingEntity, AssociatedMenuConfiguration: { Behavior: 'DoNotDisplay' }, CascadeConfiguration: { Assign: 'NoCascade', Delete: 'Restrict', Merge: 'NoCascade', Reparent: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade' }, Lookup: { '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata', SchemaName: rel.attribute, DisplayName: label(rel.label), RequiredLevel: { Value: 'None' } } }, [`table:${rel.referencingEntity}`]);
  return { planVersion: 1, status: blockers.length ? 'BLOCKED_METADATA_CONFLICT' : 'REVIEW_REQUESTS_NOT_EXECUTED', deploymentAuthorized: false, liveWritesAuthorized: false, targetHost: decisions.targetHost, organizationId: registration.identity.organizationId, solution: { id: solution[0].solutionid, uniqueName: decisions.solutionUniqueName, publisherId: publisher[0].publisherid }, evidence: { schemaObservedAt: schema.observedAt, registrationObservedAt: registration.observedAt, schemaSha256: digest(schema), registrationSha256: digest(registration), specSha256: digest(spec) }, blockers, unchanged, requests,
    requiredBeforeExecution: ['fresh exact-target organization/solution/publisher and complete metadata revalidation', 'Windows Framework and signing evidence', 'review all requests; stop on conflicts, no updates/deletes or automatic retries', 'if partial provisioning occurs, inventory each artifact before preparing a remainder plan', 'read back published metadata, actual entity sets, concurrency, Active keys and Restrict lookup before writer enablement'], excluded: ['role grants', 'guard registration', 'package/API registration', 'seeds', 'prompt mutations', 'production targets'] };
}
function main(args) {
  requireValue(args.length === 6 && args[0] === '--schema-report' && args[2] === '--registration-report' && args[4] === '--output' && [args[1], args[3], args[5]].every(path.isAbsolute) && !fs.existsSync(args[5]), 'Use --schema-report ABS --registration-report ABS --output NEW_ABS; no execute mode.');
  const result = prepare(JSON.parse(fs.readFileSync(args[1], 'utf8')), JSON.parse(fs.readFileSync(args[3], 'utf8')));
  fs.writeFileSync(args[5], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`${result.status}: ${result.requests.length} review requests, ${result.blockers.length} blockers. No tenant connection.`);
}
module.exports = { prepare, attributeBody, main };
if (require.main === module) main(process.argv.slice(2));
