/**
 * Managed Retraction Watch reference-data refresh (Postgres only).
 * Official HTTPS CSV -> bounded validated local TSV -> TEMP stage and keyed
 * merge in one advisory-locked transaction. Corpus and publication generation
 * commit together; failed imports cannot clear or partially publish the corpus.
 * No screening/history/review writes. Route activation is separately fail-closed.
 * Dependencies accept a scratch pool/file for isolated rehearsals, never HTTP input.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const RETAINED_RECORDS = require('./retraction-retained-records.json');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { parse } = require('csv-parse');
const { from: copyFrom } = require('pg-copy-streams');
const { Pool } = require('pg');
const { withVerifyFullSslmode } = require('../db/pg-connection-string');
const { IntegrityMatchingService } = require('./integrity-matching-service');

const SOURCE_URL = 'https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv';
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_RECORDS = 250_000;
const BUDGET_MS = 240_000;
const FIELDS = ['record_id', 'title', 'authors', 'authors_normalized', 'journal', 'publisher', 'subject', 'institution', 'country', 'retraction_date', 'original_paper_doi', 'retraction_nature', 'retraction_reasons', 'urls'];
const HEADERS = ['Record ID', 'Title', 'Author', 'Journal', 'Publisher', 'Subject', 'Institution', 'Country', 'RetractionDate', 'OriginalPaperDOI', 'RetractionNature', 'Reason', 'URLS'];
const codedError = (code) => Object.assign(new Error(code), { code });

function sourceDate(value) {
  if (!value || /^unavailable$/i.test(value.trim())) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(value.trim());
  if (!match) throw codedError('invalid_retraction_date');
  const [, m, d, y] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) throw codedError('invalid_retraction_date');
  return date.toISOString().slice(0, 10);
}
const list = (value) => String(value || '').split(';').map(s => s.trim()).filter(Boolean);
const arrayLiteral = (items) => `{${items.map(item => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const copyValue = (value) => value === null ? '\\N' : String(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

async function downloadCsv(destination, signal, fetchImpl = fetch) {
  let url = SOURCE_URL;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'gitlab.com' || parsed.username || parsed.password || parsed.port) throw codedError('unapproved_download_host');
    const response = await fetchImpl(url, { redirect: 'manual', signal, headers: { 'accept-encoding': 'identity' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw codedError('missing_download_location');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) throw codedError('retraction_download_failed');
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') { await response.body.cancel(); throw codedError('unexpected_download_encoding'); }
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES) { await response.body.cancel(); throw codedError('retraction_download_too_large'); }
    let bytes = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_BYTES ? codedError('retraction_download_too_large') : null, chunk);
    } }), fs.createWriteStream(destination), { signal });
    if (declared > 0 && bytes !== declared) throw codedError('incomplete_retraction_download');
    return;
  }
  throw codedError('too_many_download_redirects');
}

async function prepareCsv(csvFile, tsvFile, signal) {
  const hash = crypto.createHash('sha256');
  let bytes = 0, count = 0, headers;
  const ids = new Set();
  const maxLengths = {};
  const parser = parse({ bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024, columns(values) {
    headers = values;
    const nonempty = values.filter(Boolean);
    if (new Set(nonempty).size !== nonempty.length || HEADERS.some(h => !values.includes(h))) throw codedError('retraction_csv_header_changed');
    return values;
  } });
  await pipeline(fs.createReadStream(csvFile), new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; hash.update(chunk);
    done(bytes > MAX_BYTES ? codedError('retraction_download_too_large') : null, chunk);
  } }), parser, async function* (source) {
    for await (const row of source) {
      if (++count > MAX_RECORDS) throw codedError('too_many_retraction_records');
      const id = row['Record ID'].trim();
      if (!id || id.length > 50 || !row.Title.trim() || !row.Author.trim() || ids.has(id)) throw codedError('invalid_or_duplicate_retraction_record');
      ids.add(id);
      for (const key of HEADERS) maxLengths[key] = Math.max(maxLengths[key] || 0, row[key].length);
      const normalized = list(row.Author).map(name => IntegrityMatchingService.normalizeName(name)).filter(Boolean);
      const values = [id, row.Title, row.Author, arrayLiteral(normalized), row.Journal || null, row.Publisher || null,
        row.Subject || null, row.Institution || null, row.Country || null, sourceDate(row.RetractionDate),
        row.OriginalPaperDOI || null, row.RetractionNature || null, arrayLiteral(list(row.Reason)), row.URLS || null];
      if (values.some(v => typeof v === 'string' && v.includes('\0'))) throw codedError('invalid_retraction_field');
      yield values.map(copyValue).join('\t') + '\n';
    }
  }, fs.createWriteStream(tsvFile), { signal });
  if (!count) throw codedError('empty_retraction_dataset');
  return { count, bytes, checksum: hash.digest('hex'), headers, maxLengths, extraHeaders: headers.filter(h => !HEADERS.includes(h)) };
}

async function defaultAlert(message, outcome = 'failure') {
  const AlertService = require('./alert-service');
  await AlertService.createAlert({ type: 'cron_failure', severity: 'warning', title: 'Retraction Watch refresh needs attention',
    message, source: 'cron:refresh-retractions', autoResolveKey: `retraction-refresh-${outcome}` });
}

async function refreshRetractions({ dryRun = false } = {}, dependencies = {}) {
  if (typeof dryRun !== 'boolean') throw codedError('invalid_refresh_mode');
  if (!dependencies.pool && !process.env.POSTGRES_URL && !process.env.DATABASE_URL) throw codedError('refresh_database_not_configured');
  const started = Date.now();
  const signal = dependencies.signal || AbortSignal.timeout(BUDGET_MS);
  const ownPool = !dependencies.pool;
  const pool = dependencies.pool || new Pool({ connectionString: withVerifyFullSslmode(process.env.POSTGRES_URL || process.env.DATABASE_URL),
    max: 2, connectionTimeoutMillis: 10_000, query_timeout: 120_000 });
  const alert = dependencies.alert || defaultAlert;
  let client, tempDir, runId, transaction = false, committed = false, commitAttempted = false, outcome;
  try {
    const ready = await pool.query("SELECT to_regclass('retraction_dataset')::text AS relation");
    if (!ready.rows[0]?.relation) throw codedError('retraction_schema_not_ready');
    const audit = await pool.query("INSERT INTO maintenance_runs (job_name,status) VALUES ($1,'running') RETURNING id", [dryRun ? 'retraction-refresh-dryrun' : 'retraction-refresh']);
    runId = audit.rows[0]?.id;
    if (!runId) throw codedError('refresh_audit_start_failed');
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'retraction-refresh-'));
    const csvFile = dependencies.csvFile || path.join(tempDir, 'source.csv');
    if (!dependencies.csvFile) await downloadCsv(csvFile, signal, dependencies.fetchImpl);
    const tsvFile = path.join(tempDir, 'validated.tsv');
    const prepared = await prepareCsv(csvFile, tsvFile, signal);
    signal.throwIfAborted();
    client = await pool.connect();
    await client.query('BEGIN'); transaction = true;
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1),0) AS locked', ['retraction-watch-refresh']);
    if (!lock.rows[0]?.locked) {
      await client.query('ROLLBACK'); transaction = false;
      outcome = { status: 'busy', published: false, dryRun };
    } else {
      const previous = (await client.query('SELECT * FROM retraction_dataset WHERE singleton_id = 1')).rows[0];
      const widths = await client.query("SELECT column_name,character_maximum_length FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='retractions' AND character_maximum_length IS NOT NULL");
      const sourceColumns = { record_id: 'Record ID', journal: 'Journal', publisher: 'Publisher', subject: 'Subject', original_paper_doi: 'OriginalPaperDOI', retraction_nature: 'RetractionNature' };
      const widthViolations = widths.rows.filter(row => sourceColumns[row.column_name] && prepared.maxLengths[sourceColumns[row.column_name]] > row.character_maximum_length)
        .map(row => ({ column: row.column_name, limit: row.character_maximum_length, observed: prepared.maxLengths[sourceColumns[row.column_name]] }));
      if (widthViolations.length) throw Object.assign(codedError('retraction_schema_width_mismatch'), { details: { widthViolations, headers: prepared.headers } });
      await client.query('CREATE TEMP TABLE retraction_refresh_stage (LIKE retractions INCLUDING DEFAULTS) ON COMMIT DROP');
      // Stage carries no ID/default sequence effects; preserving existing IDs is
      // the keyed merge's responsibility, never the staging COPY.
      await client.query('ALTER TABLE retraction_refresh_stage DROP COLUMN id');
      await pipeline(fs.createReadStream(tsvFile), client.query(copyFrom(`COPY retraction_refresh_stage (${FIELDS.join(',')}) FROM STDIN`)), { signal });
      // Two owner-reviewed backup snapshots only; never a general no-delete rule.
      // Upstream wins when an ID returns. Retained rows never alter CSV checksum.
      const retainedRecords = [];
      for (const entry of dependencies.retainedRecords || RETAINED_RECORDS) {
        const recordId = entry.data.record_id;
        if (!['13045', '67801'].includes(recordId) || entry.provenance.recordId !== recordId) throw codedError('invalid_retained_retraction');
        const present = await client.query('SELECT 1 FROM retraction_refresh_stage WHERE record_id=$1', [recordId]);
        if (present.rows.length) continue;
        const values = FIELDS.map(field => field === 'authors_normalized'
          ? list(entry.data.authors).map(name => IntegrityMatchingService.normalizeName(name)).filter(Boolean) : entry.data[field]);
        const recordSha256 = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
        await client.query(`INSERT INTO retraction_refresh_stage (${FIELDS.join(',')}) VALUES (${FIELDS.map((_,i)=>`$${i+1}`).join(',')})`, values);
        retainedRecords.push({ ...entry.provenance, recordSha256 });
      }
      const staged = Number((await client.query('SELECT COUNT(*) AS count FROM retraction_refresh_stage')).rows[0].count);
      if (staged !== prepared.count + retainedRecords.length) throw codedError('retraction_stage_count_mismatch');
      const diff = (await client.query(`SELECT
        (SELECT COUNT(*) FROM retractions) AS previous_count,
        COUNT(*) FILTER (WHERE r.record_id IS NULL) AS inserted,
        COUNT(*) FILTER (WHERE r.record_id IS NOT NULL AND ROW(${FIELDS.filter(f => f !== 'record_id').map(f => `s.${f}`).join(',')}) IS DISTINCT FROM ROW(${FIELDS.filter(f => f !== 'record_id').map(f => `r.${f}`).join(',')})) AS changed,
        (SELECT COUNT(*) FROM retractions r2 WHERE NOT EXISTS (SELECT 1 FROM retraction_refresh_stage s2 WHERE s2.record_id=r2.record_id)) AS removed
        FROM retraction_refresh_stage s LEFT JOIN retractions r ON r.record_id=s.record_id`)).rows[0];
      const sameRetention = previous && isDeepStrictEqual(previous.retained_records, retainedRecords);
      const changes = Object.fromEntries(Object.entries(diff).map(([k,v]) => [k,Number(v)]));
      if (changes.previous_count && staged < changes.previous_count * 0.9) throw codedError('retraction_row_count_drop_requires_review');
      if (changes.removed) {
        const refs = await client.query("SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='retractions'::regclass LIMIT 1");
        if (refs.rows.length) throw codedError('retraction_removals_have_references');
      }
      outcome = { status: dryRun ? 'dry_run' : previous?.source_checksum === prepared.checksum && sameRetention ? 'unchanged' : 'published',
        published: false, dryRun, sourceUnchanged: previous?.source_checksum === prepared.checksum, retentionChanged: Boolean(previous && !sameRetention), ...prepared, count: staged, sourceCount: prepared.count, retainedCount: retainedRecords.length, retainedRecords, ...changes };
      if (dryRun) { await client.query('ROLLBACK'); transaction = false; }
      else if (outcome.status === 'unchanged') {
        // Refuse either unmanaged writes or changed derivation rules; an operator must reconcile the difference.
        if (changes.inserted || changes.changed || changes.removed) throw Object.assign(codedError('retraction_derived_corpus_differs'), { details: { ...changes } });
        await client.query('UPDATE retraction_dataset SET last_checked_at=NOW() WHERE singleton_id=1');
        signal.throwIfAborted(); commitAttempted = true;
        await client.query('COMMIT'); transaction = false; committed = true;
      } else {
        const updates = FIELDS.filter(f => f !== 'record_id').map(f => `${f}=EXCLUDED.${f}`).join(',');
        await client.query(`INSERT INTO retractions (${FIELDS.join(',')}) SELECT ${FIELDS.join(',')} FROM retraction_refresh_stage
          ON CONFLICT (record_id) DO UPDATE SET ${updates},last_updated=NOW()
          WHERE ROW(${FIELDS.filter(f => f !== 'record_id').map(f => `retractions.${f}`).join(',')})
            IS DISTINCT FROM ROW(${FIELDS.filter(f => f !== 'record_id').map(f => `EXCLUDED.${f}`).join(',')})`);
        await client.query('DELETE FROM retractions r WHERE NOT EXISTS (SELECT 1 FROM retraction_refresh_stage s WHERE s.record_id=r.record_id)');
        const metadata = await client.query(`INSERT INTO retraction_dataset (singleton_id,generation,source_url,source_checksum,row_count,source_row_count,retained_records,format_version)
          VALUES (1,1,$1,$2,$3,$4,$5::jsonb,1) ON CONFLICT (singleton_id) DO UPDATE SET generation=retraction_dataset.generation+1,
          source_url=EXCLUDED.source_url,source_checksum=EXCLUDED.source_checksum,source_revision=NULL,row_count=EXCLUDED.row_count,source_row_count=EXCLUDED.source_row_count,retained_records=EXCLUDED.retained_records,
          format_version=1,published_at=NOW(),last_checked_at=NOW() RETURNING generation`, [SOURCE_URL, prepared.checksum, staged, prepared.count, JSON.stringify(retainedRecords)]);
        outcome.generation = String(metadata.rows[0].generation);
        if (dependencies.beforeCommit) await dependencies.beforeCommit(client);
        signal.throwIfAborted(); commitAttempted = true;
        await client.query('COMMIT'); transaction = false; committed = true; outcome.published = true;
      }
    }
    client.release(); client = null;
    outcome.durationMs = Date.now() - started;
    try {
      const audit = await pool.query(`UPDATE maintenance_runs SET status='${outcome.status === 'busy' ? 'failed' : 'completed'}',records_processed=$2,records_deleted=$3,
        details=$4,completed_at=NOW(),duration_ms=$5 WHERE id=$1 RETURNING id`, [runId,outcome.count || 0,dryRun ? 0 : outcome.removed || 0,JSON.stringify(outcome),outcome.durationMs]);
      if (!audit.rows.length) throw codedError('refresh_audit_finish_failed');
      outcome.auditRecorded = true;
    } catch {
      outcome.auditRecorded = false;
      try { await alert(`Retraction Watch refresh outcome is ${outcome.status}; publication committed=${committed}. Maintenance logging failed. Check authoritative retraction_dataset metadata.`, 'audit-failed'); } catch { /* outcome still reports the logging failure */ }
    }
    return outcome;
  } catch (error) {
    if (transaction && client) await client.query('ROLLBACK').catch(() => {});
    if (client) { client.release(); client = null; }
    console.error('Retraction refresh failure category:', { name: error.name, code: error.code, syscall: error.syscall });
    const code = commitAttempted && !committed ? 'retraction_publication_uncertain'
      : error.code && /^[a-z_]+$/.test(error.code) ? error.code : 'retraction_refresh_failed';
    if (runId) await pool.query("UPDATE maintenance_runs SET status='failed',error_message=$2,completed_at=NOW() WHERE id=$1", [runId,code]).catch(() => {});
    try { await alert(`Retraction Watch refresh failed (${code}); publication committed=${committed ? 'yes' : commitAttempted ? 'unknown' : 'no'}. Confirm authoritative metadata before retrying.`, code === 'retraction_publication_uncertain' ? 'publication-uncertain' : 'failure'); } catch { /* never leak error/connection details */ }
    throw Object.assign(codedError(code), ['retraction_schema_width_mismatch', 'retraction_derived_corpus_differs'].includes(error.code) ? { details: error.details } : {});
  } finally {
    if (client) client.release();
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => { if (outcome) outcome.cleanupWarning = true; });
    if (ownPool) await pool.end().catch(() => { if (outcome) outcome.cleanupWarning = true; });
  }
}
module.exports = { refreshRetractions, prepareCsv, downloadCsv, SOURCE_URL, FIELDS, HEADERS };
