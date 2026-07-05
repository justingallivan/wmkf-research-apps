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

const NAME = 'reviewer-finder.analyze';
const VALID_BODY = ANALYZE_USER_PROMPT_TEMPLATE;
const currentRow = ({ version = 3, id = 'prior', body = VALID_BODY, model = 'sonnet' } = {}) => ({
  wmkf_ai_promptid: id, wmkf_ai_promptname: NAME, wmkf_promptversion: version,
  wmkf_ai_iscurrent: true, wmkf_ai_promptbody: body, wmkf_ai_model: model,
});

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

  it('idempotent replay: a prior final audit row short-circuits before Dataverse', async () => {
    sql.mockResolvedValueOnce({ rows: [{ status: 'completed', new_prompt_id: 'n1', target_version: 9 }] });
    const r = await publishPrompt(args({ requestId: 'req-1' }));
    expect(r).toEqual({ status: 'already_published', newPromptId: 'n1', version: 9, idempotentReplay: true });
    expect(aiPrompt.queryCurrentRows).not.toHaveBeenCalled();
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
