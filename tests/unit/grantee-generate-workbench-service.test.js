/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/generate-service — logic-level
 * tests (adapter + generator mocked), Stage 4 series C extraction. The route
 * suite pins the envelopes; this pins the service branches: typed errors,
 * reuse/no-warm, 412 → reused|409, non-downgrade, etag fail-closed order.
 */

const getById = jest.fn();
const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
  updateById: (...a) => updateById(...a),
}));

const loadModelOverrides = jest.fn(async () => {});
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: (...a) => loadModelOverrides(...a),
}));

const generateGranteeAbstract = jest.fn();
jest.mock('../../lib/services/grantee-abstract-service', () => ({
  generateGranteeAbstract: (...a) => generateGranteeAbstract(...a),
}));

const ensureDeliverableForRequest = jest.fn();
const patchDeliverable = jest.fn(async () => {});
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  ensureDeliverableForRequest: (...a) => ensureDeliverableForRequest(...a),
  patchDeliverable: (...a) => patchDeliverable(...a),
}));

import { generateDeliverableAbstract } from '../../lib/services/workbench/grantee-deliverables/generate-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';

const GUID = '22222222-2222-2222-2222-222222222222';
const SOURCE = 'A source abstract that is definitely longer than the fifty character minimum for rewriting.';
const row = (over = {}) => ({
  akoya_requestid: GUID, akoya_requestnum: '1002794', wmkf_abstract: SOURCE, wmkf_abstractformatted: null, _etag: 'W/"1"', ...over,
});
const deliverable = (status = null) => ({ wmkf_granteedeliverableid: 'd1', wmkf_deliverablestatus: status, _etag: 'W/"2"' });
const args = (over = {}) => ({ requestId: GUID, regenerate: false, actingUserSystemId: 'sys-1', ...over });

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue(row());
  updateById.mockResolvedValue(undefined);
  generateGranteeAbstract.mockResolvedValue({ abstractFormatted: 'FORMATTED', runId: 'r1', model: 'm1' });
  ensureDeliverableForRequest.mockResolvedValue(deliverable(null));
  patchDeliverable.mockResolvedValue(undefined);
});

test('404 / 400-no-source / 503-no-etag typed errors, each before the paid call', async () => {
  getById.mockRejectedValueOnce(new Error('gone'));
  let err = await generateDeliverableAbstract(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);

  getById.mockResolvedValueOnce(row({ wmkf_abstract: 'short' }));
  err = await generateDeliverableAbstract(args()).catch((e) => e);
  expect(err.httpStatus).toBe(400);

  getById.mockResolvedValueOnce(row({ _etag: null }));
  err = await generateDeliverableAbstract(args()).catch((e) => e);
  expect(err.httpStatus).toBe(503);
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
  expect(loadModelOverrides).not.toHaveBeenCalled();
});

test('reuse-existing skips the warm and the paid call; stamps Drafted only from null', async () => {
  getById.mockResolvedValue(row({ wmkf_abstractformatted: 'existing' }));
  const body = await generateDeliverableAbstract(args());
  expect(body).toMatchObject({ reused: true, abstractFormatted: 'existing', status: GRANTEE_DELIVERABLE_STATUS.DRAFTED });
  expect(loadModelOverrides).not.toHaveBeenCalled();
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
  expect(patchDeliverable).toHaveBeenCalledWith(GUID, { wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED }, { ifMatch: 'W/"2"', actingUserSystemId: 'sys-1' });
});

test('generation failure → 500 typed; happy path warms then persists conditionally and stamps Drafted', async () => {
  generateGranteeAbstract.mockRejectedValueOnce(new Error('llm down'));
  const err = await generateDeliverableAbstract(args()).catch((e) => e);
  expect(err.httpStatus).toBe(500);
  expect(err.message).toBe('Abstract generation failed.');

  jest.clearAllMocks();
  getById.mockResolvedValue(row());
  ensureDeliverableForRequest.mockResolvedValue(deliverable(null));
  generateGranteeAbstract.mockResolvedValue({ abstractFormatted: 'FORMATTED', runId: 'r1', model: 'm1' });
  const body = await generateDeliverableAbstract(args());
  expect(loadModelOverrides).toHaveBeenCalledTimes(1);
  expect(updateById).toHaveBeenCalledWith(GUID, { wmkf_abstractformatted: 'FORMATTED' }, { ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' });
  expect(body).toEqual({
    abstractFormatted: 'FORMATTED', persisted: true, regenerated: false,
    status: GRANTEE_DELIVERABLE_STATUS.DRAFTED, statusLabel: 'Drafted', runId: 'r1', model: 'm1',
  });
});

test('412: re-read populated → reused/concurrent body; still empty → 409 typed', async () => {
  updateById.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
  getById
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce({ wmkf_abstractformatted: 'peer wrote this' });
  ensureDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.DRAFTED));
  const body = await generateDeliverableAbstract(args());
  expect(body).toMatchObject({ reused: true, concurrent: true, abstractFormatted: 'peer wrote this' });

  getById
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce({ wmkf_abstractformatted: null });
  const err = await generateDeliverableAbstract(args()).catch((e) => e);
  expect(err.httpStatus).toBe(409);
});

test('non-downgrade: regenerate at Invited persists the text but never patches status', async () => {
  getById.mockResolvedValue(row({ wmkf_abstractformatted: 'old' }));
  ensureDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const body = await generateDeliverableAbstract(args({ regenerate: true }));
  expect(patchDeliverable).not.toHaveBeenCalled();
  expect(body).toMatchObject({ regenerated: true, status: GRANTEE_DELIVERABLE_STATUS.INVITED });
});
