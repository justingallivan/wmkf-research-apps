/** @jest-environment node */
// Request-linked Workbench screenings (request_id set) must not appear in, or
// be changed through, the standalone Integrity Screener history and dismiss
// paths. The fake SQL applies the request_id filter only when the query text
// carries it, so an unfiltered query leaks the linked row.
const mockSql = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (...args) => mockSql(...args) }));
const { IntegrityService } = require('../../lib/services/integrity-service');

const PROFILE = 7;
const LEGACY = { id: 1, user_profile_id: PROFILE, request_id: null, status: 'pending' };
const LINKED = { id: 2, user_profile_id: PROFILE, request_id: '11111111-1111-4111-8111-111111111111', status: 'pending' };

let rows;
let dismissals;

function visible(query) {
  return rows.filter((row) => !query.includes('request_id IS NULL') || row.request_id === null);
}

beforeEach(() => {
  rows = [{ ...LEGACY }, { ...LINKED }];
  dismissals = [];
  mockSql.mockReset().mockImplementation((parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ');
    if (query.startsWith(' SELECT id, screening_type')) {
      return Promise.resolve({ rows: visible(query).filter((row) => row.user_profile_id === values[0]) });
    }
    if (query.includes('SELECT * FROM integrity_screenings')) {
      const [id, profileId] = values;
      return Promise.resolve({ rows: visible(query).filter((row) => row.id === id && (profileId === undefined || row.user_profile_id === profileId)) });
    }
    if (query.includes('SELECT * FROM screening_dismissals')) return Promise.resolve({ rows: [] });
    if (query.includes('UPDATE integrity_screenings')) {
      const [status, , id] = values;
      for (const row of visible(query)) if (row.id === id) row.status = status;
      return Promise.resolve({ rows: [] });
    }
    if (query.includes('INSERT INTO screening_dismissals')) {
      const id = values[0];
      const allowed = !query.includes('WHERE EXISTS') || visible(query).some((row) => row.id === id);
      if (!allowed) return Promise.resolve({ rows: [] });
      dismissals.push(id);
      return Promise.resolve({ rows: [{ id: dismissals.length }] });
    }
    throw new Error(`unexpected query: ${query}`);
  });
});

test('standalone history lists only unlinked screenings', async () => {
  const history = await IntegrityService.getScreeningHistory(PROFILE);
  expect(history.map((row) => row.id)).toEqual([LEGACY.id]);
});

test('getScreening hides a request-linked row from its owner and from the unscoped read', async () => {
  expect(await IntegrityService.getScreening(LINKED.id, PROFILE)).toBeNull();
  expect(await IntegrityService.getScreening(LINKED.id)).toBeNull();
  expect(await IntegrityService.getScreening(LEGACY.id, PROFILE)).toMatchObject({ id: LEGACY.id });
});

test('status update cannot change a request-linked row', async () => {
  await IntegrityService.updateScreeningStatus(LINKED.id, 'cleared');
  expect(rows.find((row) => row.id === LINKED.id).status).toBe('pending');
  await IntegrityService.updateScreeningStatus(LEGACY.id, 'cleared');
  expect(rows.find((row) => row.id === LEGACY.id).status).toBe('cleared');
});

test('dismissMatch refuses a request-linked row and reports whether it wrote', async () => {
  expect(await IntegrityService.dismissMatch(LINKED.id, 'pubpeer', null, 'Ada Example', 'different_person')).toBe(false);
  expect(await IntegrityService.dismissMatch(LEGACY.id, 'pubpeer', null, 'Ada Example', 'different_person')).toBe(true);
  expect(dismissals).toEqual([LEGACY.id]);
});
