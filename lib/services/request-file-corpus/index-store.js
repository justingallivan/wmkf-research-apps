/**
 * Postgres persistence for the Research request file corpus index (migration
 * 090; docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md).
 *
 * Every function takes a pg-style client (`query(text, params)`), so the owner-run
 * loader can hold one session for its advisory lock. Rules:
 * - saveRequestListing writes one request in one transaction: upsert the request
 *   row, upsert its files (keyed by drive id + item id; sets request_id and
 *   clears removed_at), then mark that request's files not seen in this run
 *   removed. Nothing is ever deleted.
 * - saveRequestError records the error on the request row and leaves its file
 *   rows untouched.
 * - reclassify recomputes classification from the stored name and subfolder
 *   without listing SharePoint.
 */

import { classifyByFilename, phaseOf } from './filename-rules.js';

export const LOCK_KEY = 909001; // pg advisory lock for one corpus load at a time

/** Era of a request (parent plan "Four eras", recut at 2018). */
export function eraOf({ meetingDate, createdOn }) {
  const meeting = String(meetingDate || '').slice(0, 7);
  const created = String(createdOn || '').slice(0, 4);
  if (created === '2026' && meeting >= '2026-07') return 4;
  const year = Number((meeting || created).slice(0, 4));
  if (year <= 2017) return 1;
  if (year <= 2021) return 2;
  return 3;
}

/** Classification columns for one listed or stored file. */
export function classifyFile({ name, subfolder }, rulesVersion) {
  const result = classifyByFilename({ name, subfolder });
  return {
    docType: result.type,
    priority: result.priority,
    classifiedBy: result.ruleId ? `rule:${result.ruleId}` : 'none',
    rulesVersion,
    phase: phaseOf({ name, subfolder }),
  };
}

/**
 * Start a new run, or check a run being resumed: it must exist with the same
 * scope and filename-rules version, so its metadata stays true.
 */
export async function startRun(client, { runId, scope, rulesVersion, resume = false }) {
  if (!resume) {
    await client.query(
      'INSERT INTO request_corpus_runs (run_id, scope, rules_version) VALUES ($1, $2::jsonb, $3)',
      [runId, JSON.stringify(scope), rulesVersion],
    );
    return;
  }
  const { rows } = await client.query('SELECT scope, rules_version FROM request_corpus_runs WHERE run_id = $1', [runId]);
  if (!rows.length) throw new Error(`Run ${runId} does not exist; start a new run instead.`);
  if (rows[0].rules_version !== rulesVersion) {
    throw new Error(`Run ${runId} used ${rows[0].rules_version}; the filename rules are now ${rulesVersion}. Start a new run.`);
  }
  const stored = rows[0].scope || {};
  if (['from', 'to', 'limit'].some((k) => (stored[k] ?? null) !== (scope[k] ?? null))) {
    throw new Error(`Run ${runId} covered ${JSON.stringify(stored)}; resume it with the same --from, --to and --limit.`);
  }
  await client.query("UPDATE request_corpus_runs SET status = 'running', finished_at = NULL WHERE run_id = $1", [runId]);
}

/**
 * Close a run with totals recomputed from the rows it last wrote, so a resumed
 * run reports the whole run, not only the last invocation.
 */
export async function finishRun(client, { runId, status }) {
  const { rows } = await client.query(
    `UPDATE request_corpus_runs r SET status = $2, finished_at = NOW(),
       requests_ok = (SELECT COUNT(*) FROM request_corpus_requests WHERE last_run_id = $1 AND listing_status = 'ok'),
       requests_error = (SELECT COUNT(*) FROM request_corpus_requests WHERE last_run_id = $1 AND listing_status = 'error'),
       files_seen = (SELECT COUNT(*) FROM request_corpus_files WHERE last_run_id = $1 AND removed_at IS NULL),
       errors = COALESCE((SELECT jsonb_agg(jsonb_build_object('requestNum', request_num, 'error', LEFT(listing_error, 300)) ORDER BY request_num)
         FROM request_corpus_requests WHERE last_run_id = $1 AND listing_status = 'error'), '[]'::jsonb)
     WHERE r.run_id = $1
     RETURNING requests_ok, requests_error, files_seen, errors`,
    [runId, status],
  );
  return rows[0] || null;
}

/** Request ids already listed successfully in this run (for --resume). */
export async function listedInRun(client, runId) {
  const { rows } = await client.query(
    `SELECT request_id FROM request_corpus_requests WHERE last_run_id = $1 AND listing_status = 'ok'`,
    [runId],
  );
  return new Set(rows.map((r) => r.request_id));
}

const REQUEST_UPSERT = `
  INSERT INTO request_corpus_requests (request_id, request_num, program, meeting_date, created_on, status, is_test, era,
    listing_status, listing_error, file_count, last_listed_at, last_run_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
  ON CONFLICT (request_id) DO UPDATE SET request_num = EXCLUDED.request_num, program = EXCLUDED.program,
    meeting_date = EXCLUDED.meeting_date, created_on = EXCLUDED.created_on, status = EXCLUDED.status,
    is_test = EXCLUDED.is_test, era = EXCLUDED.era, listing_status = EXCLUDED.listing_status,
    listing_error = EXCLUDED.listing_error,
    file_count = CASE WHEN EXCLUDED.listing_status = 'ok' THEN EXCLUDED.file_count ELSE request_corpus_requests.file_count END,
    last_listed_at = NOW(),
    last_run_id = EXCLUDED.last_run_id`;

