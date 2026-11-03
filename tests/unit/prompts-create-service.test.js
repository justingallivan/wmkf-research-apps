/**
 * Unit tests for createPrompt + declareMissingPlaceholders
 * (lib/services/admin/prompts-publish-service.js). Adapter + sql mocked.
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
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../lib/services/admin/prompt-groups-service', () => {
  const { buildEffectivePromptGroups, defaultEditablePromptGroups } = jest.requireActual('../../shared/config/adminPromptCatalog');
  const editable = [...defaultEditablePromptGroups(), { id: 'grant-reporting', label: 'Grant reporting' }];
  return { getPromptGroups: jest.fn(async () => ({ groups: buildEffectivePromptGroups(editable), editable, revision: null, storageWarning: null })) };
});
jest.mock('../../lib/services/executor-budget-service', () => ({
  assertExecutorBudgetForPromptModel: jest.fn(async () => null),
}));

import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt';
import { sql } from '@vercel/postgres';
import { createPrompt, declareMissingPlaceholders, publishPrompt } from '../../lib/services/admin/prompts-publish-service';

const NAME = 'grants.budget-check';
const BODY = 'Check this budget:\n{{budget_text}}\nfor {{program}}.';
const args = (over = {}) => ({
  name: NAME,
  catalog: { title: 'Budget check' },
  body: BODY,
  systemPrompt: 'You review budgets.',
  outputSchema: '',
  model: '',
  profileId: 7,
  ...over,
});
const auditInserts = () => sql.mock.calls.filter(([strings]) => strings.join('?').includes('INSERT INTO prompt_publish_audit'));

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
  aiPrompt.listVersions.mockResolvedValue({ records: [] });
  aiPrompt.create.mockResolvedValue({ wmkf_ai_promptid: 'new-row' });
  aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
});

describe('declareMissingPlaceholders', () => {
  it('declares every placeholder as a required override variable when none are declared', () => {
    const out = JSON.parse(declareMissingPlaceholders(null, 'Use {{a}}.', '{{b}} and {{ a }}'));
    expect(out.variables).toEqual([
      { name: 'a', source: { kind: 'override' }, required: true },
      { name: 'b', source: { kind: 'override' }, required: true },
    ]);
  });

  it('keeps existing declarations untouched and appends only the missing ones', () => {
    const existing = JSON.stringify({ variables: [{ name: 'a', source: { kind: 'sharepoint', pattern: 'x*.pdf' }, required: true }] });
    const out = JSON.parse(declareMissingPlaceholders(existing, '', '{{a}} {{c}}'));
    expect(out.variables[0]).toEqual({ name: 'a', source: { kind: 'sharepoint', pattern: 'x*.pdf' }, required: true });
    expect(out.variables[1]).toEqual({ name: 'c', source: { kind: 'override' }, required: true });
  });

  it('returns the input string unchanged when nothing is missing or it cannot be parsed', () => {
    const existing = '{"variables":[{"name":"a"}]}';
    expect(declareMissingPlaceholders(existing, '', '{{a}}')).toBe(existing);
    expect(declareMissingPlaceholders(null, '', 'no placeholders')).toBeNull();
    expect(declareMissingPlaceholders('not json', '', '{{a}}')).toBe('not json');
  });
});

describe('createPrompt', () => {
  it('creates v1 as current and Published, with catalog columns and declared placeholders', async () => {
    const r = await createPrompt(args({ catalog: { title: 'Budget check', group: 'diagnostics' } }));
    expect(r).toMatchObject({ status: 'completed', kind: 'create', newPromptId: 'new-row', targetVersion: 1, warnings: [] });
    const row = aiPrompt.create.mock.calls[0][0];
    expect(row).toMatchObject({
      wmkf_ai_promptname: NAME,
      wmkf_ai_iscurrent: true,
      wmkf_promptversion: 1,
      wmkf_ai_promptstatus: 682090001,
      wmkf_ai_displaytitle: 'Budget check',
      wmkf_ai_groupkey: 'diagnostics',
      wmkf_ai_usagecategory: 'unconnected',
      wmkf_ai_promptoutputschema: null,
      wmkf_ai_model: null,
    });
    expect(JSON.parse(row.wmkf_ai_promptvariables).variables.map((v) => v.name)).toEqual(['budget_text', 'program']);
    const [pending, final] = auditInserts();
    expect(pending.slice(1)).toEqual(expect.arrayContaining([NAME, 1, 7]));
    expect(final.slice(1)).toEqual(expect.arrayContaining([NAME, 'new-row', 'completed']));
  });

  it.each([['Grants.Budget'], ['grants..budget'], ['-grants'], ['a'.repeat(65)], ['grants budget']])('rejects the name %s before any read or write', async (name) => {
    await expect(createPrompt(args({ name }))).rejects.toMatchObject({ httpStatus: 400, body: expect.objectContaining({ status: 'invalid_name' }) });
    expect(aiPrompt.listVersions).not.toHaveBeenCalled();
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('requires a title', async () => {
    await expect(createPrompt(args({ catalog: {} }))).rejects.toMatchObject({ httpStatus: 400, body: expect.objectContaining({ status: 'invalid_catalog' }) });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('refuses a name that already has any row, including a draft', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'd', wmkf_promptversion: 1, wmkf_ai_iscurrent: false }] });
    await expect(createPrompt(args())).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'name_exists' }) });
    expect(aiPrompt.create).not.toHaveBeenCalled();
    expect(auditInserts()).toHaveLength(0);
  });

  it('rejects an example response pasted into the output schema before audit', async () => {
    await expect(createPrompt(args({ outputSchema: '{ "status": "pass", "fail", or "review" }' }))).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_output_schema' }),
    });
    expect(auditInserts()).toHaveLength(0);
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('refuses to create when the pending audit write fails', async () => {
    sql.mockImplementation(async (strings) => {
      if (strings.join('?').includes("'pending', 'pending'")) throw new Error('db down');
      return { rows: [] };
    });
    await expect(createPrompt(args())).rejects.toMatchObject({ httpStatus: 500, body: expect.objectContaining({ status: 'audit_unavailable' }) });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('a repeated request with a final audit replays instead of creating again', async () => {
    await createPrompt(args({ requestId: 'r1' }));
    const pendingHash = auditInserts()[0].find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
    sql.mockReset();
    sql.mockResolvedValueOnce({ rows: [{ phase: 'final', status: 'completed', prompt_name: NAME, new_prompt_id: 'new-row', target_version: 1, body_hash: pendingHash }] });
    aiPrompt.create.mockClear();
    const r = await createPrompt(args({ requestId: 'r1' }));
    expect(r).toMatchObject({ status: 'already_published', idempotentReplay: true, newPromptId: 'new-row' });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('finishes a create whose final audit was lost, without a second row', async () => {
    await createPrompt(args({ requestId: 'r2' }));
    const row = aiPrompt.create.mock.calls[0][0];
    const pendingHash = auditInserts()[0].find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
    sql.mockReset();
    sql.mockResolvedValue({ rows: [] });
    sql.mockResolvedValueOnce({ rows: [{ phase: 'pending', status: 'pending', prompt_name: NAME, target_version: 1, body_hash: pendingHash }] });
    aiPrompt.listVersions.mockResolvedValue({ records: [{ ...row, wmkf_ai_promptid: 'new-row' }] });
    aiPrompt.create.mockClear();
    const r = await createPrompt(args({ requestId: 'r2' }));
    expect(r).toMatchObject({ status: 'completed', resumed: true, newPromptId: 'new-row' });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('reports two simultaneous creates as partial', async () => {
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'a' }, { wmkf_ai_promptid: 'b' }] });
    const r = await createPrompt(args());
    expect(r).toMatchObject({ status: 'partial', warnings: ['invariant_violation_current_count_2'] });
  });
});

describe('publishPrompt declares placeholders added in an edit', () => {
  it('appends a new placeholder and keeps the existing declaration', async () => {
    const existingVars = JSON.stringify({ variables: [{ name: 'budget_text', source: { kind: 'override' }, required: true }] });
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [{
      wmkf_ai_promptid: 'prior', wmkf_ai_promptname: NAME, wmkf_promptversion: 1, wmkf_ai_iscurrent: true,
      wmkf_ai_promptbody: 'Check {{budget_text}}', wmkf_ai_systemprompt: '', wmkf_ai_promptvariables: existingVars,
      wmkf_ai_promptoutputschema: null, wmkf_ai_model: null, wmkf_ai_temperature: null, wmkf_ai_maxtokens: null,
    }] });
    aiPrompt.getIdOnly.mockResolvedValue({ _etag: 'W/"1"' });
    aiPrompt.setIsCurrent.mockResolvedValue({});
    const r = await publishPrompt({ name: NAME, body: 'Check {{budget_text}} against {{cap}}', profileId: 7 });
    expect(r).toMatchObject({ status: 'completed', targetVersion: 2 });
    const vars = JSON.parse(aiPrompt.create.mock.calls[0][0].wmkf_ai_promptvariables).variables;
    expect(vars.map((v) => v.name)).toEqual(['budget_text', 'cap']);
  });
});

describe('createPrompt with a group added in Admin', () => {
  it('accepts a group from the stored list', async () => {
    await createPrompt(args({ catalog: { title: 'Budget check', group: 'grant-reporting' } }));
    expect(aiPrompt.create.mock.calls[0][0]).toMatchObject({ wmkf_ai_groupkey: 'grant-reporting' });
  });
});
