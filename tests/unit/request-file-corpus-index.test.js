/**
 * Research request file corpus index (migration 090): strict listing and the
 * per-request save rules. The Postgres client is a recording fake, so these
 * tests pin the statements, parameters and transaction boundaries; they do not
 * execute SQL. Names are synthetic.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { listRequestFiles, withRetry } from '../../lib/services/request-file-corpus/listing.js';
import {
  eraOf,
  classifyFile,
  saveRequestListing,
  saveRequestError,
  finishRun,
  startRun,
  reclassify,
} from '../../lib/services/request-file-corpus/index-store.js';

const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const RUN_ID = '66666666-7777-4888-9999-000000000000';
const noSleep = async () => {};

function fakeGraph(listings, { driveId = 'drive-1' } = {}) {
  return {
    listFiles: jest.fn(async (library) => {
      const value = listings[library];
      if (value instanceof Error) throw value;
      return value || [];
    }),
    getDriveId: jest.fn(async () => driveId),
  };
}
const err = (message, extra) => Object.assign(new Error(message), extra);

describe('listRequestFiles', () => {
  test('lists every bucket and keeps subfolders relative to the request folder', async () => {
    const graph = fakeGraph({
      akoya_request: [
        { id: 'a', name: 'ProjectDescription.pdf', folder: 'Req/1003000', size: 10, lastModified: '2025-01-01T00:00:00Z' },
        { id: 'b', name: 'Review.docx', folder: 'Req/1003000/Phase II', size: 20 },
      ],
    });
    const getBuckets = jest.fn(async () => [{ library: 'akoya_request', folder: 'Req/1003000', source: 'tracked' }]);
    const result = await listRequestFiles({ requestId: REQUEST_ID, requestNum: '1003000' }, { graph, getBuckets, sleep: noSleep });
    expect(getBuckets).toHaveBeenCalledWith(REQUEST_ID, '1003000', { requireCompleteResults: true, requireResolvedParents: true });
    expect(result.error).toBeNull();
    expect(result.files.map((f) => [f.itemId, f.subfolder, f.extension, f.driveId])).toEqual([
      ['a', '', 'pdf', 'drive-1'], ['b', 'Phase II', 'docx', 'drive-1'],
    ]);
  });

  test('a file reached through overlapping tracked folders is returned once, from the outer folder', async () => {
    const graph = fakeGraph({});
    graph.listFiles = jest.fn(async (library, folder) => (folder === 'Req/1003000'
      ? [{ id: 'a', name: 'Review.docx', folder: 'Req/1003000/Phase II' }]
      : [{ id: 'a', name: 'Review.docx', folder: 'Req/1003000/Phase II' }]));
    const getBuckets = async () => [
      { library: 'akoya_request', folder: 'Req/1003000/Phase II', source: 'tracked' },
      { library: 'akoya_request', folder: 'Req/1003000', source: 'tracked' },
    ];
    const result = await listRequestFiles({ requestId: REQUEST_ID, requestNum: '1003000' }, { graph, getBuckets, sleep: noSleep });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].subfolder).toBe('Phase II');
  });

  test('a missing archive folder is an empty bucket, not an error', async () => {
    const graph = fakeGraph({ RequestArchive3: err('gone', { code: 'graph_folder_not_found' }), akoya_request: [] });
    const getBuckets = async () => [
      { library: 'RequestArchive3', folder: '1003000', source: 'archive' },
      { library: 'akoya_request', folder: 'Req/1003000', source: 'tracked' },
    ];
    const result = await listRequestFiles({ requestId: REQUEST_ID, requestNum: '1003000' }, { graph, getBuckets, sleep: noSleep });
    expect(result).toEqual({ files: [], error: null });
  });

  test('any other bucket failure fails the whole request with no files', async () => {
    const graph = fakeGraph({
      akoya_request: [{ id: 'a', name: 'x.pdf', folder: 'Req/1003000' }],
      RequestArchive3: err('limit', { code: 'graph_file_list_truncated' }),
    });
    const getBuckets = async () => [
      { library: 'akoya_request', folder: 'Req/1003000', source: 'tracked' },
      { library: 'RequestArchive3', folder: '1003000', source: 'archive' },
    ];
    const result = await listRequestFiles({ requestId: REQUEST_ID, requestNum: '1003000' }, { graph, getBuckets, sleep: noSleep });
    expect(result.files).toBeNull();
    expect(result.error).toMatch(/^RequestArchive3: limit/);
  });

  test('a missing tracked folder is an error, and so is an unresolved bucket lookup', async () => {
    const tracked = await listRequestFiles({ requestId: REQUEST_ID, requestNum: '1' }, {
      graph: fakeGraph({ akoya_request: err('gone', { code: 'graph_folder_not_found' }) }),
      getBuckets: async () => [{ library: 'akoya_request', folder: 'Req/1', source: 'tracked' }],
      sleep: noSleep,
    });
    expect(tracked.files).toBeNull();
    const buckets = await listRequestFiles({ requestId: REQUEST_ID, requestNum: '1' }, {
      graph: fakeGraph({}), getBuckets: async () => { throw err('unresolved parent library'); }, sleep: noSleep,
    });
    expect(buckets).toEqual({ files: null, error: 'buckets: unresolved parent library' });
  });

  test('withRetry retries transient statuses only', async () => {
    const flaky = jest.fn().mockRejectedValueOnce(err('busy', { status: 429 })).mockResolvedValue('ok');
    await expect(withRetry(flaky, { sleep: noSleep })).resolves.toBe('ok');
    const denied = jest.fn().mockRejectedValue(err('denied', { status: 403 }));
    await expect(withRetry(denied, { sleep: noSleep })).rejects.toThrow('denied');
    expect(denied).toHaveBeenCalledTimes(1);
  });
});

describe('eraOf and classifyFile', () => {
  test.each([
    [{ meetingDate: '2017-12-08', createdOn: '2023-01-01' }, 1],
    [{ meetingDate: '2018-06-01', createdOn: '2023-01-01' }, 2],
    [{ meetingDate: '2021-12-01', createdOn: '2023-01-01' }, 2],
    [{ meetingDate: '2026-06-01', createdOn: '2025-08-01' }, 3],
    [{ meetingDate: '2026-12-10', createdOn: '2026-03-01' }, 4],
  ])('%j → era %i', (request, era) => expect(eraOf(request)).toBe(era));

  test('classifyFile records the rule and the rules version', () => {
    expect(classifyFile({ name: 'ProjectDescription.pdf', subfolder: 'Phase I' }, 'v1')).toEqual({
      docType: 'project-description', priority: 'read', classifiedBy: 'rule:project-description', rulesVersion: 'v1', phase: 'phase-i',
    });
    expect(classifyFile({ name: '13100818.doc', subfolder: '' }, 'v1').classifiedBy).toBe('rule:opaque-number');
    expect(classifyFile({ name: 'misc scan.pdf', subfolder: '' }, 'v1').classifiedBy).toBe('none');
  });
});

function recordingClient({ failOn, clashRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (text, params) => {
      calls.push({ text: text.replace(/\s+/g, ' ').trim(), params });
      if (failOn && text.includes(failOn)) throw new Error('boom');
      if (text.includes('JOIN unnest')) return { rows: clashRows, rowCount: clashRows.length };
      return { rows: [], rowCount: 2 };
    }),
  };
}
const request = { requestId: REQUEST_ID, requestNum: '1003000', program: 'MR', meetingDate: '2026-12-10', createdOn: '2026-03-01', status: 'Phase I Pending', isTest: false };
const file = (itemId, name) => ({ driveId: 'drive-1', itemId, library: 'akoya_request', source: 'tracked', subfolder: '', name, extension: 'pdf', size: 1, lastModified: null });

describe('saveRequestListing', () => {
  test('one transaction: request row, file upsert, then removal of files not seen in this run', async () => {
    const client = recordingClient();
    const result = await saveRequestListing(client, { request, files: [file('a', 'ProjectDescription.pdf'), file('b', 'Budget.xlsx')], runId: RUN_ID, rulesVersion: 'v1' });
    const texts = client.calls.map((c) => c.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toMatch(/^SELECT f.item_id, f.request_id FROM request_corpus_files f JOIN unnest.* WHERE f.last_run_id = \$3 AND f.request_id <> \$4/);
    expect(client.calls[1].params.slice(2)).toEqual([RUN_ID, REQUEST_ID]);
    client.calls.splice(1, 1);
    texts.splice(1, 1);
    expect(texts[1]).toMatch(/^INSERT INTO request_corpus_requests .* file_count = CASE WHEN EXCLUDED.listing_status = 'ok' THEN EXCLUDED.file_count ELSE request_corpus_requests.file_count END/);
    expect(client.calls[1].params.slice(7, 11)).toEqual([4, 'ok', null, 2]);
    expect(texts[2]).toMatch(/^INSERT INTO request_corpus_files .* ON CONFLICT \(drive_id, item_id\) DO UPDATE SET request_id = EXCLUDED.request_id.* removed_at = NULL/);
    expect(client.calls[2].params[1]).toEqual(['a', 'b']);
    expect(client.calls[2].params[13]).toEqual(['project-description', 'budget-spreadsheet']);
    expect(texts[3]).toBe('UPDATE request_corpus_files SET removed_at = NOW() WHERE request_id = $1 AND removed_at IS NULL AND last_run_id <> $2');
    expect(client.calls[3].params).toEqual([REQUEST_ID, RUN_ID]);
    expect(texts[4]).toBe('COMMIT');
    expect(texts.some((t) => /DELETE/i.test(t))).toBe(false);
    expect(result).toEqual({ removed: 2, conflict: null });
  });

  test('a successful empty listing still marks earlier files removed', async () => {
    const client = recordingClient();
    await saveRequestListing(client, { request, files: [], runId: RUN_ID, rulesVersion: 'v1' });
    expect(client.calls.map((c) => c.text.split(' ')[0])).toEqual(['BEGIN', 'INSERT', 'UPDATE', 'COMMIT']);
  });

  test('a file already saved under another request in this run is a conflict, not a move', async () => {
    const other = '99999999-8888-4777-8666-555555555555';
    const client = recordingClient({ clashRows: [{ item_id: 'a', request_id: other }] });
    const result = await saveRequestListing(client, { request, files: [file('a', 'x.pdf')], runId: RUN_ID, rulesVersion: 'v1' });
    expect(result).toEqual({ conflict: `file a is already listed under request ${other} in this run` });
    expect(client.calls.map((c) => c.text.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
  });

  test('a failure inside the transaction rolls back and rethrows', async () => {
    const client = recordingClient({ failOn: 'INSERT INTO request_corpus_files' });
    await expect(saveRequestListing(client, { request, files: [file('a', 'x.pdf')], runId: RUN_ID, rulesVersion: 'v1' })).rejects.toThrow('boom');
    expect(client.calls.at(-1).text).toBe('ROLLBACK');
    expect(client.calls.some((c) => c.text === 'COMMIT')).toBe(false);
  });

  test('the test flag is carried', async () => {
    const client = recordingClient();
    await saveRequestListing(client, { request: { ...request, isTest: true }, files: [], runId: RUN_ID, rulesVersion: 'v1' });
    expect(client.calls[1].params[6]).toBe(true);
  });
});

describe('startRun', () => {
  const scope = { from: 2018, to: 2026, limit: null };
  const storedClient = (row) => ({ calls: [], query: jest.fn(async function (text, params) { this.calls.push({ text, params }); return { rows: text.startsWith('SELECT') ? (row ? [row] : []) : [] }; }) });

  test('a new run inserts without overwriting an existing one', async () => {
    const client = recordingClient();
    await startRun(client, { runId: RUN_ID, scope, rulesVersion: 'v1' });
    expect(client.calls[0].text).toMatch(/^INSERT INTO request_corpus_runs .* VALUES \(\$1, \$2::jsonb, \$3\)$/);
  });

  test('a resume must match the stored scope and rules version', async () => {
    const ok = storedClient({ scope, rules_version: 'v1' });
    await startRun(ok, { runId: RUN_ID, scope, rulesVersion: 'v1', resume: true });
    expect(ok.calls.at(-1).text).toMatch(/^UPDATE request_corpus_runs SET status = 'running'/);
    await expect(startRun(storedClient({ scope, rules_version: 'v0' }), { runId: RUN_ID, scope, rulesVersion: 'v1', resume: true }))
      .rejects.toThrow(/filename rules are now v1/);
    await expect(startRun(storedClient({ scope, rules_version: 'v1' }), { runId: RUN_ID, scope: { ...scope, limit: 25 }, rulesVersion: 'v1', resume: true }))
      .rejects.toThrow(/same --from, --to and --limit/);
    await expect(startRun(storedClient(null), { runId: RUN_ID, scope, rulesVersion: 'v1', resume: true }))
      .rejects.toThrow(/does not exist/);
  });
});

describe('finishRun', () => {
  test('recomputes whole-run totals from stored rows, so a resume reports the whole run', async () => {
    const client = recordingClient();
    await finishRun(client, { runId: RUN_ID, status: 'completed' });
    const { text, params } = client.calls[0];
    expect(params).toEqual([RUN_ID, 'completed']);
    expect(text).toMatch(/requests_ok = \(SELECT COUNT\(\*\) FROM request_corpus_requests WHERE last_run_id = \$1 AND listing_status = 'ok'\)/);
    expect(text).toMatch(/files_seen = \(SELECT COUNT\(\*\) FROM request_corpus_files WHERE last_run_id = \$1 AND removed_at IS NULL\)/);
    expect(text).toMatch(/errors = COALESCE\(\(SELECT jsonb_agg/);
  });
});

describe('saveRequestError', () => {
  test('records the error and keeps the stored file count; never touches file rows', async () => {
    const client = recordingClient();
    await saveRequestError(client, { request, error: 'RequestArchive3: limit', runId: RUN_ID });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].text).toMatch(/ELSE request_corpus_requests.file_count END/);
    expect(client.calls[0].params.slice(8, 10)).toEqual(['error', 'RequestArchive3: limit']);
    expect(client.calls[0].text).not.toMatch(/request_corpus_files/);
  });
});

describe('reclassify', () => {
  test('updates only classification columns for rows from another rules version', async () => {
    const rowsQueue = [[{ drive_id: 'drive-1', item_id: 'a', name: 'Keck References.docx', subfolder: '' }], []];
    const calls = [];
    const client = { query: async (text, params) => { calls.push({ text: text.replace(/\s+/g, ' ').trim(), params }); return { rows: text.trim().startsWith('SELECT') ? rowsQueue.shift() : [] }; } };
    await expect(reclassify(client, 'v2')).resolves.toBe(1);
    const update = calls.find((c) => c.text.startsWith('UPDATE'));
    expect(update.text).toMatch(/SET doc_type = t.dt, priority = t.p, classified_by = t.cb, phase = t.ph, rules_version = \$1/);
    expect(update.text).not.toMatch(/removed_at|last_seen_at|request_id =/);
    expect(update.params[3]).toEqual(['referee-list']);
  });
});
