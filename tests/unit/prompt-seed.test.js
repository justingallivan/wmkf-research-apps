/**
 * prompt-seed helper — create-only by default + version-preserving --force.
 * Covers planSeed for every state, the create/republish/recover writes, the
 * create-only + duplicate-current refusals, ETag flip of priors, and the
 * post-create single-current verification.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: jest.fn(), createRecord: jest.fn(), getRecord: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../lib/services/executor-budget-service', () => ({
  assertExecutorBudgetForPromptModel: jest.fn(async () => null),
}));

import { seedPromptRow, planSeed, SeedRefused } from '../../lib/services/prompt-seed';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { assertExecutorBudgetForPromptModel } from '../../lib/services/executor-budget-service';

const NAME = 'grantee-title.generate';
const NOW = '2026-01-01T00:00:00Z';
const row = (id, version, current) => ({ wmkf_ai_promptid: id, wmkf_ai_promptname: NAME, wmkf_promptversion: version, wmkf_ai_iscurrent: current });
const RECORD = { wmkf_ai_promptname: NAME, wmkf_ai_systemprompt: 'sys', wmkf_ai_promptbody: 'body' };

beforeEach(() => {
  jest.clearAllMocks();
  DynamicsService.createRecord.mockResolvedValue({ wmkf_ai_promptid: 'new-id' });
  DynamicsService.getRecord.mockResolvedValue({ _etag: 'etag-x' });
  DynamicsService.updateRecord.mockResolvedValue({});
  assertExecutorBudgetForPromptModel.mockResolvedValue(null);
});

// ── planSeed ───────────────────────────────────────────────────────────────
test('planSeed: no rows → create v1', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [] });
  expect(await planSeed({ promptName: NAME })).toMatchObject({ action: 'create', targetVersion: 1 });
});

test('planSeed: a current row, no force → refuse', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [row('a', 1, true)] });
  expect(await planSeed({ promptName: NAME, force: false })).toMatchObject({ action: 'refuse' });
});

test('planSeed: force over current v2 → republish v3', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [row('a', 2, true), row('b', 1, false)] });
  expect(await planSeed({ promptName: NAME, force: true })).toMatchObject({ action: 'republish', targetVersion: 3 });
});

test('planSeed: force, rows exist but none current → recover', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [row('a', 2, false), row('b', 1, false)] });
  expect(await planSeed({ promptName: NAME, force: true })).toMatchObject({ action: 'recover', targetVersion: 3 });
});

test('planSeed: duplicate-current → refuse-duplicate (even with force)', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [row('a', 2, true), row('b', 1, true)] });
  expect(await planSeed({ promptName: NAME, force: true })).toMatchObject({ action: 'refuse-duplicate' });
});

// ── seedPromptRow writes ────────────────────────────────────────────────────
test('create: writes v1 current + publish time, no flip', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [] })                       // plan
    .mockResolvedValueOnce({ records: [row('new-id', 1, true)] }); // verify
  const out = await seedPromptRow({ promptName: NAME, recordData: RECORD, now: NOW });
  expect(DynamicsService.createRecord).toHaveBeenCalledWith('wmkf_ai_prompts', expect.objectContaining({
    wmkf_ai_iscurrent: true, wmkf_promptversion: 1, wmkf_ai_publisheddatetime: NOW, wmkf_ai_systemprompt: 'sys',
  }));
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(out).toMatchObject({ action: 'create', version: 1, id: 'new-id' });
});

test('republish (force): creates v(max+1) + flips the prior current with its ETag', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [row('v2', 2, true), row('v1', 1, false)] })                  // plan
    .mockResolvedValueOnce({ records: [row('new-id', 3, true), row('v2', 2, false), row('v1', 1, false)] }); // verify
  DynamicsService.getRecord.mockResolvedValueOnce({ _etag: 'etag-v2' });
  const out = await seedPromptRow({ promptName: NAME, recordData: RECORD, force: true, now: NOW });
  expect(DynamicsService.createRecord).toHaveBeenCalledWith('wmkf_ai_prompts', expect.objectContaining({ wmkf_promptversion: 3, wmkf_ai_iscurrent: true }));
  expect(DynamicsService.updateRecord).toHaveBeenCalledWith('wmkf_ai_prompts', 'v2', { wmkf_ai_iscurrent: false }, { ifMatch: 'etag-v2' });
  expect(out).toMatchObject({ action: 'republish', version: 3 });
});

test('recover (force, none current): creates v(max+1), no flip', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [row('v2', 2, false), row('v1', 1, false)] })
    .mockResolvedValueOnce({ records: [row('new-id', 3, true), row('v2', 2, false), row('v1', 1, false)] });
  const out = await seedPromptRow({ promptName: NAME, recordData: RECORD, force: true, now: NOW });
  expect(DynamicsService.createRecord).toHaveBeenCalledWith('wmkf_ai_prompts', expect.objectContaining({ wmkf_promptversion: 3 }));
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(out).toMatchObject({ action: 'recover', version: 3 });
});

test('create-only refusal: existing row + no force → SeedRefused, no write', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [row('a', 1, true)] });
  await expect(seedPromptRow({ promptName: NAME, recordData: RECORD })).rejects.toThrow(SeedRefused);
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});

test('duplicate-current refusal: force does NOT auto-repair', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [row('a', 2, true), row('b', 1, true)] });
  await expect(seedPromptRow({ promptName: NAME, recordData: RECORD, force: true })).rejects.toThrow(/duplicate-current/);
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});

test('post-create verification fails loud if not exactly one current', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [] })                                            // plan → create
    .mockResolvedValueOnce({ records: [row('new-id', 1, true), row('other', 1, true)] }); // verify → 2 current
  await expect(seedPromptRow({ promptName: NAME, recordData: RECORD, now: NOW }))
    .rejects.toThrow(/post-write verification failed/);
});

test('governed seeds validate their model against the current Executor budget before writing', async () => {
  const promptName = 'review-synthesis.generate';
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [] });
  assertExecutorBudgetForPromptModel.mockRejectedValueOnce(new Error('budget/model conflict'));
  await expect(seedPromptRow({
    promptName,
    recordData: { ...RECORD, wmkf_ai_promptname: promptName, wmkf_ai_model: 'claude-limited' },
  })).rejects.toThrow('budget/model conflict');
  expect(assertExecutorBudgetForPromptModel).toHaveBeenCalledWith(promptName, 'claude-limited');
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});
