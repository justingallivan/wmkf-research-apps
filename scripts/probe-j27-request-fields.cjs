#!/usr/bin/env node
/**
 * Read-only check that the five J27 request fields (schema waves 37 to 40)
 * exist on akoya_request with the expected type, limit and requirement, and
 * that a real request read can select all five. Prints metadata and, for the
 * read, only how many rows came back and how many hold a value per field: no
 * request ids, titles or field text.
 *
 * Dataverse GETs only; the sole POST acquires the application's OAuth token.
 * Uses .env.local's DYNAMICS_* credentials. Owner-run against Production:
 *   node scripts/probe-j27-request-fields.cjs
 */
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const TARGET = 'https://wmkf.crm.dynamics.com';
const EXPECTED = [
  { name: 'wmkf_staffreviewsummary', type: 'Memo', maxLength: 10000 },
  { name: 'wmkf_staffreviewevidencehash', type: 'String', maxLength: 64 },
  { name: 'wmkf_staffvisitassessment', type: 'Memo', maxLength: 10000 },
  { name: 'wmkf_confirmedmeetingroster', type: 'Memo', maxLength: 100000 },
  { name: 'wmkf_initialassessmentrationale', type: 'Memo', maxLength: 10000 },
];

async function main() {
  if (process.env.VERCEL_ENV) throw new Error('Run locally, not inside a deployment.');
  if (!process.env.DYNAMICS_URL || new URL(process.env.DYNAMICS_URL).origin !== TARGET) {
    throw new Error(`DYNAMICS_URL in .env.local is not ${TARGET}`);
  }
  delete process.env.DATAVERSE_PROD_WRITE_ACK;
  Object.assign(process.env, { DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });
  async function get(p) {
    const result = await client.get(p, {});
    if (!result.ok) throw new Error(`GET failed HTTP ${result.status}: ${result.body?.error?.code || 'unknown_code'} ${result.body?.error?.message || ''}`.trim());
    return result.body;
  }

  let failures = 0;
  console.log('--- metadata ---');
  for (const field of EXPECTED) {
    const typeCast = field.type === 'Memo' ? 'MemoAttributeMetadata' : 'StringAttributeMetadata';
    let meta;
    try {
      meta = await get(`/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${field.name}')/Microsoft.Dynamics.CRM.${typeCast}?$select=LogicalName,AttributeType,MaxLength,RequiredLevel,IsValidForRead,IsValidForUpdate`);
    } catch (error) {
      failures++;
      console.log(`${field.name}: MISSING (${error.message})`);
      continue;
    }
    const required = meta.RequiredLevel?.Value;
    const ok = meta.AttributeType === field.type && meta.MaxLength === field.maxLength && required === 'None' && meta.IsValidForRead && meta.IsValidForUpdate;
    if (!ok) failures++;
    console.log(`${field.name}: ${meta.AttributeType}, max ${meta.MaxLength}, required ${required}, read ${meta.IsValidForRead}, update ${meta.IsValidForUpdate} -> ${ok ? 'ok' : 'MISMATCH'}`);
  }

  console.log('--- real read ---');
  try {
    const select = ['akoya_requestid', ...EXPECTED.map((f) => f.name)].join(',');
    const body = await get(`/akoya_requests?$select=${select}&$top=5`);
    const rows = Array.isArray(body.value) ? body.value : [];
    console.log(`selected all five fields: ${rows.length} rows returned`);
    for (const field of EXPECTED) {
      console.log(`  ${field.name}: ${rows.filter((r) => r[field.name] != null && r[field.name] !== '').length} of ${rows.length} hold a value`);
    }
  } catch (error) {
    failures++;
    console.log(`read failed: ${error.message}`);
  }

  console.log(failures ? `\n${failures} problem(s) found` : '\nall five fields present and readable');
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exit(1); });
