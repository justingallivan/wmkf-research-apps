/** Rehearsal SQL for roster consumers and the explicitly selected browser auth readers. */
const vercel = require('@vercel/postgres');
const target = require('./roster-rehearsal-target.cjs');
let pool;
let poolConnectionString;
let poolSchema;

function localPool({ connectionString, schema }) {
  if (pool && (poolConnectionString !== connectionString || poolSchema !== schema)) {
    throw new Error('Rehearsal database configuration changed; restart the process');
  }
  if (!pool) {
    const { Pool } = require('pg');
    const namespace = schema ? { options: `-c search_path="${schema}"` } : {};
    pool = new Pool({ connectionString, ...namespace, max: 3, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000, query_timeout: 30000, allowExitOnIdle: true });
    poolConnectionString = connectionString;
    poolSchema = schema;
  }
  return pool;
}

async function localQuery(config, ...args) {
  const selectedPool = localPool(config);
  if (!config.schema) return selectedPool.query(...args);
  const { verifyNamespace } = require('./roster-lifecycle.cjs');
  const client = await selectedPool.connect();
  try {
    await verifyNamespace(client, config.schema, { browser: true });
  } catch (error) {
    client.release(true);
    throw error;
  }
  try {
    return await client.query(...args);
  } finally {
    client.release();
  }
}

function templateQuery(config, strings, values) {
  if (!Array.isArray(strings) || !Array.isArray(strings.raw) || strings.length !== values.length + 1) {
    throw new Error('Use sql as a tagged template');
  }
  const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return localQuery(config, query, values);
}

function rehearsalConfig() {
  if (target.browserRequested()) return target.assertBrowserTarget();
  return target.enabled() ? target.assertTarget() : null;
}

function sql(strings, ...values) {
  const config = rehearsalConfig();
  return config ? templateQuery(config, strings, values) : vercel.sql(strings, ...values);
}
sql.query = (...args) => {
  const config = rehearsalConfig();
  return config ? localQuery(config, ...args) : vercel.sql.query(...args);
};

function browserSql(strings, ...values) {
  return target.browserRequested()
    ? templateQuery(target.assertBrowserTarget(), strings, values)
    : vercel.sql(strings, ...values);
}

const db = { connect: (...args) => {
  const config = rehearsalConfig();
  if (config?.schema) throw new Error('Pooled SQL transactions are outside the roster browser rehearsal');
  return config ? localPool(config).connect(...args) : vercel.db.connect(...args);
} };
module.exports = { sql, db, browserSql };
