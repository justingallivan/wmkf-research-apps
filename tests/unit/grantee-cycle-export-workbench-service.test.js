/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/cycle-export-service —
 * logic-level tests (adapter + assembly mocked), Stage 4 series C extraction.
 * Pins the typed 503 { error, cycleCode } body, fail-soft bounded assembly,
 * capped pass-through, and that the service returns { html } (never touches res).
 */

const queryAllRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: (...a) => queryAllRequests(...a),
}));

const assembleGranteeDocument = jest.fn();
jest.mock('../../lib/services/grantee-document-assembly', () => ({
  assembleGranteeDocument: (...a) => assembleGranteeDocument(...a),
}));

const renderCyclePage = jest.fn(() => '<!DOCTYPE html><html>page</html>');
jest.mock('../../lib/services/grantee-document-html', () => ({
  renderCyclePage: (...a) => renderCyclePage(...a),
}));

import { exportGranteeCycle } from '../../lib/services/workbench/grantee-deliverables/cycle-export-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

beforeEach(() => {
  jest.clearAllMocks();
  queryAllRequests.mockResolvedValue({ records: [{ akoya_requestid: 'a' }, { akoya_requestid: 'b' }], totalCount: 2, capped: false });
  assembleGranteeDocument.mockResolvedValue({ institution: 'X' });
});

test('query failure → typed 503 with the { error, cycleCode } body', async () => {
  queryAllRequests.mockRejectedValue(new Error('down'));
  const err = await exportGranteeCycle({ cycleCode: 'J26' }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
  expect(err.body).toEqual({ error: 'Awardee query failed.', cycleCode: 'J26' });
});

test('fail-soft: a failed assembly is skipped; renderer receives only successful models + counts', async () => {
  assembleGranteeDocument.mockImplementation((id) => (id === 'a' ? Promise.resolve({ institution: 'Caltech' }) : Promise.reject(new Error('boom'))));
  const { html } = await exportGranteeCycle({ cycleCode: 'J26' });
  expect(html).toContain('page');
  const [models, opts] = renderCyclePage.mock.calls[0];
  expect(models).toEqual([{ institution: 'Caltech' }]);
  expect(opts).toEqual({ cycleLabel: 'June 2026', includeImage: true, capped: false, totalCount: 2, returnedCount: 2 });
  expect(assembleGranteeDocument).toHaveBeenCalledWith('a', { includeImageRef: true });
});

test('capped query flag passes through to the renderer', async () => {
  queryAllRequests.mockResolvedValue({ records: [{ akoya_requestid: 'a' }], totalCount: 30, capped: true });
  await exportGranteeCycle({ cycleCode: 'J26' });
  expect(renderCyclePage.mock.calls[0][1]).toMatchObject({ capped: true, totalCount: 30, returnedCount: 1 });
});

test('empty cycle renders with zero models and never calls assembly', async () => {
  queryAllRequests.mockResolvedValue({ records: [], totalCount: 0, capped: false });
  const out = await exportGranteeCycle({ cycleCode: 'J26' });
  expect(out).toEqual({ html: '<!DOCTYPE html><html>page</html>' });
  expect(assembleGranteeDocument).not.toHaveBeenCalled();
});
