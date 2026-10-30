/** @jest-environment node */
jest.mock('../../lib/dataverse/core/changeset.js', () => ({ runChangeset: jest.fn(async () => ({ ok:true })) }));
jest.mock('../../lib/services/dynamics-service.js', () => ({ DynamicsService: { queryAllRecords: jest.fn() } }));
jest.mock('../../lib/services/settings-service.js', () => ({ listSettingsWithMetaStrict: jest.fn(() => {throw new Error('legacy cross-target settings client forbidden');}) }));
import { withDalContext } from '../../lib/dataverse/core/context';
import { commitBudgetPublication, readBudgetControl, readCurrentBudgetPrompt, readBudgetState } from '../../lib/dataverse/adapters/prompt-budget';
import { runChangeset } from '../../lib/dataverse/core/changeset';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { listSettingsWithMetaStrict } from '../../lib/services/settings-service';
const { prepareBudgetPublication, CONTROL_KEY } = require('../../lib/prompt-publication/budget-coordination');
const { POLICY_ARTIFACT } = require('../../lib/prompt-publication/template-policy');
const p = POLICY_ARTIFACT.policy;
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12,'0');
const actor = { organizationId:id(1), initiatingUserId:id(2), effectiveUserId:id(3) };
const c = () => ({ schemaVersion:1, revision:'0',etag:'W/"1"',policyRevision:p.policyVersion, policyArtifactHash:POLICY_ARTIFACT.hash });
const budgets = () => JSON.parse(JSON.stringify(p.budgetRegistry.defaults));
const ctx = fn => withDalContext('test:prompt-budget',fn);
beforeEach(() => jest.clearAllMocks());
async function plan() { return prepareBudgetPublication({budgets:budgets(), expectedVersion:1,requestId:id(4)},actor,{
  readControl:async()=>c(),readBudgetState:async()=>({schemaVersion:1,currentVersion:1,latestRevision:1,budgets:budgets(),warnings:[]}),
  readCurrentPrompt:async name=>({name,id:id(5),version:1,etag:'W/"2"',status:682090001,isCurrent:true,model:'sonnet'}),now:async()=>'2026-10-30T00:00:00.000Z',
}); }
test('commit requires trusted context and a real in-process prepared plan', async()=>{
  const prepared=await plan(); await expect(commitBudgetPublication(prepared)).rejects.toThrow();
  await ctx(async()=>{await expect(commitBudgetPublication(JSON.parse(JSON.stringify(prepared)))).rejects.toMatchObject({code:'unprepared_budget_publication'});});
  expect(runChangeset).not.toHaveBeenCalled();
});
test('one control-first changeset contains original If-Match and immutable budget create with strict human actor',async()=>ctx(async()=>{
  const prepared=await plan(); await commitBudgetPublication(prepared);
  const [ops,options]=runChangeset.mock.calls[0]; expect(ops).toHaveLength(2);
  expect(ops[0]).toMatchObject({method:'PATCH',entitySet:'wmkf_appsystemsettings',keyPredicate:`wmkf_settingkey='${CONTROL_KEY}'`,ifMatch:'W/"1"'});
  expect(JSON.parse(ops[0].body.wmkf_settingvalue)).toEqual({schemaVersion:1,revision:'1',policyRevision:p.policyVersion,policyArtifactHash:POLICY_ARTIFACT.hash});
  expect(ops[1]).toMatchObject({method:'POST',entitySet:'wmkf_appsystemsettings',body:{wmkf_settingkey:'executor.budgets.v000002'}});
  expect(JSON.parse(ops[1].body.wmkf_settingvalue)).toEqual(prepared.publication.envelope);
  expect(options).toEqual({actingUserSystemId:actor.effectiveUserId,noFallback:true});
  for(const op of ops) expect(op.body['wmkf_UpdatedBy@odata.bind']).toBe(`/systemusers(${actor.effectiveUserId})`);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
}));
test('commit conflicts/unknown outcomes propagate without ETag refresh or non-atomic retry',async()=>ctx(async()=>{
  runChangeset.mockRejectedValueOnce(Object.assign(new Error('unknown outcome'),{code:'timeout'}));
  await expect(commitBudgetPublication(await plan())).rejects.toMatchObject({code:'timeout'});
  expect(runChangeset).toHaveBeenCalledTimes(1);expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
}));
test('control read requires exactly one row and external ETag, never trusts stored ETag',async()=>ctx(async()=>{
  const value=c();delete value.etag;
  DynamicsService.queryAllRecords.mockResolvedValueOnce({records:[{wmkf_settingvalue:JSON.stringify(value),'@odata.etag':'W/"3"'}]});
  expect(await readBudgetControl()).toEqual({...value,etag:'W/"3"'});
  for(const records of [[],[{},{}],[{wmkf_settingvalue:'null'}],[{wmkf_settingvalue:JSON.stringify(c()),'@odata.etag':'W/"3"'}]]){
    DynamicsService.queryAllRecords.mockResolvedValueOnce({records});await expect(readBudgetControl()).rejects.toBeDefined();
  }
}));
test('model read counts every current row before status checks and does not select prompt content',async()=>ctx(async()=>{
  DynamicsService.queryAllRecords.mockResolvedValueOnce({records:[{wmkf_ai_promptname:'review-panel.seat',wmkf_ai_promptid:id(8),wmkf_promptversion:1,wmkf_ai_model:'sonnet',wmkf_ai_iscurrent:true,wmkf_ai_promptstatus:682090000,'@odata.etag':'W/"3"'}]});
  expect((await readCurrentBudgetPrompt('review-panel.seat')).status).toBe(682090000);
  const query=DynamicsService.queryAllRecords.mock.calls[0][1];expect(query.filter).not.toContain('promptstatus');expect(query.select).not.toContain('promptbody');expect(query.select).not.toContain('promptvariables');
  DynamicsService.queryAllRecords.mockResolvedValueOnce({records:[{},{}]});await expect(readCurrentBudgetPrompt('review-panel.seat')).rejects.toMatchObject({code:'budget_prompt_missing_or_duplicate'});
}));
test('existing parser preserves future schema warnings and damaged reserved revisions',async()=>ctx(async()=>{
  DynamicsService.queryAllRecords.mockResolvedValueOnce({records:[{wmkf_settingkey:'executor.budgets.v000003',wmkf_settingvalue:'{"schemaVersion":99}'}]});
  const state=await readBudgetState();expect(state.latestRevision).toBe(3);expect(state.currentVersion).toBe(0);expect(state.warnings).toEqual([{code:'unsupported_executor_budget_schema',version:3}]);
  expect(listSettingsWithMetaStrict).not.toHaveBeenCalled();
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('wmkf_appsystemsettings',expect.objectContaining({filter:"startswith(wmkf_settingkey,'executor.budgets.v')"}));
}));
test('malformed history values reject instead of becoming defaults',async()=>ctx(async()=>{
  DynamicsService.queryAllRecords.mockResolvedValueOnce({records:[{wmkf_settingkey:'executor.budgets.v000003',wmkf_settingvalue:123}]});
  await expect(readBudgetState()).rejects.toMatchObject({code:'invalid_budget_history_read'});
}));
test('duplicate revision keys reject instead of overwriting history',async()=>ctx(async()=>{
  DynamicsService.queryAllRecords.mockResolvedValueOnce({records:[{wmkf_settingkey:'executor.budgets.v000003',wmkf_settingvalue:'{}'},{wmkf_settingkey:'executor.budgets.v000003',wmkf_settingvalue:'{}'}]});
  await expect(readBudgetState()).rejects.toMatchObject({code:'duplicate_budget_revision_key'});
}));
