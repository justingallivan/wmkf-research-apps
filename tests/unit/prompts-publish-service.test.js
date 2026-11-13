/**
 * Unit tests for lib/services/admin/prompts-publish-service.js
 * (Stage 5 batch 1). Logic-level, ai-prompt adapter + sql mocked. The route
 * characterization suite (admin-prompts-publish.test.js) pins the HTTP
 * envelopes; this suite pins the service-level protocol semantics.
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
jest.mock('../../lib/services/executor-budget-service', () => ({
  assertExecutorBudgetForPromptModel: jest.fn(async () => null),
}));

import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt';
import { sql } from '@vercel/postgres';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { assertExecutorBudgetForPromptModel } from '../../lib/services/executor-budget-service';
import { getPrompt, publishPrompt } from '../../lib/services/admin/prompts-publish-service';
import { ANALYZE_USER_PROMPT_TEMPLATE } from '../../shared/config/prompts/reviewer-finder-dynamics';
import {
  PROMPT_NAME as PRE_SITE_NAME,
  SYSTEM_PROMPT as PRE_SITE_SYSTEM,
  USER_PROMPT_TEMPLATE as PRE_SITE_BODY,
  PROMPT_VARIABLES as PRE_SITE_VARIABLES,
  PROMPT_OUTPUT_SCHEMA as PRE_SITE_OUTPUT_SCHEMA,
} from '../../shared/config/prompts/pre-site-visit-proposal-core';
import { createHash } from 'crypto';

const NAME = 'reviewer-finder.analyze';
const VALID_BODY = ANALYZE_USER_PROMPT_TEMPLATE;
const ANALYZE_VARIABLES = JSON.stringify({
  variables: ['proposal_text', 'additional_notes_block', 'reviewer_count']
    .map((name) => ({ name })),
});
const currentRow = ({
  version = 3,
  id = 'prior',
  name = NAME,
  body = VALID_BODY,
  systemPrompt = '',
  variables = ANALYZE_VARIABLES,
  outputSchema = null,
  model = 'sonnet',
  temperature = null,
  maxTokens = null,
} = {}) => ({
  wmkf_ai_promptid: id, wmkf_ai_promptname: name, wmkf_promptversion: version,
  wmkf_ai_iscurrent: true, wmkf_ai_promptbody: body,
  wmkf_ai_systemprompt: systemPrompt, wmkf_ai_promptvariables: variables,
  wmkf_ai_promptoutputschema: outputSchema, wmkf_ai_model: model,
  wmkf_ai_temperature: temperature, wmkf_ai_maxtokens: maxTokens,
});

function publishHash(payload) {
  return createHash('sha256').update(JSON.stringify({ fingerprintVersion: 2, ...payload })).digest('hex');
}

function preSiteRow(overrides = {}) {
  return currentRow({
    name: PRE_SITE_NAME,
    body: PRE_SITE_BODY,
    systemPrompt: PRE_SITE_SYSTEM,
    variables: JSON.stringify(PRE_SITE_VARIABLES, null, 2),
    outputSchema: JSON.stringify(PRE_SITE_OUTPUT_SCHEMA, null, 2),
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 16384,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
  aiPrompt.getIdOnly.mockResolvedValue({ wmkf_ai_promptid: 'prior', _etag: 'W/"1"' });
  aiPrompt.create.mockResolvedValue({ wmkf_ai_promptid: 'new-row' });
  aiPrompt.setIsCurrent.mockResolvedValue({});
  assertExecutorBudgetForPromptModel.mockResolvedValue(null);
});

describe('getPrompt', () => {
  it('404 ServiceHttpError when no rows exist', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [] });
    await expect(getPrompt(NAME)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('maps current + history and flags duplicate_current_rows', async () => {
    aiPrompt.listVersions.mockResolvedValue({
      records: [currentRow({ version: 4, id: 'a' }), currentRow({ version: 3, id: 'b' })],
    });
    const r = await getPrompt(NAME);
    expect(r.current.id).toBe('a');
    expect(r.invariantError).toBe('duplicate_current_rows');
    expect(r.history).toHaveLength(2);
  });
});

describe('publishPrompt', () => {
  const args = (over = {}) => ({ name: NAME, body: `${VALID_BODY}\nEDIT`, profileId: 7, ...over });

  it('idempotent replay: a prior final audit row replays only for the same complete payload', async () => {
    const body = `${VALID_BODY}\nEDIT`;
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ version: 9, id: 'n1', body })] });
    const bodyHash = publishHash({
      body, systemPrompt: '', variables: ANALYZE_VARIABLES, outputSchema: null,
      model: 'sonnet', temperature: null, maxTokens: null,
    });
    sql.mockResolvedValueOnce({ rows: [{ prompt_name: NAME, phase: 'final', status: 'completed', new_prompt_id: 'n1', target_version: 9, body_hash: bodyHash }] });
    const r = await publishPrompt(args({ requestId: 'req-1' }));
    expect(r).toEqual({ status: 'already_published', newPromptId: 'n1', targetVersion: 9, version: 9, idempotentReplay: true });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('rejects request-id reuse when the effective payload changed', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    sql.mockResolvedValueOnce({ rows: [{ phase: 'pending', body_hash: 'different' }] });
    await expect(publishPrompt(args({ requestId: 'req-reused' }))).rejects.toMatchObject({
      httpStatus: 409,
      body: expect.objectContaining({ status: 'idempotency_key_reuse' }),
    });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('completed: creates v+1 (metadata cloned), flips prior with fresh If-Match, verifies one current', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ model: 'Sonnet' })] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
    const r = await publishPrompt(args());
    expect(r).toMatchObject({ status: 'completed', newPromptId: 'new-row', targetVersion: 4, warnings: [] });
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      wmkf_ai_iscurrent: true, wmkf_promptversion: 4, wmkf_ai_model: 'sonnet',
      wmkf_ai_publisheddatetime: expect.any(String),
    }));
    expect(aiPrompt.setIsCurrent).toHaveBeenCalledWith('prior', false, { ifMatch: 'W/"1"' });
  });

  it('carries the catalog columns forward without changing the publish fingerprint', async () => {
    const catalog = {
      wmkf_ai_displaytitle: 'Analyze a proposal', wmkf_ai_description: 'Finds context.',
      wmkf_ai_groupkey: 'reviewers', wmkf_ai_sectionkey: null,
      wmkf_ai_usedby: 'Reviewer Finder', wmkf_ai_usagecategory: 'application',
    };
    const body = `${VALID_BODY}\nEDIT`;
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [{ ...currentRow({ version: 9, id: 'n1', body }), ...catalog }] });
    const bodyHash = publishHash({
      body, systemPrompt: '', variables: ANALYZE_VARIABLES, outputSchema: null,
      model: 'sonnet', temperature: null, maxTokens: null,
    });
    sql.mockResolvedValueOnce({ rows: [{ prompt_name: NAME, phase: 'final', status: 'completed', new_prompt_id: 'n1', target_version: 9, body_hash: bodyHash }] });
    await expect(publishPrompt(args({ requestId: 'req-cat' }))).resolves.toMatchObject({ idempotentReplay: true });

    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [{ ...currentRow(), ...catalog }] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
    await publishPrompt(args());
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining(catalog));
  });

  it('writes null catalog columns when the prior row has none', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
    await publishPrompt(args());
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      wmkf_ai_displaytitle: null, wmkf_ai_usagecategory: null,
    }));
  });

  it('publishes a model-only edit as a new immutable version', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
    const r = await publishPrompt(args({ body: VALID_BODY, model: 'claude-opus-4-6', expectedVersion: 3 }));
    expect(r).toMatchObject({ status: 'completed', priorModel: 'sonnet', newModel: 'claude-opus-4-6' });
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      wmkf_ai_promptbody: VALID_BODY,
      wmkf_ai_model: 'claude-opus-4-6',
      wmkf_promptversion: 4,
    }));
  });

  it('publishes an output-schema edit as a new immutable version', async () => {
    const priorSchema = JSON.stringify({ outputs: [{ name: 'answer' }] });
    const nextSchema = JSON.stringify({ outputs: [{ name: 'answer', maxLength: 30000 }] });
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [currentRow({ outputSchema: priorSchema })],
    });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({
      records: [{ wmkf_ai_promptid: 'new-row' }],
    });

    const result = await publishPrompt(args({
      body: VALID_BODY,
      outputSchema: nextSchema,
      expectedVersion: 3,
    }));

    expect(result).toMatchObject({ status: 'completed', targetVersion: 4 });
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      wmkf_ai_promptoutputschema: nextSchema,
      wmkf_promptversion: 4,
    }));
  });

  it('rejects a configurable Executive Summary target before audit or publication', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    const outputSchema = JSON.stringify({ outputs: [{ name: 'summary', target: {
      kind: 'akoya_request', field: 'WMKF_LayAbstract', jsonPath: '$.summary',
    } }] });
    await expect(publishPrompt(args({ outputSchema }))).rejects.toMatchObject({
      httpStatus: 400, body: expect.objectContaining({ status: 'invalid_output_schema' }),
    });
    expect(sql).not.toHaveBeenCalled();
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed edited output schema before audit or write', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });

    await expect(publishPrompt(args({ outputSchema: '{not json' }))).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_output_schema' }),
    });
    expect(sql).not.toHaveBeenCalled();
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('rejects a non-string edited output schema instead of silently preserving the prior schema', async () => {
    await expect(publishPrompt(args({ outputSchema: { outputs: [] } }))).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_output_schema' }),
    });
    expect(aiPrompt.queryCurrentRows).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('rejects a stale expectedVersion before audit or write', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ version: 4 })] });
    await expect(publishPrompt(args({ expectedVersion: 3 }))).rejects.toMatchObject({
      httpStatus: 409,
      body: expect.objectContaining({ status: 'concurrency_conflict', actualVersion: 4 }),
    });
    expect(sql).toHaveBeenCalledTimes(1); // read-only idempotency lookup; no pending audit.
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('audit hard-abort: pending-audit failure throws 500 audit_unavailable BEFORE any Dataverse write', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    sql
      .mockResolvedValueOnce({ rows: [] }) // idempotency preflight
      .mockRejectedValueOnce(new Error('db down')); // pending audit
    await expect(publishPrompt(args())).rejects.toMatchObject({
      httpStatus: 500, body: expect.objectContaining({ status: 'audit_unavailable' }),
    });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('409 concurrency_conflict with orphan when the prior flip 412s (audit finalized once)', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    aiPrompt.setIsCurrent.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
    let caught;
    try { await publishPrompt(args()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ServiceHttpError);
    expect(caught.httpStatus).toBe(409);
    expect(caught.body).toMatchObject({
      status: 'concurrency_conflict',
      orphan: { id: 'new-row', reason: 'prior_etag_mismatch' },
      warnings: ['prior_etag_mismatch'],
    });
  });

  it('resume path: torn state (v+1 already created, body-hash match) flips the older rows down', async () => {
    const editedBody = `${VALID_BODY}\nEDIT`;
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [currentRow({ version: 3, id: 'old' }), currentRow({ version: 4, id: 'newer', body: editedBody })],
    });
    aiPrompt.getIdOnly.mockResolvedValue({ wmkf_ai_promptid: 'old', _etag: 'W/"9"' });
    const r = await publishPrompt(args({ body: editedBody }));
    expect(r).toMatchObject({ status: 'completed', newPromptId: 'newer', targetVersion: 4, resumed: true });
    expect(assertExecutorBudgetForPromptModel).not.toHaveBeenCalled();
    expect(aiPrompt.setIsCurrent).toHaveBeenCalledWith('old', false, { ifMatch: 'W/"9"' });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('resumes after the Dataverse publish completed but the final audit write was lost', async () => {
    const body = `${VALID_BODY}\nEDIT`;
    const published = currentRow({ version: 4, id: 'newer', body });
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [published] });
    const bodyHash = publishHash({
      body, systemPrompt: '', variables: ANALYZE_VARIABLES, outputSchema: null,
      model: 'sonnet', temperature: null, maxTokens: null,
    });
    sql.mockResolvedValueOnce({
      rows: [{
        prompt_name: NAME, phase: 'pending',
        target_version: 4,
        prior_prompt_id: 'old',
        body_hash: bodyHash,
        outcome_json: { fingerprintVersion: 2, priorModel: 'sonnet', newModel: 'sonnet' },
      }],
    });
    const result = await publishPrompt(args({ body, requestId: 'lost-final', expectedVersion: 3 }));
    expect(result).toMatchObject({
      status: 'completed',
      resumed: true,
      newPromptId: 'newer',
      targetVersion: 4,
      priorModel: 'sonnet',
      newModel: 'sonnet',
    });
    expect(aiPrompt.create).not.toHaveBeenCalled();
    expect(aiPrompt.setIsCurrent).not.toHaveBeenCalled();
  });

  it('does not resume a torn state when a non-body field differs', async () => {
    const editedBody = `${VALID_BODY}\nEDIT`;
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [
        currentRow({ version: 3, id: 'old' }),
        currentRow({ version: 4, id: 'newer', body: editedBody, model: 'claude-opus-4-6' }),
      ],
    });
    await expect(publishPrompt(args({ body: editedBody, model: 'sonnet' }))).rejects.toMatchObject({
      httpStatus: 500,
      body: expect.objectContaining({ status: 'duplicate_current_rows' }),
    });
    expect(aiPrompt.setIsCurrent).not.toHaveBeenCalled();
  });

  it.each([
    ['tier', 'sonnet', 'structured_output_requires_concrete_model'],
    ['blank', '', 'model_required'],
    ['unsupported concrete model', 'claude-sonnet-4', 'structured_output_unsupported'],
  ])('native structured output rejects %s', async (_label, model, code) => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [preSiteRow({ model })] });
    await expect(publishPrompt({
      name: PRE_SITE_NAME,
      body: PRE_SITE_BODY,
      model,
      profileId: 7,
    })).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_model', code }),
    });
    expect(sql).not.toHaveBeenCalled();
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('native structured output rejects a max-token setting beyond model capability', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [preSiteRow({ model: 'claude-sonnet-4-5', maxTokens: 70000 })],
    });
    await expect(publishPrompt({
      name: PRE_SITE_NAME,
      body: PRE_SITE_BODY,
      model: 'claude-sonnet-4-5',
      profileId: 7,
    })).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_model', code: 'model_output_limit_exceeded' }),
    });
  });

  describe('editable maxTokens', () => {
    const editArgs = (over = {}) => ({ name: NAME, body: VALID_BODY, profileId: 7, ...over });
    const limitBody = (n, id) => expect.objectContaining({
      status: 'invalid_model',
      code: 'model_output_limit_exceeded',
      error: expect.stringContaining(`${n}`),
    });

    beforeEach(() => {
      aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
    });

    it('publishes a valid maxTokens edit and carries it on the new row', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ model: 'claude-sonnet-4-6', maxTokens: 8000 })] });
      const r = await publishPrompt(editArgs({ model: 'claude-sonnet-4-6', maxTokens: 20000 }));
      expect(r).toMatchObject({ status: 'completed' });
      expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_maxtokens: 20000 }));
    });

    it('accepts exactly the model ceiling', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
      await publishPrompt(editArgs({ model: 'claude-sonnet-4-5', maxTokens: 64000 }));
      expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_maxtokens: 64000 }));
    });

    it('omitted maxTokens keeps the prior row value', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ maxTokens: 9000 })] });
      await publishPrompt(editArgs());
      expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_maxtokens: 9000 }));
    });

    it.each([[1.5], ['100'], [0], [-5], [Number.NaN], [true]])('rejects invalid maxTokens %p before any audit or write', async (bad) => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
      await expect(publishPrompt(editArgs({ maxTokens: bad }))).rejects.toMatchObject({
        httpStatus: 400,
        body: expect.objectContaining({ status: 'invalid_max_tokens' }),
      });
      expect(sql).not.toHaveBeenCalled();
      expect(aiPrompt.create).not.toHaveBeenCalled();
    });

    it('rejects maxTokens above the selected concrete model ceiling (non-native prompt)', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
      await expect(publishPrompt(editArgs({ model: 'claude-sonnet-4-5', maxTokens: 64001 })))
        .rejects.toMatchObject({ httpStatus: 400, body: limitBody(64001) });
      expect(aiPrompt.create).not.toHaveBeenCalled();
    });

    it('a model change that makes the existing maxTokens exceed the new ceiling is refused', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ model: 'claude-sonnet-4-6', maxTokens: 100000 })] });
      await expect(publishPrompt(editArgs({ model: 'claude-sonnet-4-5' })))
        .rejects.toMatchObject({ httpStatus: 400, body: limitBody(100000) });
      expect(aiPrompt.create).not.toHaveBeenCalled();
    });

    it('applies the ceiling to a tier through its resolved concrete model', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
      await expect(publishPrompt(editArgs({ model: 'haiku', maxTokens: 128001 })))
        .rejects.toMatchObject({ body: expect.objectContaining({ code: 'model_output_limit_exceeded' }) });
    });

    describe('cold model cache', () => {
      const { clearAvailableModelsCache } = require('../../lib/services/model-resolver');
      const realFetch = global.fetch;
      const realKey = process.env.CLAUDE_API_KEY;
      beforeEach(() => {
        clearAvailableModelsCache();
        process.env.CLAUDE_API_KEY = 'test-key';
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [
          { id: 'claude-haiku-4-5', created_at: '2025-10-01T00:00:00Z' },
          { id: 'claude-haiku-5-5', created_at: '2026-10-01T00:00:00Z' },
        ] }) }));
      });
      afterEach(() => {
        clearAvailableModelsCache();
        global.fetch = realFetch;
        if (realKey === undefined) delete process.env.CLAUDE_API_KEY; else process.env.CLAUDE_API_KEY = realKey;
      });

      it('loads the live model list before checking a tier ceiling (80k fits Haiku 5.5, not the 4.5 fallback)', async () => {
        aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
        await publishPrompt(editArgs({ model: 'haiku', maxTokens: 80000 }));
        expect(global.fetch).toHaveBeenCalled();
        expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_maxtokens: 80000 }));
      });

      it('accepts a body-only edit that inherits an 80k budget on a haiku-tier row', async () => {
        aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ model: 'haiku', maxTokens: 80000 })] });
        await publishPrompt(editArgs({}));
        expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_maxtokens: 80000 }));
      });
    });

    it('skips the ceiling when the model is blank (Executor fallback)', async () => {
      aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
      await publishPrompt(editArgs({ model: '', maxTokens: 500000 }));
      expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_ai_maxtokens: 500000 }));
    });
  });

  it('refuses a governed prompt model that conflicts with the durable Executor budget', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [preSiteRow()] });
    assertExecutorBudgetForPromptModel.mockRejectedValueOnce(new ServiceHttpError(
      'Current Executor budget exceeds the model ceiling.',
      { httpStatus: 409, code: 'executor_budget_model_conflict' },
    ));
    await expect(publishPrompt({
      name: PRE_SITE_NAME,
      body: PRE_SITE_BODY,
      model: 'claude-sonnet-4-6',
      profileId: 7,
    })).rejects.toMatchObject({ httpStatus: 409, code: 'executor_budget_model_conflict' });
    expect(assertExecutorBudgetForPromptModel).toHaveBeenCalledWith(
      PRE_SITE_NAME,
      'claude-sonnet-4-6',
    );
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed native structured-output contract before audit', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [preSiteRow({
        outputSchema: JSON.stringify({ generationMode: 'native-json-schema', parseMode: 'raw' }),
      })],
    });
    await expect(publishPrompt({
      name: PRE_SITE_NAME,
      body: PRE_SITE_BODY,
      model: 'claude-sonnet-4-6',
      profileId: 7,
    })).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_output_schema' }),
    });
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects malformed variable declarations as a typed 400 before audit', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [currentRow({ variables: JSON.stringify({ variables: 'not-an-array' }) })],
    });
    await expect(publishPrompt(args())).rejects.toMatchObject({
      httpStatus: 400,
      body: expect.objectContaining({ status: 'invalid_variables' }),
    });
    expect(sql).not.toHaveBeenCalled();
  });

  it('500 duplicate_current_rows on a NON-resumable multi-current state, with ids', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [currentRow({ version: 3, id: 'a' }), currentRow({ version: 8, id: 'b' })],
    });
    await expect(publishPrompt(args())).rejects.toMatchObject({
      httpStatus: 500,
      body: expect.objectContaining({ status: 'duplicate_current_rows', ids: ['a', 'b'] }),
    });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('failed create surfaces a 500 with the failed outcome (audit finalized)', async () => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    aiPrompt.create.mockRejectedValue(new Error('dataverse write refused'));
    await expect(publishPrompt(args())).rejects.toMatchObject({
      httpStatus: 500,
      body: expect.objectContaining({ status: 'failed', warnings: ['internal_error:dataverse write refused'] }),
    });
  });
});

describe('publishPrompt — first publish of a draft-only name', () => {
  const draftRow = (over = {}) => ({
    ...currentRow({ version: 1, id: 'draft-id', model: 'sonnet', ...over }),
    wmkf_ai_iscurrent: false,
    wmkf_ai_promptstatus: null,
    wmkf_ai_displaytitle: 'Draft title',
  });
  const args = (over = {}) => ({ name: NAME, body: VALID_BODY, profileId: 7, ...over });
  const auditInserts = () => sql.mock.calls.filter(([strings]) => strings.join('?').includes('INSERT INTO prompt_publish_audit'));

  beforeEach(() => {
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [] });
    aiPrompt.listVersions.mockResolvedValue({ records: [draftRow()] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
  });

  it('copies the latest draft into a new current row at max+1 without touching the draft', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [draftRow({ version: 2 }), draftRow({ version: 1, id: 'older' })] });
    const r = await publishPrompt(args({ expectedVersion: 2 }));
    expect(r).toMatchObject({ status: 'completed', newPromptId: 'new-row', targetVersion: 3, firstPublish: true, warnings: [] });
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      wmkf_ai_promptname: NAME,
      wmkf_ai_promptbody: VALID_BODY,
      wmkf_ai_iscurrent: true,
      wmkf_promptversion: 3,
      wmkf_ai_promptstatus: 682090001,
      wmkf_ai_displaytitle: 'Draft title',
    }));
    expect(aiPrompt.setIsCurrent).not.toHaveBeenCalled();
    expect(aiPrompt.getIdOnly).not.toHaveBeenCalled();
    const [pending, final] = auditInserts();
    expect(pending.slice(1)).toEqual(expect.arrayContaining(['draft-id', 3]));
    expect(final.slice(1)).toEqual(expect.arrayContaining(['draft-id', 'completed']));
  });

  it('publishes an unchanged draft (body equal to the draft row)', async () => {
    const r = await publishPrompt(args());
    expect(r).toMatchObject({ status: 'completed', targetVersion: 2 });
  });

  it('404 no_current_row when the name has no rows at all', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [] });
    await expect(publishPrompt(args())).rejects.toMatchObject({
      httpStatus: 404,
      body: expect.objectContaining({ status: 'no_current_row' }),
    });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('rejects a stale expectedVersion (a newer draft row appeared) before audit or write', async () => {
    await expect(publishPrompt(args({ expectedVersion: 0 }))).rejects.toMatchObject({
      httpStatus: 409,
      body: expect.objectContaining({ status: 'concurrency_conflict' }),
    });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });

  it('two simultaneous first publishes surface as partial with the current-count warning', async () => {
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'a' }, { wmkf_ai_promptid: 'b' }] });
    const r = await publishPrompt(args());
    expect(r).toMatchObject({ status: 'partial', warnings: ['invariant_violation_current_count_2'] });
  });

  it('a retry after a lost final audit resumes against the row it created', async () => {
    const created = currentRow({ version: 2, id: 'new-row' });
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [created] });
    const bodyHash = publishHash({
      body: VALID_BODY, systemPrompt: '', variables: ANALYZE_VARIABLES, outputSchema: null,
      model: 'sonnet', temperature: null, maxTokens: null,
    });
    sql.mockResolvedValueOnce({
      rows: [{ prompt_name: NAME, phase: 'pending', target_version: 2, prior_prompt_id: 'draft-id', body_hash: bodyHash, outcome_json: {} }],
    });
    const r = await publishPrompt(args({ requestId: 'retry', expectedVersion: 1 }));
    expect(r).toMatchObject({ status: 'completed', resumed: true, newPromptId: 'new-row', targetVersion: 2 });
    expect(aiPrompt.create).not.toHaveBeenCalled();
  });
});

describe('publishPrompt — first publish of a bare uncataloged draft', () => {
  it('publishes v1 for an unknown name with no version, model, variables or schema', async () => {
    const bare = {
      wmkf_ai_promptid: 'connor-draft', wmkf_ai_promptname: 'connor.budget-check',
      wmkf_promptversion: null, wmkf_ai_iscurrent: false,
      wmkf_ai_promptbody: 'Check the attached budget and list any arithmetic errors.',
      wmkf_ai_systemprompt: null, wmkf_ai_promptvariables: null, wmkf_ai_promptoutputschema: null,
      wmkf_ai_model: null, wmkf_ai_temperature: null, wmkf_ai_maxtokens: null, wmkf_ai_promptstatus: null,
    };
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [] });
    aiPrompt.listVersions.mockResolvedValue({ records: [bare] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });
    const r = await publishPrompt({
      name: 'connor.budget-check', body: bare.wmkf_ai_promptbody, systemPrompt: '',
      outputSchema: '', model: '', expectedVersion: null, profileId: 7,
    });
    expect(r).toMatchObject({ status: 'completed', targetVersion: 1, firstPublish: true });
    expect(aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      wmkf_ai_promptname: 'connor.budget-check', wmkf_promptversion: 1,
      wmkf_ai_iscurrent: true, wmkf_ai_promptstatus: 682090001,
    }));
  });
});
