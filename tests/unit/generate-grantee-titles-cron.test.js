/**
 * generate-grantee-titles cron — fills wmkf_wmkfprojectdescription (the edited
 * board-summary title) for research proposals newly at wmkf_phaseistatus=Invited,
 * write-when-empty + ETag-conditional. Covers the guard, the predicate, paginated
 * query + capped, per-row fail-soft (missing source / generation failure), the
 * TOCTOU skips (field re-filled, 412), invalid cycle, and model-override warming.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn(async () => {}) }));
jest.mock('../../lib/services/grantee-title-service', () => ({ generateGranteeTitle: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryAllRecords: jest.fn(), getRecord: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../shared/config/granteeResearchPrograms', () => ({
  GRANTEE_RESEARCH_PROGRAM_IDS: ['prog-a', 'prog-b'],
}));

import handler from '../../pages/api/cron/generate-grantee-titles';
import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { generateGranteeTitle } from '../../lib/services/grantee-title-service';
import { DynamicsService } from '../../lib/services/dynamics-service';

function makeRes() {
  return {
    statusCode: 200, body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}
const req = (query = { cycleCode: 'J26' }, method = 'POST') => ({ method, headers: {}, query });
const row = (n) => ({ akoya_requestid: `id-${n}`, akoya_requestnum: `100${n}`, akoya_title: `Title ${n}`, wmkf_abstract: 'x'.repeat(120) });

beforeEach(() => {
  jest.clearAllMocks();
  verifyCronSecret.mockReturnValue(true);
  generateGranteeTitle.mockResolvedValue({ editedTitle: 'To do science' });
  DynamicsService.getRecord.mockResolvedValue({ wmkf_wmkfprojectdescription: null, _etag: 'etag-1' });
  DynamicsService.updateRecord.mockResolvedValue({});
});

test('happy path: generates + ETag-writes each empty row, warms overrides first', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1), row(2)], capped: false });
  const res = makeRes();
  await handler(req(), res);

  expect(loadModelOverrides).toHaveBeenCalledTimes(1);
  expect(generateGranteeTitle).toHaveBeenCalledTimes(2);
  expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
    'akoya_requests', 'id-1', { wmkf_wmkfprojectdescription: 'To do science' }, { ifMatch: 'etag-1' },
  );
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ cycleCode: 'J26', scanned: 2, generated: 2, failed: 0, deferred: 0 });
});

test('predicate filters on cycle + Invited + research programs + empty description', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [], capped: false });
  await handler(req(), makeRes());
  const { filter } = DynamicsService.queryAllRecords.mock.calls[0][1];
  expect(filter).toContain('wmkf_meetingdate ge 2026-06-01');         // J26 window
  expect(filter).toContain('wmkf_phaseistatus eq 100000003');          // Invited
  expect(filter).toContain('wmkf_wmkfprojectdescription eq null');     // write-when-empty
  expect(filter).toContain('_akoya_programid_value eq prog-a');        // research only
});

test('rejects an unauthenticated call before any query', async () => {
  verifyCronSecret.mockReturnValue(false);
  await handler(req(), makeRes());
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  expect(loadModelOverrides).not.toHaveBeenCalled();
});

test('invalid cycleCode → 400, no query', async () => {
  const res = makeRes();
  await handler(req({ cycleCode: 'XYZ' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});

test('missing/short source → skippedNoSource, no generation', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [{ ...row(1), wmkf_abstract: 'too short' }], capped: false });
  const res = makeRes();
  await handler(req(), res);
  expect(generateGranteeTitle).not.toHaveBeenCalled();
  expect(res.body).toMatchObject({ skippedNoSource: 1, generated: 0 });
});

test('generation failure is fail-soft: counted, no write, field left empty (retried next run)', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1), row(2)], capped: false });
  generateGranteeTitle.mockRejectedValueOnce(new Error('503 service unavailable'));
  const res = makeRes();
  await handler(req(), res);
  expect(res.body).toMatchObject({ scanned: 2, generated: 1, failed: 1 });
  expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1); // only the successful row
});

test('field re-filled between query and write → skippedConcurrent, never overwrites', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1)], capped: false });
  DynamicsService.getRecord.mockResolvedValue({ wmkf_wmkfprojectdescription: 'staff wrote this', _etag: 'e' });
  const res = makeRes();
  await handler(req(), res);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(res.body).toMatchObject({ skippedConcurrent: 1, generated: 0 });
});

test('412 on the conditional write → skippedConcurrent', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1)], capped: false });
  DynamicsService.updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const res = makeRes();
  await handler(req(), res);
  expect(res.body).toMatchObject({ skippedConcurrent: 1, generated: 0, failed: 0 });
});

test('refuses a bare write when no _etag is present', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1)], capped: false });
  DynamicsService.getRecord.mockResolvedValue({ wmkf_wmkfprojectdescription: null }); // no _etag
  const res = makeRes();
  await handler(req(), res);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(res.body).toMatchObject({ failed: 1, generated: 0 });
});

test('top-level query failure → 503 (whole run retried next)', async () => {
  DynamicsService.queryAllRecords.mockRejectedValue(new Error('dataverse down'));
  const res = makeRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(503);
});

test('honors capped + folds the unreturned remainder (totalCount - scanned) into deferred', async () => {
  // capped query returned 1 of 5 matching rows → 4 unreturned remainder is deferred.
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1)], totalCount: 5, capped: true });
  const res = makeRes();
  await handler(req(), res);
  expect(res.body).toMatchObject({ capped: true, totalCount: 5, scanned: 1, generated: 1, deferred: 4 });
});

test('rejects a disallowed method with 405 + Allow header', async () => {
  const res = makeRes();
  await handler(req(undefined, 'PUT'), res);
  expect(res.statusCode).toBe(405);
  expect(res._headers.Allow).toBe('GET, POST');
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});

test('time-budget exhausted → unprocessed rows are deferred (not generated)', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [row(1), row(2)], totalCount: 2, capped: false });
  // Deadline computed from the first Date.now(); every subsequent check is past it,
  // so workers return before claiming any row.
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(1_000_000);
  const res = makeRes();
  await handler(req(), res);
  nowSpy.mockRestore();
  expect(generateGranteeTitle).not.toHaveBeenCalled();
  expect(res.body).toMatchObject({ scanned: 2, generated: 0, deferred: 2 });
});
