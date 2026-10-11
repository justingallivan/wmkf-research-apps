/**
 * reserveSummaryDraftRun classification (paired summaries plan D2). The client is scripted, so these
 * tests pin the decision logic and the transaction shape. Concurrent reservations and lock behavior
 * need real Postgres; no Postgres harness exists for this store yet (named gap, Session 588).
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(), db: { connect: jest.fn() } }));

import { db, sql } from '@vercel/postgres';
import { reserveSummaryDraftRun, recordEmptySummaryRun, getLatestSummaryRun } from '../../lib/services/post-presentation-materials/summary-draft-store.js';

const ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ARGS = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', artifactType: 100000010,
  sourceRevisionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', presentationEndMs: 2000,
  sourceArtifactId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', acknowledgmentVersion: 'paired', profileId: 12,
};
let client;

function script(activeRow, { insertError = null } = {}) {
  client = {
    query: jest.fn(async (text) => {
      if (/^SELECT id, state, version/.test(text.trim())) return { rows: activeRow ? [activeRow] : [] };
      if (/^INSERT INTO/.test(text.trim())) {
        if (insertError) throw insertError;
        return { rows: [{ id: ARGS.id, state: 'generating' }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  db.connect.mockResolvedValue(client);
}
const statements = () => client.query.mock.calls.map(([text]) => text.trim().split(/\s+/).slice(0, 2).join(' '));
const ready = (extra = {}) => ({ id: ACTIVE_ID, state: 'ready', version: 3, expired: false,
  generation_abandoned: false, publish_abandoned: false, ...extra });

beforeEach(() => { db.connect.mockReset(); sql.mockReset(); });

test('no active row: locks the (request, kind) key, inserts, and commits', async () => {
  script(null);
  await expect(reserveSummaryDraftRun(ARGS)).resolves.toEqual({ draft: { id: ARGS.id, state: 'generating' } });
  expect(statements()).toEqual(['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))', 'SELECT id,', 'INSERT INTO', 'COMMIT']);
  expect(client.query.mock.calls[1][1]).toEqual([`summary-draft:${ARGS.requestId}:100000010`]);
  expect(client.release).toHaveBeenCalled();
});

test('a ready draft is not replaced without a matching replaceDraft: typed conflict, rollback, no write', async () => {
  script(ready());
  await expect(reserveSummaryDraftRun(ARGS)).resolves.toEqual({
    conflict: { code: 'summary_draft_exists', draftId: ACTIVE_ID, version: 3 } });
  expect(statements()).toEqual(['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))', 'SELECT id,', 'ROLLBACK']);
});

test('a ready draft named at an older version is still a conflict', async () => {
  script(ready());
  await expect(reserveSummaryDraftRun({ ...ARGS, replaceDraft: { draftId: ACTIVE_ID, expectedVersion: 2 } }))
    .resolves.toMatchObject({ conflict: { code: 'summary_draft_exists' } });
  expect(statements()).not.toContain('UPDATE meeting_transcript_summary_drafts');
});

test('a ready draft named by exact id (any case) and version is superseded, then the run is inserted', async () => {
  script(ready());
  await expect(reserveSummaryDraftRun({ ...ARGS, replaceDraft: { draftId: ACTIVE_ID.toUpperCase(), expectedVersion: 3 } }))
    .resolves.toMatchObject({ draft: { id: ARGS.id } });
  expect(statements()).toEqual(['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))', 'SELECT id,',
    'UPDATE meeting_transcript_summary_drafts', 'INSERT INTO', 'COMMIT']);
  expect(client.query.mock.calls[3][1]).toEqual([ACTIVE_ID, 12]);
});

test.each([
  ['an expired ready draft', ready({ expired: true })],
  ['an abandoned generating run', ready({ state: 'generating', generation_abandoned: true })],
  ['an abandoned publish claim', ready({ state: 'publishing', publish_abandoned: true })],
])('%s is superseded without replaceDraft', async (_label, row) => {
  script(row);
  await expect(reserveSummaryDraftRun(ARGS)).resolves.toMatchObject({ draft: { id: ARGS.id } });
  expect(statements()).toContain('UPDATE meeting_transcript_summary_drafts');
});

test.each([
  ['generating', ready({ state: 'generating' })],
  ['publishing', ready({ state: 'publishing' })],
])('a live %s row is reported as in progress, even when named for replacement', async (_label, row) => {
  script(row);
  await expect(reserveSummaryDraftRun({ ...ARGS, replaceDraft: { draftId: ACTIVE_ID, expectedVersion: 3 } }))
    .resolves.toEqual({ conflict: { code: 'summary_generation_in_progress' } });
  expect(statements()).not.toContain('UPDATE meeting_transcript_summary_drafts');
});

test('an insert failure after the supersede rolls back the whole transaction and rethrows', async () => {
  script(ready(), { insertError: new Error('insert failed') });
  await expect(reserveSummaryDraftRun({ ...ARGS, replaceDraft: { draftId: ACTIVE_ID, expectedVersion: 3 } }))
    .rejects.toThrow('insert failed');
  expect(statements()).toContain('ROLLBACK');
  expect(statements()).not.toContain('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

test('the empty-run marker is inserted as failed with its code and boundary', async () => {
  sql.mockResolvedValue({ rows: [{ id: ARGS.id }] });
  await recordEmptySummaryRun({ ...ARGS, failureCode: 'staff_discussion_not_recorded' });
  const [strings, ...values] = sql.mock.calls[0];
  expect(strings.join('?')).toMatch(/'failed'/);
  expect(values).toEqual(expect.arrayContaining(['staff_discussion_not_recorded', ARGS.sourceRevisionId, 2000]));
});

test('the latest run carries the boundary it was judged against', async () => {
  sql.mockResolvedValue({ rows: [] });
  await getLatestSummaryRun({ requestId: ARGS.requestId, artifactType: 100000010 });
  expect(sql.mock.calls[0][0].join('?')).toMatch(/source_revision_id, presentation_end_ms/);
});
