/**
 * The publish claim matches only the requested summary kind (paired summaries
 * plan, release step 0). A claim built without a kind binds NULL, which matches
 * no row, so an omitted kind fails closed.
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import { claimSummaryDraftForPublish } from '../../lib/services/post-presentation-materials/summary-draft-store.js';

const ARGS = { id: 'draft-1', requestId: 'request-1', expectedVersion: 2, token: 'token-1', profileId: 12 };

function capturedClaim() {
  const [strings, ...values] = sql.mock.calls[0];
  const text = strings.join('?').replace(/\s+/g, ' ');
  return { text, values };
}

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
});

test('the claim filters on the given artifact type', async () => {
  await claimSummaryDraftForPublish({ ...ARGS, artifactType: 100000007 });
  const { text, values } = capturedClaim();
  expect(text).toContain('AND artifact_type = ?');
  const index = text.split('?').findIndex((part) => part.endsWith('AND artifact_type = '));
  expect(values[index]).toBe(100000007);
});

test('an omitted artifact type binds undefined, which matches no row', async () => {
  await claimSummaryDraftForPublish(ARGS);
  const { text, values } = capturedClaim();
  const index = text.split('?').findIndex((part) => part.endsWith('AND artifact_type = '));
  expect(index).toBeGreaterThanOrEqual(0);
  expect(values[index]).toBeUndefined();
});
