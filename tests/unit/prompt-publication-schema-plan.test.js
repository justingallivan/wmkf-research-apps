/** @jest-environment node */
const { prepare, attributeBody, main } = require('../../scripts/prepare-prompt-publication-schema.cjs');
const schema = require('../../docs/plans/evidence/pr553-test-schema-2026-10-30.json');
const registration = require('../../docs/plans/evidence/pr553-test-registration-2026-10-30.json');
const clone = value => JSON.parse(JSON.stringify(value));
test('emits additive solution-bound requests without mutation authority', () => {
  const plan = prepare(schema, registration);
  expect(plan.status).toBe('REVIEW_REQUESTS_NOT_EXECUTED');
  expect(plan.requests).toHaveLength(18);
  expect(plan.requests.every(r => r.method === 'POST' && r.headers['MSCRM.SolutionUniqueName'] === 'wmkfResearchReviewAppSuite')).toBe(true);
  expect(plan.requests.find(r => r.id === 'relationship:active-prompt').body.CascadeConfiguration.Delete).toBe('Restrict');
  expect(plan.requests.filter(r => r.path === '/EntityDefinitions').every(r => r.body.OwnershipType === 'OrganizationOwned')).toBe(true);
  expect(plan.deploymentAuthorized).toBe(false);
});
test.each(['host', 'identity', 'failed-inventory', 'publisher', 'solution'])('rejects untrusted/incomplete registration: %s', kind => {
  const r = clone(registration);
  if (kind === 'host') r.host = 'wmkf.crm.dynamics.com';
  if (kind === 'identity') r.identity.organizationId = 'different';
  if (kind === 'failed-inventory') r.inventory.requiredTables.status = 'unverified';
  if (kind === 'publisher') r.inventory.publishers.rows = [];
  if (kind === 'solution') r.inventory.solutions.rows.find(row => row.uniquename === 'wmkfResearchReviewAppSuite')._publisherid_value = 'different';
  expect(() => prepare(schema, r)).toThrow();
});
test('existing wrong column is a blocker, never an update', () => {
  const s = clone(schema); s.entities[0].attributes.push({name:'wmkf_ai_displaytitle',type:'Memo',maxLength:200,create:true,update:true});
  const plan = prepare(s,registration);
  expect(plan.status).toBe('BLOCKED_METADATA_CONFLICT');
  expect(plan.blockers).toContainEqual({code:'existing_attribute_conflict',field:'wmkf_ai_displaytitle'});
  expect(plan.requests.some(r => r.id === 'attribute:wmkf_ai_displaytitle')).toBe(false);
});
test('compatible existing column is preserved', () => {
  const s = clone(schema); s.entities[0].attributes.push({name:'wmkf_ai_displaytitle',type:'String',maxLength:400,read:true,create:true,update:true});
  expect(prepare(s,registration).unchanged).toContain('wmkf_ai_displaytitle');
});
test('existing table needs complete metadata proof before reuse', () => {
  const r = clone(registration);r.inventory.requiredTables.rows.push({LogicalName:'wmkf_promptpublicationhead'});
  const plan = prepare(schema,r);
  expect(plan.blockers[0].code).toBe('existing_table_requires_full_metadata_validation');
  expect(plan.requests.some(r => r.id === 'table:wmkf_promptpublicationhead'||r.id==='relationship:active-prompt')).toBe(false);
});
test('unsupported field or execute flag rejects', () => {
  expect(()=>attributeBody({type:'Lookup'})).toThrow();
  expect(()=>main(['--execute'])).toThrow();
});


test('primary column is created with table; later columns and keys have ordered dependencies',()=>{
  const plan=prepare(schema,registration),seen=new Set();
  for(const request of plan.requests){for(const dependency of request.dependsOn)expect(seen.has(dependency)).toBe(true);seen.add(request.id);}
  expect(plan.requests.filter(r=>r.path==='/EntityDefinitions').every(r=>r.body.Attributes.length===1&&r.body.Attributes[0].IsPrimaryName===true)).toBe(true);
});
test('narrowed table probe and incomplete or filtered prompt attributes cannot imply absence',()=>{
 const r=clone(registration);r.requests=r.requests.filter(value=>!value.includes('EntityDefinitions?'));expect(()=>prepare(schema,r)).toThrow('inventory_scope_mismatch');
 const s=clone(schema);s.entities[0].metadataReadComplete=false;expect(()=>prepare(s,registration)).toThrow('incomplete_prompt_inventory');
 const f=clone(schema);f.requests=f.requests.filter(value=>!value.includes('/Attributes?'));expect(()=>prepare(f,registration)).toThrow('prompt_inventory_scope_mismatch');
});
