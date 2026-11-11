/** SQL seam for roster consumers only. Normal mode delegates to Vercel unchanged.
 * Rehearsal uses the already-installed TCP driver, admitted by the existing pinned
 * sandbox/local-database guard before every pool acquisition. No fallback on error,
 * schema setup, fixture mutation, or general application database migration.
 */
const vercel = require('@vercel/postgres');
const target = require('./roster-rehearsal-target.cjs');
let pool;
let poolConnectionString;
function localPool() {
  const { connectionString } = target.assertTarget();
  if (pool && poolConnectionString !== connectionString) {
    throw new Error('Rehearsal database configuration changed; restart the process');
  }
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000, query_timeout: 30000, allowExitOnIdle: true });
    poolConnectionString = connectionString;
  }
  return pool;
}
function sql(strings, ...values) {
  if (!target.enabled()) return vercel.sql(strings, ...values);
  // Only genuine tagged templates are supported; values always remain parameters.
  if (!Array.isArray(strings) || !Array.isArray(strings.raw) || strings.length !== values.length + 1) {
    throw new Error('Use sql as a tagged template');
  }
  const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return localPool().query(query, values);
}
sql.query = (...args) => target.enabled() ? localPool().query(...args) : vercel.sql.query(...args);
const db = { connect: (...args) => target.enabled() ? localPool().connect(...args) : vercel.db.connect(...args) };
module.exports = { sql, db };
