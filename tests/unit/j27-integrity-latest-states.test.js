/**
 * @jest-environment node
 *
 * j27-integrity-jobs — `readLatestIntegrityStates` (J27 read model, plan C1
 * `integrity`): global-latest winner, provenance by job association, target
 * applied after selection, the writer's flag predicate over results.
 */
const mockSql = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (...args) => mockSql(...args) }));
jest.mock('../../lib/services/workbench/j27-integrity-simulation', () => ({ getJ27IntegritySimulationSql: () => null }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), findByIds: jest.fn() }));

import { readLatestIntegrityStates, isFlaggedIntegrityResults } from '../../lib/services/workbench/j27-integrity-jobs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TARGET = 'orgd9e66399.crm.dynamics.com';

beforeEach(() => jest.clearAllMocks());

test('the query picks the global latest per request and binds the id list', async () => {
  mockSql.mockResolvedValue({ rows: [] });
  const out = await readLatestIntegrityStates(TARGET, [A, 'junk', B]);
  expect(out.size).toBe(0);
  const [strings, ids] = mockSql.mock.calls[0];
  const text = strings.join('?');
  expect(text).toContain('DISTINCT ON (screening.request_id)');
  expect(text).toContain('ORDER BY screening.request_id, screening.created_at DESC, screening.id DESC');
  expect(text).toContain('LEFT JOIN j27_integrity_jobs AS job ON job.screening_id = screening.id');
  expect(text).toContain('integrity_screening_reviews');
  expect(ids).toEqual([A, B]);
});

test('an empty id list never queries', async () => {
  expect(await readLatestIntegrityStates(TARGET, [])).toEqual(new Map());
  expect(mockSql).not.toHaveBeenCalled();
});

test('provenance, flag, review and target posture per winner', async () => {
  mockSql.mockResolvedValue({ rows: [
    { request_id: A.toUpperCase(), results: [{ hasConcerns: true, matchCount: 0 }], job_target_host: TARGET, automated: true, reviewed: false },
    { request_id: B, results: [{ hasConcerns: false, matchCount: '0' }], job_target_host: null, automated: false, reviewed: true },
  ] });
  const out = await readLatestIntegrityStates(TARGET, [A, B]);
  expect(out.get(A)).toEqual({ status: 'present', latest: { flagged: true, reviewed: false, provenance: 'automated' } });
  expect(out.get(B)).toEqual({ status: 'present', latest: { flagged: false, reviewed: true, provenance: 'manual-unverified-target' } });
});

test('an automated winner from another target is unavailable; a null target accepts it', async () => {
  const rows = [{ request_id: A, results: [{ matchCount: 2 }], job_target_host: 'other.crm.dynamics.com', automated: true, reviewed: false }];
  mockSql.mockResolvedValue({ rows });
  expect((await readLatestIntegrityStates(TARGET, [A])).get(A)).toEqual({ status: 'unavailable', detail: 'other-target-latest' });
  mockSql.mockResolvedValue({ rows });
  expect((await readLatestIntegrityStates(null, [A])).get(A)).toEqual({ status: 'present', latest: { flagged: true, reviewed: false, provenance: 'automated' } });
});

test('a failed query propagates to the caller, which marks the key unavailable', async () => {
  mockSql.mockRejectedValue(new Error('connection refused'));
  await expect(readLatestIntegrityStates(TARGET, [A])).rejects.toThrow('connection refused');
});

test('flag predicate is the writer\'s: concerns or any positive match count over results', () => {
  expect(isFlaggedIntegrityResults([{ hasConcerns: true }])).toBe(true);
  expect(isFlaggedIntegrityResults([{ matchCount: 1 }])).toBe(true);
  expect(isFlaggedIntegrityResults([{ matchCount: 0 }, { hasConcerns: false }])).toBe(false);
  expect(isFlaggedIntegrityResults(null)).toBe(false);
});
