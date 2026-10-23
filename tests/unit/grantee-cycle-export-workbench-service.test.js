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
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  queryAllRequests.mockResolvedValue({ records: [
    { akoya_requestid: 'a', akoya_requestnum: '1001' },
    { akoya_requestid: 'b', akoya_requestnum: '1002' },
  ], totalCount: 2, capped: false });
  assembleGranteeDocument.mockResolvedValue({ institution: 'X' });
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('Stage 1d: cycle export filters name marker fields only when enabled', async () => {
  await exportGranteeCycle({ cycleCode: 'J26' });
  expect(queryAllRequests.mock.calls[0][0].filter).not.toContain('wmkf_istestrequest');
  process.env.TEST_REQUEST_ISOLATION = 'on';
  await exportGranteeCycle({ cycleCode: 'J26' });
  expect(queryAllRequests.mock.calls[1][0].filter).toContain('wmkf_istestrequest');
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
  expect(opts).toEqual({
    cycleLabel: 'June 2026', includeImage: true, capped: false, totalCount: 2, returnedCount: 2,
    omittedCount: 1, omittedRequestNumbers: ['1002'], omittedRequestNumbersTruncated: false,
  });
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

test('null assembly results retain their matching omitted request IDs in order', async () => {
  queryAllRequests.mockResolvedValue({
    records: [
      { akoya_requestid: 'a', akoya_requestnum: '1001' },
      { akoya_requestid: 'b', akoya_requestnum: '1002' },
      { akoya_requestid: 'c', akoya_requestnum: '1003' },
    ],
    totalCount: 3, capped: false,
  });
  assembleGranteeDocument.mockImplementation(async (id) => id === 'b' ? null : ({ institution: id }));
  await exportGranteeCycle({ cycleCode: 'J26' });
  expect(renderCyclePage.mock.calls[0][0]).toEqual([{ institution: 'a' }, { institution: 'c' }]);
  expect(renderCyclePage.mock.calls[0][1]).toMatchObject({ omittedCount: 1, omittedRequestNumbers: ['1002'] });
});

test('omitted request numbers passed to the renderer are bounded and keep the full omission count', async () => {
  const ids = Array.from({ length: 25 }, (_, index) => `request-${index}`);
  const numbers = Array.from({ length: 25 }, (_, index) => String(1000 + index));
  queryAllRequests.mockResolvedValue({ records: ids.map((akoya_requestid, index) => ({ akoya_requestid, akoya_requestnum: numbers[index] })), totalCount: 25, capped: false });
  assembleGranteeDocument.mockResolvedValue(null);
  await exportGranteeCycle({ cycleCode: 'J26' });
  expect(renderCyclePage.mock.calls[0][1]).toMatchObject({
    omittedCount: 25, omittedRequestNumbers: numbers.slice(0, 20), omittedRequestNumbersTruncated: true,
  });
});

test('missing request numbers use a safe label instead of passing internal request IDs', async () => {
  queryAllRequests.mockResolvedValue({ records: [{ akoya_requestid: 'internal-guid' }], totalCount: 1, capped: false });
  assembleGranteeDocument.mockRejectedValue(new Error('unavailable'));
  await exportGranteeCycle({ cycleCode: 'J26' });
  const options = renderCyclePage.mock.calls[0][1];
  expect(options.omittedRequestNumbers).toEqual(['Request number unavailable']);
  expect(options).not.toHaveProperty('omittedIds');
  expect(queryAllRequests.mock.calls[0][0].select).toContain('akoya_requestnum');
});