function requestParams(request, status, error, fileCount, runId) {
  return [request.requestId, String(request.requestNum), request.program, request.meetingDate || null, request.createdOn || null,
    request.status ?? null, request.isTest === true, eraOf(request), status, error, fileCount, runId];
}

/**
 * @param {object} client pg-style client
 * @param {{ request: object, files: Array<object>, runId: string, rulesVersion: string }} input
 */
export async function saveRequestListing(client, { request, files, runId, rulesVersion }) {
  await client.query('BEGIN');
  try {
    // A file already saved under another request in this run is a conflict,
    // not a move: roll back and let the caller record a listing error. This
    // holds across --resume because it reads persisted rows.
    if (files.length) {
      const { rows: clashes } = await client.query(
        `SELECT f.item_id, f.request_id FROM request_corpus_files f
         JOIN unnest($1::text[], $2::text[]) AS t(d, i) ON f.drive_id = t.d AND f.item_id = t.i
         WHERE f.last_run_id = $3 AND f.request_id <> $4 LIMIT 1`,
        [files.map((f) => f.driveId), files.map((f) => f.itemId), runId, request.requestId],
      );
      if (clashes.length) {
        await client.query('ROLLBACK');
        return { conflict: `file ${clashes[0].item_id} is already listed under request ${clashes[0].request_id} in this run` };
      }
    }
    await client.query(REQUEST_UPSERT,
      requestParams(request, 'ok', null, files.length, runId));
    if (files.length) {
      const cols = { drive: [], item: [], library: [], source: [], subfolder: [], name: [], ext: [], size: [], modified: [], mime: [],
        docType: [], priority: [], classifiedBy: [], phase: [] };
      for (const f of files) {
        const c = classifyFile(f, rulesVersion);
        cols.drive.push(f.driveId); cols.item.push(f.itemId); cols.library.push(f.library); cols.source.push(f.source);
        cols.subfolder.push(f.subfolder || ''); cols.name.push(f.name); cols.ext.push(f.extension || '');
        cols.size.push(f.size ?? null); cols.modified.push(f.lastModified || null); cols.mime.push(f.mimeType || null);
        cols.docType.push(c.docType); cols.priority.push(c.priority); cols.classifiedBy.push(c.classifiedBy); cols.phase.push(c.phase);
      }
      await client.query(
        `INSERT INTO request_corpus_files (drive_id, item_id, request_id, library, source, subfolder, name, extension, size,
           last_modified, mime_type, doc_type, priority, classified_by, rules_version, phase, last_seen_at, removed_at, last_run_id)
         SELECT d, i, $3::uuid, l, s, sf, n, e, sz, lm, mt, dt, p, cb, $4, ph, NOW(), NULL, $5::uuid
         FROM unnest($1::text[], $2::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::bigint[],
           $12::timestamptz[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[])
           AS t(d, i, l, s, sf, n, e, sz, lm, mt, dt, p, cb, ph)
         ON CONFLICT (drive_id, item_id) DO UPDATE SET request_id = EXCLUDED.request_id, library = EXCLUDED.library,
           source = EXCLUDED.source, subfolder = EXCLUDED.subfolder, name = EXCLUDED.name, extension = EXCLUDED.extension,
           size = EXCLUDED.size, last_modified = EXCLUDED.last_modified, mime_type = EXCLUDED.mime_type,
           doc_type = EXCLUDED.doc_type, priority = EXCLUDED.priority, classified_by = EXCLUDED.classified_by,
           rules_version = EXCLUDED.rules_version, phase = EXCLUDED.phase, last_seen_at = NOW(), removed_at = NULL,
           last_run_id = EXCLUDED.last_run_id`,
        [cols.drive, cols.item, request.requestId, rulesVersion, runId, cols.library, cols.source, cols.subfolder, cols.name,
          cols.ext, cols.size, cols.modified, cols.mime, cols.docType, cols.priority, cols.classifiedBy, cols.phase],
      );
    }
    const removed = await client.query(
      `UPDATE request_corpus_files SET removed_at = NOW()
       WHERE request_id = $1 AND removed_at IS NULL AND last_run_id <> $2`,
      [request.requestId, runId],
    );
    await client.query('COMMIT');
    return { removed: removed.rowCount || 0, conflict: null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** Record a listing error; existing file rows and the stored file count are kept. */
export async function saveRequestError(client, { request, error, runId }) {
  await client.query(REQUEST_UPSERT,
    requestParams(request, 'error', String(error).slice(0, 1000), 0, runId));
}

/** Recompute classification for rows from another rules version. */
export async function reclassify(client, rulesVersion, { batchSize = 1000 } = {}) {
  let updated = 0;
  for (;;) {
    const { rows } = await client.query(
      `SELECT drive_id, item_id, name, subfolder FROM request_corpus_files WHERE rules_version <> $1 LIMIT $2`,
      [rulesVersion, batchSize],
    );
    if (!rows.length) return updated;
    const c = rows.map((r) => classifyFile({ name: r.name, subfolder: r.subfolder }, rulesVersion));
    await client.query(
      `UPDATE request_corpus_files f SET doc_type = t.dt, priority = t.p, classified_by = t.cb, phase = t.ph, rules_version = $1
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS t(d, i, dt, p, cb, ph)
       WHERE f.drive_id = t.d AND f.item_id = t.i`,
      [rulesVersion, rows.map((r) => r.drive_id), rows.map((r) => r.item_id), c.map((x) => x.docType), c.map((x) => x.priority),
        c.map((x) => x.classifiedBy), c.map((x) => x.phase)],
    );
    updated += rows.length;
  }
}
