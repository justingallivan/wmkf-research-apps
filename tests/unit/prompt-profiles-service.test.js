/** @jest-environment node */
import { getPromptProfiles, publishPromptProfile, previewSharedTask, validateSharedTaskPublication } from '../../lib/services/admin/prompt-profiles-service';
import { hashProfile } from '../../lib/services/prompt-jobs/profile';

const id = '00000000-0000-4000-8000-000000000002';
const profile = () => ({ key: 'proposal-analysis', revision: 1, wrapperVersion: 1, sharedInstructions: 'Analyze the supplied proposal.', documentRoles: ['proposal'], recordNames: ['pi_name'], limits: { maxDocuments: 1, maxDocumentBytes: 10000, maxTotalDocumentBytes: 10000, maxRecordBytes: 1000 } });
function store() {
  const values = {};
  const deps = {
    now: () => new Date('2026-11-11T00:00:00Z'),
    listSettingsWithMetaStrict: jest.fn(async () => structuredClone(values)),
    createSettingStrict: jest.fn(async (key, value) => { if (values[key]) throw Object.assign(new Error('exists'), { code: 'setting_exists' }); values[key] = { value }; }),
  };
  return { values, deps };
}
async function fixture() {
  const state = store(); const p = profile();
  await publishPromptProfile({ profile: p, expectedVersion: 0, requestId: id }, state.deps);
  const task = { name: 'synthetic.executive-summary', body: 'Write the summary. PI: {{pi_name}}', systemPrompt: '', model: 'claude-sonnet-4-6', maxTokens: 1000,
    variables: JSON.stringify({ execution: { contractVersion: 1, mode: 'shared-document-task', profile: { key: p.key, revision: p.revision, sha256: hashProfile(p) } }, variables: [{ name: 'proposal_context', source: { kind: 'prepared_context' }, required: true }, { name: 'pi_name', source: { kind: 'frozen_record' }, required: false }] }),
    outputSchema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'summary', target: { kind: 'none' }, maxWords: 200 }] }) };
  return { ...state, task };
}
it('publishes append-only, verifies exact readback, and replays the same command without writing', async () => {
  const { deps } = store(); const args = { profile: profile(), expectedVersion: 0, requestId: id, profileId: 7 };
  expect((await publishPromptProfile(args, deps)).status).toBe('completed');
  expect((await publishPromptProfile(args, deps)).status).toBe('already_published');
  expect(deps.createSettingStrict).toHaveBeenCalledTimes(1);
  expect(deps.createSettingStrict.mock.calls[0][2]).toBe(7);
  expect(deps.listSettingsWithMetaStrict).toHaveBeenCalledWith('executor.profiles.', { rejectDuplicates: true });
  await expect(publishPromptProfile({ ...args, profile: { ...profile(), sharedInstructions: 'changed' } }, deps)).rejects.toMatchObject({ code: 'idempotency_key_reuse' });
  await expect(publishPromptProfile({ ...args, requestId: '00000000-0000-4000-8000-000000000003' }, deps)).rejects.toMatchObject({ code: 'version_conflict' });
});
it('settles a committed write with a lost reply by exact readback', async () => {
  const { deps, values } = store();
  deps.createSettingStrict.mockImplementationOnce(async (key, value) => { values[key] = { value }; throw new Error('lost reply'); });
  await expect(publishPromptProfile({ profile: profile(), expectedVersion: 0, requestId: id }, deps)).resolves.toMatchObject({ status: 'already_published' });
});
it('concurrent revision collision never reports the other command as success', async () => {
  const { deps, values } = store();
  deps.createSettingStrict.mockImplementationOnce(async (key, value) => { const row = JSON.parse(value); row.requestId = '00000000-0000-4000-8000-000000000003'; values[key] = { value: JSON.stringify(row) }; throw Object.assign(new Error('collision'), { status: 409 }); });
  await expect(publishPromptProfile({ profile: profile(), expectedVersion: 0, requestId: id }, deps)).rejects.toMatchObject({ code: 'version_conflict' });
});
it.each(['bad JSON', JSON.stringify({ schemaVersion: 2 })])('refuses corrupted stored revisions', async value => {
  const { deps, values } = store(); values['executor.profiles.a.v000001'] = { value };
  await expect(getPromptProfiles(deps)).rejects.toMatchObject({ code: 'profile_storage_invalid' });
  expect(deps.createSettingStrict).not.toHaveBeenCalled();
});
it('preview assembles fabricated protected content and frozen PI values only', async () => {
  const { task, deps } = await fixture(); const result = await previewSharedTask({ task }, deps);
  expect(result.sampleOnly).toBe(true);
  expect(result.preview.system).toContain('authoritative over document inference');
  expect(result.preview.documentBlock).toContain('Fabricated proposal');
  expect(result.preview.taskSuffix).toContain('Sample pi_name');
  expect(result.preview.taskSuffix).not.toContain('{{pi_name}}');
  expect(result.preview.prefixHash).toMatch(/^[a-f0-9]{64}$/);
});
it('resolves historical pins, rejects changed content, and never falls back to newest', async () => {
  const { task, deps, values } = await fixture();
  await publishPromptProfile({ profile: { ...profile(), revision: 2, sharedInstructions: 'Version two' }, expectedVersion: 1, requestId: '00000000-0000-4000-8000-000000000003' }, deps);
  expect((await previewSharedTask({ task }, deps)).preview.system).toContain('Analyze the supplied proposal.');
  delete values['executor.profiles.proposal-analysis.v000001'];
  await expect(previewSharedTask({ task }, deps)).rejects.toMatchObject({ code: 'profile_pin_mismatch' });
});
it.each([
  { name: 'real.task' }, { systemPrompt: 'override' }, { maxTokens: 100000 },
  { body: 'Read {{proposal_context}}' }, { body: 'Read {{other}}' },
  { outputSchema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'summary', target: { kind: 'dataverse' }, maxWords: 200 }] }) },
])('rejects unsupported execution contract %j', async patch => {
  const { task, deps } = await fixture();
  await expect(previewSharedTask({ task: { ...task, ...patch } }, deps)).rejects.toMatchObject({ httpStatus: 400 });
});
it('reserves synthetic names even when both execution markers are absent', async () => {
  await expect(validateSharedTaskPublication({ name: 'synthetic.executive-summary', payload: { variables: null } }, store().deps)).rejects.toMatchObject({ code: 'invalid_shared_task' });
});
it('requires explicit concurrency/idempotency and prevents marker removal or conversion', async () => {
  const { task, deps } = await fixture();
  const priorRow = { wmkf_ai_promptvariables: task.variables, wmkf_ai_systemprompt: '', wmkf_ai_promptbody: task.body, wmkf_ai_model: task.model, wmkf_ai_promptoutputschema: task.outputSchema };
  const args = { name: task.name, payload: { ...task }, priorRow, expectedVersion: 1, requestId: id };
  await expect(validateSharedTaskPublication(args, deps)).resolves.toBe(true);
  await expect(validateSharedTaskPublication({ ...args, requestId: undefined }, deps)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(validateSharedTaskPublication({ ...args, expectedVersion: undefined }, deps)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(validateSharedTaskPublication({ ...args, payload: { ...task, variables: null } }, deps)).rejects.toMatchObject({ code: 'invalid_shared_task' });
  await expect(validateSharedTaskPublication({ ...args, priorRow: { ...priorRow, wmkf_ai_promptvariables: null } }, deps)).rejects.toMatchObject({ code: 'invalid_shared_task' });
});

it('proposal definition publication requires an authoritative PI and the fixed source profile',async()=>{
  const{task,deps}=await fixture();task.name='proposal.executive-summary';
  await expect(previewSharedTask({task},deps)).rejects.toThrow('stored PI');
  const metadata=JSON.parse(task.variables);metadata.variables.find(v=>v.name==='pi_name').required=true;task.variables=JSON.stringify(metadata);
  await expect(previewSharedTask({task},deps)).resolves.toMatchObject({sampleOnly:true});
});

it('the unpublished controlled-trial input artifact passes the real Admin preview contract',async()=>{
  const candidate=require('../../docs/plans/SHARED_EXECUTOR_PROPOSAL_TRIAL_INPUTS_2026-11-11.json');
  const{deps}=store();
  expect(hashProfile(candidate.profile)).toBe(candidate.profileHash);
  await publishPromptProfile({profile:candidate.profile,expectedVersion:0,requestId:id},deps);
  for(const task of candidate.tasks)await expect(previewSharedTask({task},deps)).resolves.toMatchObject({sampleOnly:true});
  expect((await getPromptProfiles(deps)).tasks.map(task=>task.name)).toEqual(['synthetic.executive-summary','synthetic.methodology','proposal.executive-summary','proposal.methodology']);
});
