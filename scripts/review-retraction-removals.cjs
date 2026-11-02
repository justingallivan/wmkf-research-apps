#!/usr/bin/env node
/** Read-only review of IDs absent from an explicitly selected official CSV.
 * Compare DOI and normalized title; candidates are evidence for human review,
 * never an automatic determination that an upstream removal is correct.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('csv-parse/sync');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');
const normalizeDoi = value => { const doi = String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, ''); return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : ''; };
const normalizeTitle = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function main() {
  const file = process.argv.find(arg => arg.startsWith('--source-csv='))?.slice('--source-csv='.length);
  if (!file || fs.statSync(file).size > 128 * 1024 * 1024) throw new Error('explicit_bounded_source_required');
  const bytes = fs.readFileSync(file);
  const source = parse(bytes, { columns: true, bom: true, skip_empty_lines: true });
  const sourceIds = new Set(source.map(row => String(row['Record ID']).trim()));
  if (sourceIds.size !== source.length || sourceIds.has('') || sourceIds.has('undefined')) throw new Error('invalid_source_ids');
  const env = { ...dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env.local'))), ...process.env };
  const url = new URL(env.POSTGRES_URL);
  if (env.NEON_PROJECT_ID !== 'falling-surf-05640504' || url.hostname !== 'ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech' || url.pathname !== '/neondb') throw new Error('production_target_mismatch');
  const client = new Client({ connectionString: withVerifyFullSslmode(env.POSTGRES_URL), connectionTimeoutMillis: 10000, query_timeout: 20000, application_name: 'integrity-removal-readonly' });
  try {
    await client.connect(); await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'"); await client.query("SET LOCAL lock_timeout='2s'");
    const ids = (await client.query('SELECT record_id FROM retractions')).rows.map(row => row.record_id).filter(id => !sourceIds.has(id));
    const rows = ids.length ? (await client.query('SELECT record_id,title,authors,journal,retraction_date::text,original_paper_doi,retraction_nature,retraction_reasons,urls FROM retractions WHERE record_id=ANY($1::text[]) ORDER BY record_id', [ids])).rows : [];
    const reviews = rows.map(row => ({ ...row, candidates: source.filter(candidate => (normalizeDoi(row.original_paper_doi) && normalizeDoi(candidate.OriginalPaperDOI) === normalizeDoi(row.original_paper_doi)) || normalizeTitle(candidate.Title) === normalizeTitle(row.title)).map(candidate => ({ recordId: candidate['Record ID'], title: candidate.Title, journal: candidate.Journal, authors: candidate.Author, originalDoi: candidate.OriginalPaperDOI, retractionDoi: candidate.RetractionDOI, nature: candidate.RetractionNature, reasons: candidate.Reason, urls: candidate.URLS, exactDoi: Boolean(normalizeDoi(row.original_paper_doi)) && normalizeDoi(candidate.OriginalPaperDOI) === normalizeDoi(row.original_paper_doi), exactNormalizedTitle: normalizeTitle(candidate.Title) === normalizeTitle(row.title) })) }));
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ observedAt: new Date().toISOString(), sourceChecksum: crypto.createHash('sha256').update(bytes).digest('hex'), sourceCount: source.length, removedCount: reviews.length, reviews }, null, 2));
  } finally { await client.end(); }
}
main().catch(error => { console.error(JSON.stringify({ error: 'removal_review_failed', name: error.name, code: error.code })); process.exitCode = 1; });
