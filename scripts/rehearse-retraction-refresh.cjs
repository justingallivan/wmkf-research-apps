#!/usr/bin/env node
/** Isolated-only refresh rehearsal. Never loads .env or selects app credentials.
 * Usage: RETRACTION_REHEARSAL_URL=postgres://...@127.0.0.1/... node scripts/rehearse-retraction-refresh.cjs [--publish] [--file=/tmp/source.csv]
 * Default is dry-run; --publish writes only the explicitly selected loopback DB.
 */
const { Pool } = require('pg');
const { refreshRetractions } = require('../lib/services/retraction-refresh-service');
async function main() {
  const value = process.env.RETRACTION_REHEARSAL_URL;
  if (!value) throw new Error('RETRACTION_REHEARSAL_URL is required');
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Only an isolated loopback database is allowed');
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--publish' && !a.startsWith('--file='))) throw new Error('Unknown argument');
  const pool = new Pool({ connectionString: value, max: 2 });
  try {
    const result = await refreshRetractions({ dryRun: !args.includes('--publish') }, {
      pool, csvFile: args.find(a => a.startsWith('--file='))?.slice(7),
      alert: async (message) => console.error(message),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.code || e.message, e.details ? JSON.stringify(e.details) : ''); process.exitCode = 1; });
