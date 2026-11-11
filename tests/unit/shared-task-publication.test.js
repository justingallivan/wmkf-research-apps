/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/ai-prompt', () => ({ queryCurrentRows: jest.fn(), listVersions: jest.fn(), queryCurrentIdVersions: jest.fn(), create: jest.fn(), setIsCurrent: jest.fn(), getIdOnly: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/settings-service', () => ({ listSettingsWithMetaStrict: jest.fn(), createSettingStrict: jest.fn() }));
jest.mock('../../lib/services/executor-budget-service', () => ({ assertExecutorBudgetForPromptModel: jest.fn() }));
jest.mock('../../lib/services/admin/prompt-groups-service', () => ({ getPromptGroups: jest.fn(async () => ({ groups: [] })) }));
import * as adapter from '../../lib/dataverse/adapters/ai-prompt';
import { sql } from '@vercel/postgres';
import { listSettingsWithMetaStrict } from '../../lib/services/settings-service';
import { createPrompt, publishPrompt } from '../../lib/services/admin/prompts-publish-service';
import { createHash } from 'crypto';
import { hashProfile } from '../../lib/services/prompt-jobs/profile';
const id = '00000000-0000-4000-8000-000000000001';
const profile = { key: 'proposal', revision: 1, wrapperVersion: 1, sharedInstructions: 'Analyze.', documentRoles: ['proposal'], recordNames: ['pi_name'], limits: { maxDocuments: 1, maxDocumentBytes: 10000, maxTotalDocumentBytes: 10000, maxRecordBytes: 1000 } };
const variables = JSON.stringify({ execution: { contractVersion: 1, mode: 'shared-document-task', profile: { key: profile.key, revision: 1, sha256: hashProfile(profile) } }, variables: [{ name: 'proposal_context', source: { kind: 'prepared_context' }, required: true }, { name: 'pi_name', source: { kind: 'frozen_record' }, required: false }] });
const args = () => ({ name: 'synthetic.executive-summary', catalog: { title: 'Summary', usage: 'diagnostic' }, body: 'Summarize for {{pi_name}}.', systemPrompt: '', variables, outputSchema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'summary', maxWords: 200, target: { kind: 'none' } }] }), model: 'claude-sonnet-4-6', maxTokens: 1000, expectedVersion: 1, requestId: id, profileId: 7 });
const row = () => ({ wmkf_ai_promptid: id, wmkf_ai_promptname: args().name, wmkf_ai_promptbody: args().body, wmkf_ai_systemprompt: null, wmkf_ai_promptvariables: variables, wmkf_ai_promptoutputschema: args().outputSchema, wmkf_ai_model: args().model, wmkf_ai_maxtokens: 1000, wmkf_ai_temperature: 0, wmkf_promptversion: 1, wmkf_ai_iscurrent: true });
beforeEach(() => {
  jest.clearAllMocks();
  sql.mockResolvedValue({ rows: [] }); adapter.listVersions.mockResolvedValue({ records: [] }); adapter.queryCurrentRows.mockResolvedValue({ records: [row()] }); adapter.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: id }] }); adapter.create.mockResolvedValue({ wmkf_ai_promptid: id }); adapter.getIdOnly.mockResolvedValue({ _etag: 'W/"1"' }); adapter.setIsCurrent.mockResolvedValue({});
  listSettingsWithMetaStrict.mockResolvedValue({ 'executor.profiles.proposal.v000001': { value: JSON.stringify({ schemaVersion: 1, profile, sha256: hashProfile(profile), requestId: id, publishedAt: '2026-11-11T00:00:00Z' }) } });
});
it('create preserves opt-in metadata without inventing override variables', async () => {
  await expect(createPrompt(args())).resolves.toMatchObject({ status: 'completed' });
  expect(adapter.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_promptvariables: variables, wmkf_ai_temperature: 0 }));
});
it('update accepts stored null system prompt and freezes same execution mode', async () => {
  await expect(publishPrompt({ ...args(), body: 'Revised summary for {{pi_name}}.' })).resolves.toMatchObject({ status: 'completed' });
  expect(adapter.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_promptversion: 2, wmkf_ai_promptvariables: variables, wmkf_ai_systemprompt: '' }));
});
it.each([{ expectedVersion: undefined }, { requestId: undefined }, { variables: JSON.stringify({ variables: [{ name: 'pi_name', source: { kind: 'override' } }] }) }, { body: 'Summary {{other}}' }])('rejects invalid update before privileged mutation %j', async patch => {
  await expect(publishPrompt({ ...args(), ...patch })).rejects.toMatchObject({ httpStatus: 400 });
  expect(adapter.create).not.toHaveBeenCalled(); expect(sql).not.toHaveBeenCalled();
});
it('blocks legacy conversion even on first publish of a draft', async () => {
  adapter.queryCurrentRows.mockResolvedValue({ records: [] }); adapter.listVersions.mockResolvedValue({ records: [{ ...row(), wmkf_ai_iscurrent: false, wmkf_ai_promptvariables: null }] });
  await expect(publishPrompt(args())).rejects.toMatchObject({ code: 'invalid_shared_task' }); expect(adapter.create).not.toHaveBeenCalled();
});
it('does not accept an audit token belonging to another prompt name', async () => {
  const task = args();
  const bodyHash = createHash('sha256').update(JSON.stringify({ fingerprintVersion: 2, body: task.body, systemPrompt: '', variables: task.variables, outputSchema: task.outputSchema, model: task.model, temperature: 0, maxTokens: task.maxTokens })).digest('hex');
  sql.mockResolvedValueOnce({ rows: [{ phase: 'final', prompt_name: 'different', body_hash: bodyHash }] });
  await expect(publishPrompt(args())).rejects.toMatchObject({ body: { status: 'idempotency_key_reuse' } });
  expect(adapter.create).not.toHaveBeenCalled();
});

it('preview and publication both accept hyphenated frozen record names', async () => {
  const p = { ...profile, recordNames: ['pi-name'] };
  listSettingsWithMetaStrict.mockResolvedValue({ 'executor.profiles.proposal.v000001': { value: JSON.stringify({ schemaVersion: 1, profile: p, sha256: hashProfile(p), requestId: id, publishedAt: '2026-11-11T00:00:00Z' }) } });
  const metadata = JSON.parse(variables); metadata.execution.profile.sha256 = hashProfile(p); metadata.variables[1].name = 'pi-name';
  await expect(createPrompt({ ...args(), body: 'Summarize for {{pi-name}}.', variables: JSON.stringify(metadata) })).resolves.toMatchObject({ status: 'completed' });
  expect(adapter.create.mock.calls[0][0].wmkf_ai_promptvariables).toContain('pi-name');
});
