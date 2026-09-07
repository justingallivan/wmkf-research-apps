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
  FIELD_PRIMER_PROMPT_NAME: 'field-primer.generate',
  generateFieldPrimer: jest.fn(),
  groundPrimerExperts: jest.fn(async (experts) => experts),
}));
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  getAiProposalNarrativeText: jest.fn(),
}));
jest.mock('../../lib/services/executor-budget-service.js', () => ({
  getExecutorBudget: jest.fn(async () => ({ kind: 'timeout', timeoutMsOverride: 240000 })),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { generateFieldPrimer, groundPrimerExperts } from '../../lib/services/field-primer-service';
import { getAiProposalNarrativeText } from '../../lib/services/workbench-proposal-documents';
import { getExecutorBudget } from '../../lib/services/executor-budget-service.js';
import { FIELD_PRIMER_ENVELOPE_SCHEMA, makeFieldPrimerLease } from '../../shared/utils/field-primer-envelope';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import {
  classifyGenerationFailure, clampTimeoutToLease, generateForRequest, generateStandalone,
  LEASE_GROUNDING_RESERVE_MS, LEASE_SAFETY_MARGIN_MS, MIN_MODEL_TIMEOUT_MS,
} from '../../lib/services/field-primer/generate-service';
import { FIELD_PRIMER_LEASE_TTL_MS } from '../../shared/utils/field-primer-envelope';

const GUID = '33333333-3333-3333-3333-333333333333';
const row = (over = {}) => ({
  akoya_requestid: GUID, akoya_requestnum: '1002900', wmkf_meetingdate: '2026-06-15',
  wmkf_ai_fieldprimer: null, _etag: 'W/"1"', ...over,
});

// Default adapter behaviour once the per-test `Once` queues drain: remember the
// lease this run wrote and read it back as still-current, so conditional
// restores find our own nonce. Tests that model a peer override the readback.
let lastLease = null;
const OWN_LEASE_ETAG = 'W/"lease"';
beforeEach(() => {
  lastLease = null;
  grantRequestAdapter.getById.mockReset().mockImplementation(async () => ({ wmkf_ai_fieldprimer: lastLease, _etag: OWN_LEASE_ETAG }));
  grantRequestAdapter.updateById.mockReset().mockImplementation(async (_id, patch) => {
    if (typeof patch?.wmkf_ai_fieldprimer === 'string' && patch.wmkf_ai_fieldprimer.includes('field-primer/lease')) lastLease = patch.wmkf_ai_fieldprimer;
    return {};
  });
  generateFieldPrimer.mockReset();
  getAiProposalNarrativeText.mockReset();
  getExecutorBudget.mockReset().mockResolvedValue({ kind: 'timeout', timeoutMsOverride: 240000 });
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
    // Last write restores the PRIOR value, conditionally on the lease we still own.
    const last = grantRequestAdapter.updateById.mock.calls.at(-1);
    expect(last[1]).toEqual({ wmkf_ai_fieldprimer: prior });
    expect(last[2]).toEqual({ ifMatch: OWN_LEASE_ETAG });
  });

  it('a generation failure after a peer reclaimed the lease leaves the peer value untouched', async () => {
    const prior = JSON.stringify({ schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'old', primer: {} });
    const peerLease = makeFieldPrimerLease(new Date().toISOString(), 'peer');
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: prior }))
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: peerLease, _etag: 'W/"9"' });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockRejectedValueOnce(new Error('llm down'));
    await expect(generateForRequest({ requestId: GUID, regenerate: true })).rejects.toMatchObject({ httpStatus: 500 });
    const priorWrites = grantRequestAdapter.updateById.mock.calls.filter(([, patch]) => patch.wmkf_ai_fieldprimer === prior);
    expect(priorWrites).toHaveLength(0);
  });

  it('a proposal pull that exhausts the lease stops before the paid model call and restores conditionally', async () => {
    const prior = JSON.stringify({ schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'old', primer: {} });
    const base = Date.now();
    let clock = base;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      grantRequestAdapter.getById.mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: prior }));
      getAiProposalNarrativeText.mockImplementation(async () => { clock += FIELD_PRIMER_LEASE_TTL_MS; return { text: 'A'.repeat(60) }; });
      await expect(generateForRequest({ requestId: GUID, regenerate: true })).rejects.toMatchObject({
        httpStatus: 504,
        code: 'field_primer_lease_exhausted',
      });
      expect(generateFieldPrimer).not.toHaveBeenCalled();
      const last = grantRequestAdapter.updateById.mock.calls.at(-1);
      expect(last[1]).toEqual({ wmkf_ai_fieldprimer: prior });
      expect(last[2]).toEqual({ ifMatch: OWN_LEASE_ETAG });
    } finally {
      nowSpy.mockRestore();
      getAiProposalNarrativeText.mockReset();
    }
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
      { ifMatch: OWN_LEASE_ETAG },
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

  it('passes the published field-primer timeout to the generator, read before the lease is claimed', async () => {
    const calls = [];
    getExecutorBudget.mockImplementation(async (name) => { calls.push(`budget:${name}`); return { kind: 'timeout', timeoutMsOverride: 180000 }; });
    grantRequestAdapter.updateById.mockImplementation(async () => { calls.push('lease'); return {}; });
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: null, _etag: 'W/"2"' });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValueOnce({ primer: { experts: [] }, runId: 'r', model: 'm' });
    await generateForRequest({ requestId: GUID });
    expect(calls.slice(0, 2)).toEqual(['budget:field-primer.generate', 'lease']);
    expect(generateFieldPrimer).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 180000 }));
  });

  it('a budget read failure falls back to the registry default timeout and still generates', async () => {
    getExecutorBudget.mockRejectedValueOnce(new Error('settings down'));
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: null, _etag: 'W/"2"' });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValueOnce({ primer: { experts: [] }, runId: 'r', model: 'm' });
    await generateForRequest({ requestId: GUID });
    expect(generateFieldPrimer).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 240000 }));
  });

  it('grounding receives an abort signal bounded by the lease deadline', async () => {
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: null, _etag: 'W/"2"' });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValueOnce({ primer: { experts: [{ name: 'Ada Lovelace' }] }, runId: 'r', model: 'm' });
    await generateForRequest({ requestId: GUID });
    expect(groundPrimerExperts).toHaveBeenCalledWith(
      [{ name: 'Ada Lovelace' }],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('a failed final persist restores the prior value only while our lease nonce is still stored', async () => {
    const prior = JSON.stringify({ schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'old', primer: {} });
    let leaseWritten = null;
    grantRequestAdapter.updateById.mockImplementation(async (_id, patch, opts) => {
      if (typeof patch.wmkf_ai_fieldprimer === 'string' && patch.wmkf_ai_fieldprimer.includes('field-primer/lease')) {
        leaseWritten = patch.wmkf_ai_fieldprimer; return {};
      }
      if (opts?.ifMatch === 'W/"2"') throw Object.assign(new Error('dataverse write refused'), { status: 500 });
      return {};
    });
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: prior }))
      .mockImplementationOnce(async () => ({ wmkf_ai_fieldprimer: leaseWritten, _etag: 'W/"2"' }))   // pre-persist readback: still ours
      .mockImplementationOnce(async () => ({ wmkf_ai_fieldprimer: leaseWritten, _etag: 'W/"3"' }));  // restore readback: still ours
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValueOnce({ primer: { experts: [] }, runId: 'r', model: 'm' });
    const r = await generateForRequest({ requestId: GUID, regenerate: true });
    expect(r).toMatchObject({ persisted: false, persistError: true });
    const last = grantRequestAdapter.updateById.mock.calls.at(-1);
    expect(last[1]).toEqual({ wmkf_ai_fieldprimer: prior });
    expect(last[2]).toEqual({ ifMatch: 'W/"3"' });
  });

  it('a failed final persist does not touch the field when a peer has reclaimed the lease', async () => {
    const prior = JSON.stringify({ schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'old', primer: {} });
    grantRequestAdapter.updateById.mockImplementation(async (_id, patch, opts) => {
      if (opts?.ifMatch === 'W/"2"') throw new Error('dataverse write refused');
      return {};
    });
    const peerLease = makeFieldPrimerLease(new Date().toISOString(), 'peer');
    let leaseWritten = null;
    grantRequestAdapter.updateById.mockImplementation(async (_id, patch, opts) => {
      if (opts?.ifMatch === 'W/"1"') { leaseWritten = patch.wmkf_ai_fieldprimer; return {}; }
      if (opts?.ifMatch === 'W/"2"') throw new Error('dataverse write refused');
      return {};
    });
    grantRequestAdapter.getById
      .mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: prior }))
      .mockImplementationOnce(async () => ({ wmkf_ai_fieldprimer: leaseWritten, _etag: 'W/"2"' }))
      .mockResolvedValueOnce({ wmkf_ai_fieldprimer: peerLease, _etag: 'W/"9"' });
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockResolvedValueOnce({ primer: { experts: [] }, runId: 'r', model: 'm' });
    const r = await generateForRequest({ requestId: GUID, regenerate: true });
    expect(r).toMatchObject({ persisted: false, persistError: true });
    const writes = grantRequestAdapter.updateById.mock.calls.filter(([, patch]) => patch.wmkf_ai_fieldprimer === prior);
    expect(writes).toHaveLength(0);
  });

  it('a transport timeout restores the prior value and surfaces a 504 naming the seconds and the Admin path', async () => {
    const prior = JSON.stringify({ schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: 'old', primer: {} });
    grantRequestAdapter.getById.mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: prior }));
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockRejectedValueOnce(new Error('Claude API timeout after 240000ms'));
    await expect(generateForRequest({ requestId: GUID, regenerate: true })).rejects.toMatchObject({
      httpStatus: 504,
      code: 'field_primer_generation_timeout',
      message: expect.stringMatching(/timed out: the model did not finish within 240 seconds.*Admin → Prompt templates → Executor output budgets/),
    });
    const last = grantRequestAdapter.updateById.mock.calls.at(-1);
    expect(last[1]).toEqual({ wmkf_ai_fieldprimer: prior });
  });

  it('a provider HTTP error surfaces a short 502 without the raw message', async () => {
    grantRequestAdapter.getById.mockResolvedValueOnce(row());
    getAiProposalNarrativeText.mockResolvedValue({ text: 'A'.repeat(60) });
    generateFieldPrimer.mockRejectedValueOnce(Object.assign(new Error('overloaded: secret-ish detail'), { status: 529 }));
    await expect(generateForRequest({ requestId: GUID })).rejects.toMatchObject({
      httpStatus: 502,
      code: 'field_primer_provider_error',
      message: 'Field primer generation failed: the model provider returned HTTP 529. Try again in a few minutes.',
    });
  });
});

