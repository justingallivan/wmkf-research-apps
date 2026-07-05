/**
 * Unit tests for lib/services/phase-i-dynamics/summarize-service.js
 * (Stage 5 batch 2). Logic-level; adapter, LLM, file loader, and audit
 * transport mocked. Pins the overwrite preflight + If-Match writeback +
 * needs_review audit semantics.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { logAiRun: jest.fn() },
}));
jest.mock('../../lib/utils/file-loader', () => ({
  loadFile: jest.fn(async () => ({ text: 'A'.repeat(200), filename: 'phase1.pdf' })),
}));
jest.mock('../../lib/services/llm-client', () => ({
  createLLMClient: jest.fn(() => ({
    complete: jest.fn(async () => ({
      text: 'A multi-paragraph Phase I summary that is well over twenty characters long.',
      model: 'claude-test',
    })),
  })),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { createLLMClient } from '../../lib/services/llm-client';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { summarizeToDynamics } from '../../lib/services/phase-i-dynamics/summarize-service';

const GUID = '44444444-4444-4444-4444-444444444444';
const args = (over = {}) => ({
  requestGuid: GUID,
  fileRef: { source: 'upload', fileUrl: 'https://x.public.blob.vercel-storage.com/p.pdf', filename: 'phase1.pdf' },
  apiKey: 'sk-ant-test',
  profileId: 'p1',
  actingUserSystemId: 'sys-1',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.getById.mockResolvedValue({ wmkf_ai_summary: '', modifiedon: null, _etag: 'W/"1"' });
  grantRequestAdapter.updateById.mockResolvedValue({});
  DynamicsService.logAiRun.mockResolvedValue({ id: 'audit-1' });
});

describe('summarizeToDynamics', () => {
  it('409 ServiceHttpError with the conflict body when a summary exists and overwrite is false', async () => {
    grantRequestAdapter.getById.mockResolvedValue({
      wmkf_ai_summary: 'Existing.', modifiedon: '2026-01-01T00:00:00Z', _etag: 'W/"1"',
    });
    await expect(summarizeToDynamics(args())).rejects.toMatchObject({
      httpStatus: 409,
      body: expect.objectContaining({
        conflict: expect.objectContaining({ field: 'wmkf_ai_summary', existingContent: 'Existing.' }),
      }),
    });
    expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
  });

  it('overwrite:true skips the preflight read entirely (authoritative rerun, unconditional PATCH)', async () => {
    const r = await summarizeToDynamics(args({ overwrite: true }));
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
    expect(grantRequestAdapter.updateById).toHaveBeenCalledWith(
      GUID, { wmkf_ai_summary: expect.any(String) }, { actingUserSystemId: 'sys-1' });
    expect(r.writtenToDynamics).toBe(true);
  });

  it('golden: conditional writeback with the preflight ETag; completed audit; full envelope', async () => {
    const r = await summarizeToDynamics(args());
    expect(grantRequestAdapter.updateById).toHaveBeenCalledWith(
      GUID, { wmkf_ai_summary: expect.any(String) }, { ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' });
    expect(DynamicsService.logAiRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', taskType: 'summary', rawOutputRetention: 'hash',
    }));
    expect(r).toEqual({
      summary: expect.any(String), filename: 'phase1.pdf', model: 'claude-test',
      writtenToDynamics: true, writebackFailure: null, auditLogCreated: true,
    });
  });

  it('412 writeback surfaces as the conflict category with a needs_review audit (non-fatal)', async () => {
    grantRequestAdapter.updateById.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
    const r = await summarizeToDynamics(args());
    expect(r).toMatchObject({ writtenToDynamics: false, writebackFailure: 'conflict' });
    expect(DynamicsService.logAiRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_review' }));
  });

  it('LLM failure logs a failed audit row and rethrows raw for the shell', async () => {
    createLLMClient.mockReturnValueOnce({ complete: jest.fn(async () => { throw new Error('llm down'); }) });
    await expect(summarizeToDynamics(args())).rejects.toThrow('llm down');
    expect(DynamicsService.logAiRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
  });

  it('empty summary → failed audit + 502 ServiceHttpError, no writeback', async () => {
    createLLMClient.mockReturnValueOnce({ complete: jest.fn(async () => ({ text: 'short', model: 'm' })) });
    await expect(summarizeToDynamics(args())).rejects.toBeInstanceOf(ServiceHttpError);
    expect(DynamicsService.logAiRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', rawOutput: expect.objectContaining({ error: 'empty-summary' }),
    }));
    expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
  });

  it('audit failure is non-fatal: auditLogCreated false, flow completes', async () => {
    DynamicsService.logAiRun.mockRejectedValue(new Error('audit transport down'));
    const r = await summarizeToDynamics(args());
    expect(r.writtenToDynamics).toBe(true);
    expect(r.auditLogCreated).toBe(false);
  });
});
