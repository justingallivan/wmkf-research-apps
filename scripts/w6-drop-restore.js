#!/usr/bin/env node
/**
 * Restore companion to scripts/w6-drop-backup.js. Reads the JSONL snapshots in
 * scripts/.w6-drop-backup/ and re-INSERTs them. ASSUMES the table structures
 * exist again (recreate them first via the relevant CREATE TABLE statements in
 * scripts/setup-database.js / lib/db/schema.sql, or — preferred within 7 days —
 * use Neon PITR which restores tables+data atomically and makes this script moot).
 *
 * This is a break-glass tool, NOT part of normal operation. Dry-run by default.
 *   node scripts/w6-drop-restore.js            # report what would be inserted
 *   node scripts/w6-drop-restore.js --execute  # actually INSERT
 *
 * Insert order respects the FK graph (researchers first, then its children).
 */
import { readFileSync, existsSync } from 'fs';
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

const EXECUTE = process.argv.includes('--execute');
// Parents before children (FK-safe insert order).
const ORDER = ['researchers', 'researcher_keywords', 'publications', 'proposal_searches', 'reviewer_suggestions'];
const DIR = join(__dirname, '.w6-drop-backup');

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });

for (const t of ORDER) {
  const path = join(DIR, `${t}.jsonl`);
  if (!existsSync(path)) { console.log(`${t}: no snapshot, skip`); continue; }
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (!rows.length) { console.log(`${t}: 0 rows in snapshot, skip`); continue; }
  if (!EXECUTE) { console.log(`${t}: would insert ${rows.length} rows (dry-run)`); continue; }
  let ok = 0;
  for (const r of rows) {
    const cols = Object.keys(r);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    await pool.query(sql, cols.map((c) => r[c]));
    ok++;
  }
  console.log(`${t}: inserted ${ok}/${rows.length}`);
}

await pool.end();
console.log(EXECUTE ? '\nRestore complete.' : '\nDry-run only. Re-run with --execute to insert.');
