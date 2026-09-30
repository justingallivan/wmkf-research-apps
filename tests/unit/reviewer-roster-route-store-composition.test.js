/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 5 })) }));

import { sql } from '@vercel/postgres';
import handler from '../../pages/api/workbench/reviewer-roster';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('real route and store return a full positional outcome envelope for mocked SQL partial writes', async () => {
  const rows = new Map();
  let insertNumber = 0;
  sql.mockReset();
  sql.mockImplementation(async (fragments, ...values) => {
    const query = fragments.join(' ');
    if (query.includes('jsonb_array_elements_text')) {
      const requestedKeys = JSON.parse(values[1]);
      return { rows: requestedKeys.flatMap((key) => rows.has(key) ? [rows.get(key)] : []), rowCount: 0 };
    }
    if (query.includes('INSERT INTO reviewer_find_roster')) {
      insertNumber += 1;
      if (insertNumber === 2) throw new Error('injected row write failure');
      const [requestId, candidateKey, , displayName, status, serializedCandidate, sourceKind] = values;
      rows.set(candidateKey, {
        request_id: requestId,
        candidate_key: candidateKey,
        status,
        display_name: displayName,
        candidate: JSON.parse(serializedCandidate),
        source_kind: sourceKind,
        updated_at_token: '2026-09-30T00:00:00.000Z',
      });
      return { rows: [], rowCount: 1 };
    }
    if (query.includes('DELETE FROM reviewer_find_roster')) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected SQL in route/store composition: ${query}`);
  });

  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = response();
    await handler({ method: 'POST', body: {
      requestId: REQUEST_ID,
      candidates: [
        { name: 'Persisted Reviewer', candidateKey: 'candidate:persisted', provenance: { kind: 'literature_retrieved', sources: ['openalex'] } },
        { name: 'Failed Reviewer', candidateKey: 'candidate:failed', provenance: { kind: 'literature_retrieved', sources: ['openalex'] } },
      ],
    } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: false, recorded: 1, outcomeVersion: 1 });
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results.map(({ inputIndex, outcome }) => [inputIndex, outcome])).toEqual([
      [0, 'written'], [1, 'failed'],
    ]);
    expect(res.body.results[1].code).toBe('roster_write_failed');
    expect(rows.size).toBe(1);
    expect(log).toHaveBeenCalledWith('reviewer-roster recordSurfaced row error:', 'injected row write failure');
  } finally {
    log.mockRestore();
  }
});
