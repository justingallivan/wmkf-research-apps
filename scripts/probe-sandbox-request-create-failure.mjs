#!/usr/bin/env node

/**
 * Read-only, time-bounded Dataverse diagnostic for a rejected sandbox Request
 * create. It discovers each diagnostic table's entity set and available fields
 * from metadata, then reads only the requested UTC window. Free-text diagnostics
 * are URL-redacted and capped before printing.
 *
 * Usage:
 *   node --env-file=/absolute/.env.local scripts/probe-sandbox-request-create-failure.mjs \
 *     --from=2026-09-21T21:34:40Z --to=2026-09-21T21:35:10Z
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const MAX_WINDOW_MS = 30 * 60 * 1000;
const DIAGNOSTICS = Object.freeze([
  {
    logicalName: 'plugintracelog',
    timeCandidates: ['performanceexecutionstarttime', 'createdon'],
    fields: [
      'plugintracelogid', 'typename', 'messagename', 'primaryentity', 'operationtype',
      'mode', 'exceptiondetails', 'messageblock', 'performanceexecutionstarttime',
      'performanceexecutionduration', 'correlationid', 'requestid', 'pluginstepid',
      'createdon',
    ],
  },
  {
    logicalName: 'processsession',
    timeCandidates: ['startedon', 'createdon', 'executedon'],
    fields: [
      'processsessionid', 'name', 'startedon', 'completedon', 'executedon', 'createdon',
      'statecode', 'statuscode', 'comments', 'errorcode', 'correlationid',
      '_processid_value', '_regardingobjectid_value',
    ],
  },
  {
    logicalName: 'asyncoperation',
    timeCandidates: ['createdon', 'startedon'],
    fields: [
      'asyncoperationid', 'name', 'operationtype', 'createdon', 'startedon',
      'completedon', 'statecode', 'statuscode', 'message', 'friendlymessage',
      'errorcode', 'correlationid', 'correlationupdatedtime', '_regardingobjectid_value',
    ],
  },
  {
    logicalName: 'workflowlog',
    timeCandidates: ['createdon'],
    fields: [
      'workflowlogid', 'name', 'createdon', 'stage', 'status', 'message',
      'errorcode', '_asyncoperationid_value', '_processsessionid_value',
    ],
  },
]);

function parseArgs(argv) {
  const values = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--from=')) values.from = arg.slice('--from='.length);
    else if (arg.startsWith('--to=')) values.to = arg.slice('--to='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const fromMs = Date.parse(values.from);
  const toMs = Date.parse(values.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    throw new Error('Valid increasing --from and --to UTC timestamps are required.');
  }
  if (toMs - fromMs > MAX_WINDOW_MS) throw new Error('Diagnostic window must be 30 minutes or less.');
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

function bodyOrThrow(label, response) {
  if (!response?.ok) throw new Error(`${label} failed (${response?.status}): ${String(response?.text || '').slice(0, 300)}`);
  return response.body || {};
}

function scrub(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 2_000);
}

async function describe(client, logicalName) {
  const entity = await client.get(`/EntityDefinitions(LogicalName='${logicalName}')?$select=EntitySetName,LogicalName`);
  if (entity.status === 404) return null;
  const entityBody = bodyOrThrow(`${logicalName} entity metadata`, entity);
  const attributes = await client.get(
    `/EntityDefinitions(LogicalName='${logicalName}')/Attributes?$select=LogicalName`,
  );
  const names = new Set((bodyOrThrow(`${logicalName} attribute metadata`, attributes).value || []).map((row) => row.LogicalName));
  return { entitySetName: entityBody.EntitySetName, attributes: names };
}

async function queryDiagnostic(client, spec, from, to) {
  const metadata = await describe(client, spec.logicalName);
  if (!metadata) return { logicalName: spec.logicalName, status: 'entity_absent', rows: [] };
  const timeField = spec.timeCandidates.find((field) => metadata.attributes.has(field));
  if (!timeField) return { logicalName: spec.logicalName, status: 'time_field_absent', rows: [] };
  const fields = spec.fields.filter((field) => metadata.attributes.has(field));
  const filter = `${timeField} ge ${from} and ${timeField} lt ${to}`;
  const response = await client.get(
    `/${metadata.entitySetName}?$select=${fields.join(',')}` +
      `&$filter=${encodeURIComponent(filter)}&$orderby=${timeField} asc&$top=100`,
  );
  if (!response.ok) {
    return {
      logicalName: spec.logicalName,
      entitySetName: metadata.entitySetName,
      status: `read_${response.status}`,
      rows: [],
    };
  }
  const body = response.body || {};
  const rows = (body.value || []).map((row) => Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !key.startsWith('@odata.'))
      .map(([key, value]) => [key, scrub(value)]),
  ));
  return {
    logicalName: spec.logicalName,
    entitySetName: metadata.entitySetName,
    status: body['@odata.nextLink'] ? 'capped' : 'complete',
    timeField,
    rows,
  };
}

async function main() {
  const { from, to } = parseArgs(process.argv);
  loadEnvLocal();
  if (process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_URL) {
    throw new Error(`DYNAMICS_SANDBOX_URL must equal ${SANDBOX_URL}.`);
  }
  const client = createClient({
    resourceUrl: SANDBOX_URL,
    token: await getAccessToken(SANDBOX_URL),
  });
  const diagnostics = [];
  for (const spec of DIAGNOSTICS) diagnostics.push(await queryDiagnostic(client, spec, from, to));
  console.log(JSON.stringify({
    mode: 'READ_ONLY_SANDBOX_CREATE_FAILURE_DIAGNOSTIC',
    target: SANDBOX_URL,
    from,
    to,
    diagnostics,
  }, null, 2));
}

main().catch((error) => {
  console.error(`FATAL: ${error.message}`);
  process.exit(1);
});

