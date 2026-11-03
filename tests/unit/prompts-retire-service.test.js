/**
 * Unit tests for retirePrompt (lib/services/admin/prompts-publish-service.js).
 * Adapter + sql mocked.
 *
 * @jest-environment node
 */
jest.mock('../../lib/dataverse/adapters/ai-prompt', () => ({
  listVersions: jest.fn(),
  queryCurrentRows: jest.fn(),
  queryCurrentIdVersions: jest.fn(),
  getIdOnly: jest.fn(),
  create: jest.fn(),
  setIsCurrent: jest.fn(),
  retire: jest.fn(),
  PROMPTSTATUS_RETIRED: 682090002,
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../lib/services/executor-budget-service', () => ({ assertExecutorBudgetForPromptModel: jest.fn(async () => null) }));

import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt';
import { sql } from '@vercel/postgres';
import { retirePrompt } from '../../lib/services/admin/prompts-publish-service';

const NAME = 'grants.budget-check';
const row = (over = {}) => ({
  wmkf_ai_promptid: 'row-1', wmkf_ai_promptname: NAME, wmkf_promptversion: 2, wmkf_ai_iscurrent: true,
  wmkf_ai_usagecategory: 'unconnected', ...over,
});
const auditInserts = () => sql.mock.calls.filter(([strings]) => strings.join('?').includes('INSERT INTO prompt_publish_audit'));

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
  aiPrompt.queryCurrentRows.mockResolvedValue({ records: [row()] });
  aiPrompt.getIdOnly.mockResolvedValue({ _etag: 'W/"8"' });
  aiPrompt.retire.mockResolvedValue({});
  aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [] });
});

it('retires the current row with its fresh ETag and audits before and after', async () => {
  const r = await retirePrompt({ name: NAME, expectedVersion: 2, profileId: 7 });
  expect(r).toMatchObject({ status: 'completed', kind: 'retire', targetVersion: 2, warnings: [] });
  expect(aiPrompt.retire).toHaveBeenCalledWith('row-1', { ifMatch: 'W/"8"' });
  const [pending, final] = auditInserts();
  expect(pending.slice(1)).toEqual(expect.arrayContaining([NAME, 2, 'row-1', 7]));
  expect(final.slice(1)).toEqual(expect.arrayContaining([NAME, 'row-1', 'completed']));
});

it('is blocked for a prompt marked Application caller, before any audit or write', async () => {
  aiPrompt.queryCurrentRows.mockResolvedValue({ records: [row({ wmkf_ai_usagecategory: 'application' })] });
  await expect(retirePrompt({ name: NAME, profileId: 7 })).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'retire_blocked_application' }) });
  expect(auditInserts()).toHaveLength(0);
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('uses the code catalog usage when the row has none (a cataloged app prompt stays blocked)', async () => {
  aiPrompt.queryCurrentRows.mockResolvedValue({ records: [row({ wmkf_ai_promptname: 'phase-i.summary', wmkf_ai_usagecategory: null })] });
  await expect(retirePrompt({ name: 'phase-i.summary', profileId: 7 })).rejects.toMatchObject({ body: expect.objectContaining({ status: 'retire_blocked_application' }) });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('rejects a stale expected version', async () => {
  await expect(retirePrompt({ name: NAME, expectedVersion: 1, profileId: 7 })).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'concurrency_conflict' }) });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('404s when there is no published version to retire', async () => {
  aiPrompt.queryCurrentRows.mockResolvedValue({ records: [] });
  await expect(retirePrompt({ name: NAME, profileId: 7 })).rejects.toMatchObject({ httpStatus: 404, body: expect.objectContaining({ status: 'no_current_row' }) });
});

it('refuses to retire when the pending audit write fails', async () => {
  sql.mockImplementation(async (strings) => {
    if (strings.join('?').includes("'pending', 'pending'")) throw new Error('db down');
    return { rows: [] };
  });
  await expect(retirePrompt({ name: NAME, profileId: 7 })).rejects.toMatchObject({ httpStatus: 500, body: expect.objectContaining({ status: 'audit_unavailable' }) });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('maps a changed row (412) to concurrency_conflict and finalizes the audit', async () => {
  aiPrompt.retire.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
  await expect(retirePrompt({ name: NAME, profileId: 7 })).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'concurrency_conflict' }) });
  expect(auditInserts()).toHaveLength(2);
});

it('never writes without an ETag', async () => {
  aiPrompt.getIdOnly.mockResolvedValue({});
  await expect(retirePrompt({ name: NAME, profileId: 7 })).rejects.toMatchObject({ httpStatus: 500, body: expect.objectContaining({ status: 'failed' }) });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('a repeated request replays its final result', async () => {
  sql.mockResolvedValueOnce({ rows: [{ phase: 'final', status: 'completed', prompt_name: NAME, target_version: 2, outcome_json: { kind: 'retire' } }] });
  const r = await retirePrompt({ name: NAME, requestId: 'r1', profileId: 7 });
  expect(r).toMatchObject({ status: 'already_published', kind: 'retire', idempotentReplay: true });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('finishes a retire whose final audit was lost', async () => {
  aiPrompt.queryCurrentRows.mockResolvedValue({ records: [] });
  sql.mockResolvedValueOnce({ rows: [{ phase: 'pending', status: 'pending', prompt_name: NAME, target_version: 2, prior_prompt_id: 'row-1', body_hash: 'h', outcome_json: { kind: 'retire' } }] });
  const r = await retirePrompt({ name: NAME, requestId: 'r2', profileId: 7 });
  expect(r).toMatchObject({ status: 'completed', resumed: true, targetVersion: 2 });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});

it('refuses a request id already used for a publish', async () => {
  sql.mockResolvedValueOnce({ rows: [{ phase: 'pending', status: 'pending', prompt_name: NAME, target_version: 3, outcome_json: { fingerprintVersion: 2 } }] });
  await expect(retirePrompt({ name: NAME, requestId: 'r3', profileId: 7 })).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'idempotency_key_reuse' }) });
  expect(aiPrompt.retire).not.toHaveBeenCalled();
});