describe('clampTimeoutToLease', () => {
  it('leaves the published timeout alone when the lease has room, clamps it when the pull ate part of the lease, and returns null below the model minimum', () => {
    const start = 1_000_000;
    const deadline = start + FIELD_PRIMER_LEASE_TTL_MS;
    expect(clampTimeoutToLease(240000, deadline, start)).toBe(240000);
    const late = deadline - LEASE_GROUNDING_RESERVE_MS - LEASE_SAFETY_MARGIN_MS - 100000;
    expect(clampTimeoutToLease(240000, deadline, late)).toBe(100000);
    expect(clampTimeoutToLease(240000, deadline, deadline - LEASE_GROUNDING_RESERVE_MS - LEASE_SAFETY_MARGIN_MS - MIN_MODEL_TIMEOUT_MS)).toBe(MIN_MODEL_TIMEOUT_MS);
    expect(clampTimeoutToLease(240000, deadline, deadline - LEASE_GROUNDING_RESERVE_MS - LEASE_SAFETY_MARGIN_MS - MIN_MODEL_TIMEOUT_MS + 1)).toBeNull();
    expect(clampTimeoutToLease(240000, deadline, deadline)).toBeNull();
  });
});

describe('classifyGenerationFailure', () => {
  it('maps timeout, provider status, and everything else to distinct typed errors', () => {
    expect(classifyGenerationFailure(new Error('Claude API timeout after 120000ms'), { timeoutMs: 120000 }))
      .toMatchObject({ httpStatus: 504, code: 'field_primer_generation_timeout', message: expect.stringContaining('within 120 seconds') });
    expect(classifyGenerationFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      .toMatchObject({ httpStatus: 504, message: expect.stringContaining('did not finish in time') });
    expect(classifyGenerationFailure(Object.assign(new Error('x'), { status: 429 })))
      .toMatchObject({ httpStatus: 502, code: 'field_primer_provider_error' });
    expect(classifyGenerationFailure(new Error('llm down')))
      .toMatchObject({ httpStatus: 500, code: 'field_primer_generation_failed', message: 'Field primer generation failed.' });
    expect(classifyGenerationFailure(null)).toMatchObject({ httpStatus: 500 });
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

  it('does not read the Executor budget or set a timeout (standalone keeps the client default)', async () => {
    generateFieldPrimer.mockResolvedValueOnce({ primer: { experts: [] }, runId: 'r', model: 'm' });
    await generateStandalone({ proposalText: 'B'.repeat(60) });
    expect(getExecutorBudget).not.toHaveBeenCalled();
    expect(generateFieldPrimer.mock.calls[0][0]).not.toHaveProperty('timeoutMs');
  });
});
