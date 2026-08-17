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

import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt';
import { sql } from '@vercel/postgres';
import { ServiceHttpError } from '../../lib/services/service-http-error';
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
    sql.mockResolvedValueOnce({ rows: [{ phase: 'final', status: 'completed', new_prompt_id: 'n1', target_version: 9, body_hash: bodyHash }] });
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
        phase: 'pending',
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
