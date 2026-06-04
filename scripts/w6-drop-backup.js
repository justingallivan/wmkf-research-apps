#!/usr/bin/env node
/**
 * S219 pre-drop backup for the reviewer-finder Postgres drain tables that
 * migration 018 drops (researchers, researcher_keywords, reviewer_suggestions,
 * publications, proposal_searches). Dumps each table to a local gitignored JSONL
 * snapshot AND uploads a copy to Vercel Blob for durability beyond Neon's 7-day
 * PITR window. STRICTLY READ-ONLY against Postgres — SELECT * only, no writes/drops.
 *
 *   node scripts/w6-drop-backup.js          # dump + upload to Blob
 *   node scripts/w6-drop-backup.js --local  # dump locally only (skip Blob)
 *
 * Restore: scripts/w6-drop-restore.js reads these JSONL files back. Primary
 * recovery within 7 days is Neon PITR (recreates tables+data atomically); these
 * JSONL/Blob snapshots are the durable data archive past that window.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const LOCAL_ONLY = process.argv.includes('--local');
const TABLES = ['researchers', 'researcher_keywords', 'reviewer_suggestions', 'publications', 'proposal_searches'];
const OUT_DIR = join(__dirname, '.w6-drop-backup');
const STAMP = process.env.BACKUP_STAMP || '2026-06-04'; // pass via env to avoid Date.* nondeterminism

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

let put = null;
if (!LOCAL_ONLY) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error('BLOB_READ_WRITE_TOKEN missing — re-run with --local or set the token.'); process.exit(1); }
  ({ put } = await import('@vercel/blob'));
}

for (const t of TABLES) {
  const { rows } = await pool.query(`SELECT * FROM ${t}`);
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  const localPath = join(OUT_DIR, `${t}.jsonl`);
  writeFileSync(localPath, jsonl);
  if (!rows.length) { console.log(`${t.padEnd(20)} rows=    0  (empty — nothing to back up)`); continue; }
  let blobUrl = '(local only)';
  if (put) {
    const res = await put(`cleanup-backup/${STAMP}/${t}.jsonl`, jsonl, {
      access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: false, allowOverwrite: true,
      contentType: 'application/x-ndjson',
    });
    blobUrl = res.url;
  }
  console.log(`${t.padEnd(20)} rows=${String(rows.length).padStart(5)}  local=${localPath}  blob=${blobUrl}`);
}

await pool.end();
console.log('\nBackup complete. Verify the row counts match the live counts before applying migration 018.');
