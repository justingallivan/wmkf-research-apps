/** @jest-environment node */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { preparePreSiteTransition } = require('../../lib/prompt-publication/pre-site-transition');
const { main } = require('../../scripts/prepare-pre-site-prompt-transition.cjs');
const { POLICY_ARTIFACT } = require('../../lib/prompt-publication/template-policy');
const { validateDefinition } = require('../../lib/prompt-publication/definition-schema');
const c = POLICY_ARTIFACT.policy.consumerContracts['pre-site-visit.proposal-core.generate'];
const clone = v=>JSON.parse(JSON.stringify(v));
function snapshot(legacy=true) {
  const schema=JSON.parse(c.outputJson);
  if(legacy) for(const [key,node] of Object.entries(schema.jsonSchema.properties.proposalCore.properties))node.maxLength=schema.validationSchema.fields.proposalCore.fields[key].maxLength;
  return {definitionFormatVersion:1,definition:{name:'pre-site-visit.proposal-core.generate',systemPrompt:c.systemIncludes.join('\n'),body:c.body,variables:c.variablesJson,outputSchema:JSON.stringify(schema,null,2),model:'claude-sonnet-5',temperature:null,maxTokens:12000},catalog:{title:null,description:null,groupKey:null,sectionKey:null,usedBy:null,usageCategory:null}};
}
test('only the known native maxLength delta changes; inputs and local sink bounds survive',()=>{
  const old=snapshot(),original=clone(old),plan=preparePreSiteTransition(old);
  expect(old).toEqual(original);expect(plan.action).toBe('stage-new-draft');expect(plan.changedFields).toEqual(['outputSchema']);
  expect({...plan.proposedSnapshot.definition,outputSchema:old.definition.outputSchema}).toEqual(old.definition);expect(plan.proposedSnapshot.catalog).toEqual(old.catalog);
  expect(validateDefinition(plan.proposedSnapshot.definition).valid).toBe(true);
  const next=JSON.parse(plan.proposedSnapshot.definition.outputSchema),prior=JSON.parse(old.definition.outputSchema);
  expect(next.validationSchema).toEqual(prior.validationSchema);expect(next.rawOutputRetention).toBe('full');
  for(const node of Object.values(next.jsonSchema.properties.proposalCore.properties))expect(node).not.toHaveProperty('maxLength');
  expect(plan.currentSnapshotHash).not.toBe(plan.proposedSnapshotHash);expect(plan.deploymentAuthorized).toBe(false);expect(Object.isFrozen(plan.proposedSnapshot.definition)).toBe(true);
});
test('compatible memo bytes are preserved as a verify-only no-op',()=>{
  const current=snapshot(false),plan=preparePreSiteTransition(current);
  expect(plan.action).toBe('verify-only');expect(plan.proposedSnapshot).toEqual(current);expect(plan.currentSnapshotHash).toBe(plan.proposedSnapshotHash);expect(plan.changedFields).toEqual([]);
});
test.each([
  s=>{const o=JSON.parse(s.definition.outputSchema);o.jsonSchema.properties.proposalCore.properties.executiveSummary.maxLength=123;s.definition.outputSchema=JSON.stringify(o);},
  s=>{const o=JSON.parse(s.definition.outputSchema);o.validationSchema.fields.proposalCore.fields.executiveSummary.maxLength=123;s.definition.outputSchema=JSON.stringify(o);},
  s=>{const o=JSON.parse(s.definition.outputSchema);o.rawOutputRetention='none';s.definition.outputSchema=JSON.stringify(o);},
])('unknown schema drift rejects without silently stripping constraints',mutate=>{
  const s=snapshot();mutate(s);expect(()=>preparePreSiteTransition(s)).toThrow('unreviewed_pre_site_schema_delta');
});
test.each([s=>{s.definition.model=null;},s=>{s.definition.body+='changed';},s=>{s.definition.variables='{"variables":[]}';}])('incompatible models/templates/inputs are not repaired',mutate=>{
  const s=snapshot();mutate(s);expect(()=>preparePreSiteTransition(s)).toThrow('incompatible_pre_site_transition_definition');
});
test('strict offline CLI writes one private create-only artifact and logs no prompt content',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pr553-transition-')),input=path.join(dir,'snapshot.json'),output=path.join(dir,'plan.json');
  const log=jest.spyOn(console,'log').mockImplementation(()=>{});
  try {
    fs.writeFileSync(input,JSON.stringify(snapshot()));main(['--input',input,'--output',output]);
    expect(fs.statSync(output).mode&0o777).toBe(0o600);expect(JSON.parse(fs.readFileSync(output,'utf8')).deploymentAuthorized).toBe(false);
    const logged=JSON.parse(log.mock.calls[0][0]);expect(Object.keys(logged)).toEqual(['action','currentSnapshotHash','proposedSnapshotHash','deploymentAuthorized']);
    expect(()=>main(['--input',input,'--output',output])).toThrow();
    fs.writeFileSync(input,'{"definitionFormatVersion":1,"definitionFormatVersion":1}');
    expect(()=>main(['--input',input,'--output',path.join(dir,'other.json')])).toThrow();expect(fs.existsSync(path.join(dir,'other.json'))).toBe(false);
  }finally{log.mockRestore();fs.rmSync(dir,{recursive:true,force:true});}
});

test('canonical schema equality cannot produce verify-only for reader-incompatible property order',()=>{
  const current=snapshot(false),schema=JSON.parse(current.definition.outputSchema);
  const {validateNarrativePrompt}=require('../../lib/services/pre-site-visit/artifact-model');
  const row=()=>({wmkf_ai_promptid:'10000000-0000-4000-8000-000000000001',wmkf_promptversion:1,wmkf_ai_promptname:current.definition.name,wmkf_ai_promptbody:current.definition.body,wmkf_ai_systemprompt:current.definition.systemPrompt,wmkf_ai_promptvariables:current.definition.variables,wmkf_ai_promptoutputschema:current.definition.outputSchema});
  expect(validateNarrativePrompt(row()).promptVersion).toBe(1);
  current.definition.outputSchema=JSON.stringify(Object.fromEntries(Object.entries(schema).reverse()));
  expect(()=>preparePreSiteTransition(current)).toThrow('incompatible_pre_site_transition_definition');
  expect(()=>validateNarrativePrompt(row())).toThrow(expect.objectContaining({code:'pre_site_visit_prompt_not_ready'}));
});
