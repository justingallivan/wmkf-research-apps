/**
 * Unit tests for lib/services/field-primer/generate-service.js
 * (Stage 5 batch 1). Logic-level, adapter + generation mocked. The lease
 * (ETag + nonce) single-flight semantics are the high-risk surface.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/services/field-primer-service', () => ({
  generateFieldPrimer: jest.fn(),
  groundPrimerExperts: jest.fn(async (experts) => experts),
}));
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  getAiProposalNarrativeText: jest.fn(),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { generateFieldPrimer } from '../../lib/services/field-primer-service';
import { getAiProposalNarrativeText } from '../../lib/services/workbench-proposal-documents';
import { FIELD_PRIMER_ENVELOPE_SCHEMA, makeFieldPrimerLease } from '../../shared/utils/field-primer-envelope';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { generateForRequest, generateStandalone } from '../../lib/services/field-primer/generate-service';

const GUID = '33333333-3333-3333-3333-333333333333';
const row = (over = {}) => ({
  akoya_requestid: GUID, akoya_requestnum: '1002900', wmkf_meetingdate: '2026-06-15',
  wmkf_ai_fieldprimer: null, _etag: 'W/"1"', ...over,
});

beforeEach(() => {
  grantRequestAdapter.getById.mockReset();
  grantRequestAdapter.updateById.mockReset().mockResolvedValue({});
  generateFieldPrimer.mockReset();
  getAiProposalNarrativeText.mockReset();
});

describe('generateForRequest (Mode A)', () => {
  it('404 ServiceHttpError when the request is missing', async () => {
    grantRequestAdapter.getById.mockRejectedValueOnce(new Error('nf'));
    await expect(generateForRequest({ requestId: GUID })).rejects.toMatchObject({
      httpStatus: 404, message: `No request found for ${GUID}`,
    });
    expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
  });

  it('reuses a stored envelope without a paid call', async () => {
    const envelope = { schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'x', primer: { experts: [] } };
    grantRequestAdapter.getById.mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: JSON.stringify(envelope) }));
    const r = await generateForRequest({ requestId: GUID });
    expect(r).toEqual({ envelope, persisted: true, reused: true });
    expect(generateFieldPrimer).not.toHaveBeenCalled();
  });

  it('a fresh peer lease returns { status: generating } and never claims', async () => {
    grantRequestAdapter.getById.mockResolvedValueOnce(
      row({ wmkf_ai_fieldprimer: makeFieldPrimerLease(new Date().toISOString(), 'peer') }),
    );
    const r = await generateForRequest({ requestId: GUID });
    expect(r).toEqual({ status: 'generating' });
    expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
  });

  it('503 ServiceHttpError when the record carries no ETag (lock unacquirable)', async () => {
    grantRequestAdapter.getById.mockResolvedValueOnce(row({ _etag: undefined }));
    await expect(generateForRequest({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 503 });
  });

  it('lost lease-claim race: re-reads and prefers the stored result', async () => {
    const envelope = { schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'x', primer: { experts: [] } };
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: JSON.stringify(envelope) });
    grantRequestAdapter.updateById.mockRejectedValueOnce(Object.assign(new Error('precondition'), { status: 412 }));
    const r = await generateForRequest({ requestId: GUID });
    expect(r).toEqual({ envelope, persisted: true, reused: true });
  });

  it('generation failure restores the prior field value, then throws 500', async () => {
    const prior = JSON.stringify({ schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'old', primer: {} });
    // Prior value present but regenerate:true so we pass the reuse gate.
    grantRequestAdapter.getById.mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: prior }));
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockRejectedValueOnce(new Error('llm down'));
    await expect(generateForRequest({ requestId: GUID, regenerate: true })).rejects.toMatchObject({ httpStatus: 500 });
    // Last write restores the PRIOR value (unconditional).
    const last = grantRequestAdapter.updateById.mock.calls.at(-1);
    expect(last[1]).toEqual({ wmkf_ai_fieldprimer: prior });
    expect(last[2]).toBeUndefined();
  });

  it('missing AI proposal narrative restores the prior value and stops before generation', async () => {
    grantRequestAdapter.getById.mockResolvedValueOnce(row());
    getAiProposalNarrativeText.mockResolvedValue(null);

    await expect(generateForRequest({ requestId: GUID })).rejects.toMatchObject({
      httpStatus: 400,
      message:
        'No readable AI proposal narrative was found at AI Materials/ProposalNarrative_1002900.pdf.',
    });
    expect(getAiProposalNarrativeText).toHaveBeenCalledWith(GUID, '1002900');
    expect(generateFieldPrimer).not.toHaveBeenCalled();
    expect(grantRequestAdapter.updateById).toHaveBeenLastCalledWith(
      GUID,
      { wmkf_ai_fieldprimer: null },
    );
  });

  it('golden: claims lease with ifMatch, persists conditionally when nonce still owned', async () => {
    let writtenLease = null;
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row())
      .mockImplementationOnce(async () => ({ wmkf_ai_fieldprimer: writtenLease, _etag: 'W/"2"' }));
    grantRequestAdapter.updateById.mockImplementation(async (_id, data) => {
      if (typeof data.wmkf_ai_fieldprimer === 'string' && data.wmkf_ai_fieldprimer.includes('field-primer/lease')) {
        writtenLease = data.wmkf_ai_fieldprimer;
      }
      return {};
    });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValue({
      primer: { experts: [] }, model: 'claude-test', runId: 'run-1', promptName: 'field-primer', promptVersion: 1,
    });

    const r = await generateForRequest({ requestId: GUID });
    expect(getAiProposalNarrativeText).toHaveBeenCalledWith(GUID, '1002900');
    expect(r.persisted).toBe(true);
    expect(r.envelope.model).toBe('claude-test');
    expect(grantRequestAdapter.updateById).toHaveBeenNthCalledWith(
      1, GUID, { wmkf_ai_fieldprimer: expect.any(String) }, { ifMatch: 'W/"1"' });
    expect(grantRequestAdapter.updateById).toHaveBeenNthCalledWith(
      2, GUID, { wmkf_ai_fieldprimer: JSON.stringify(r.envelope) }, { ifMatch: 'W/"2"' });
  });

  it('lost ownership at persist time: returns the peer envelope as reused', async () => {
    const peerEnvelope = { schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'peer', primer: {} };
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: JSON.stringify(peerEnvelope), _etag: 'W/"9"' });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValue({ primer: {}, model: 'm', runId: 'r', promptName: 'p' });
    const r = await generateForRequest({ requestId: GUID });
    expect(r).toEqual({ envelope: peerEnvelope, persisted: true, reused: true });
    // Only the lease claim was written — never a clobbering persist.
    expect(grantRequestAdapter.updateById).toHaveBeenCalledTimes(1);
  });
});

describe('generateStandalone (Mode B)', () => {
  it('returns { primer, runId, model } with no adapter access', async () => {
    generateFieldPrimer.mockResolvedValue({ primer: { experts: [] }, runId: 'run-2', model: 'm' });
    const r = await generateStandalone({ proposalText: 'B'.repeat(60), focus: 'genomics' });
    expect(r).toEqual({ primer: { experts: [] }, runId: 'run-2', model: 'm' });
    expect(generateFieldPrimer).toHaveBeenCalledWith({
      proposalText: 'B'.repeat(60), focus: 'genomics', runSource: 'Vercel Interactive',
    });
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
    expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
  });

  it('wraps generation failure in a 500 ServiceHttpError', async () => {
    generateFieldPrimer.mockRejectedValueOnce(new Error('llm down'));
    await expect(generateStandalone({ proposalText: 'B'.repeat(60) })).rejects.toBeInstanceOf(ServiceHttpError);
  });
});
