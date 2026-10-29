#!/usr/bin/env node
/**
 * Read-only probe: which date fields does the operations Grant Cycle table
 * (wmkf_grantcycle) carry, and what values do the recent cycle rows hold?
 * Dataverse GETs only; the sole POST acquires the application's OAuth token.
 * Usage: node scripts/probe-grant-cycle-dates.cjs --env-file <local env> --output <new json>
 *
 * Reports organization/table audit settings, every custom attribute (name,
 * type, required level, writability, auditing),
 * DateTime format/behavior, and the custom field values on rows whose cycle
 * code is a modern J/D code from 26 onward. No people or free text beyond
 * cycle names.
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--env-file' && args[2] === '--output', 'Use --env-file <path> --output <path>');
  const credentials = parseEnv(fs.readFileSync(args[1], 'utf8'));
  for (const name of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
    assert(credentials[name], 'Required application credential missing');
    process.env[name] = credentials[name];
  }
  const target = 'https://wmkf.crm.dynamics.com';
  assert(new URL(credentials.DYNAMICS_URL).origin === target, 'Credential environment target differs from approved production hostname');
  delete process.env.VERCEL_ENV;
  delete process.env.DATAVERSE_PROD_WRITE_ACK;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });
  let calls = 0;
  const report = { capturedAt: new Date().toISOString(), target, externalMethods: ['OAuth token POST', 'Dataverse GET'], errors: [] };
  async function get(path) {
    calls++;
    const result = await client.get(path, { Prefer: 'odata.maxpagesize=500' }, { timeoutMs: 30000 });
    if (!result.ok) throw new Error(`GET failed HTTP ${result.status}: ${result.body?.error?.code || 'unknown_code'}`);
    return result.body;
  }

  // Field-level audit history needs auditing on for the organization, the table and the column.
  const org = await get('/organizations?$select=isauditenabled');
  const entity = await get("/EntityDefinitions(LogicalName='wmkf_grantcycle')?$select=IsAuditEnabled");
  report.audit = { organization: org.value?.[0]?.isauditenabled ?? null, table: entity.IsAuditEnabled?.Value ?? null };

  const base = "/EntityDefinitions(LogicalName='wmkf_grantcycle')/Attributes";
  const attrs = await get(`${base}?$select=LogicalName,SchemaName,AttributeType,RequiredLevel,IsValidForUpdate,IsCustomAttribute,AttributeOf,DisplayName,IsAuditEnabled`);
  const dates = await get(`${base}/Microsoft.Dynamics.CRM.DateTimeAttributeMetadata?$select=LogicalName,Format,DateTimeBehavior`);
  const dateInfo = new Map(dates.value.map(d => [d.LogicalName, d]));
  const custom = attrs.value
    .filter(a => a.IsCustomAttribute && !a.AttributeOf)
    .map(a => ({
      logicalName: a.LogicalName,
      schemaName: a.SchemaName,
      displayName: a.DisplayName?.UserLocalizedLabel?.Label ?? null,
      type: a.AttributeType,
      required: a.RequiredLevel?.Value ?? null,
      writable: a.IsValidForUpdate,
      auditEnabled: a.IsAuditEnabled?.Value ?? null,
      dateFormat: dateInfo.get(a.LogicalName)?.Format ?? null,
      dateBehavior: dateInfo.get(a.LogicalName)?.DateTimeBehavior?.Value ?? null,
    }))
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  report.customAttributes = custom;

  const fields = custom
    .filter(a => !['Lookup', 'Owner', 'Customer', 'Uniqueidentifier'].includes(a.type))
    .map(a => a.logicalName);
  const rows = await get(`/wmkf_grantcycles?$select=${['wmkf_grantcycleid', 'statecode', 'createdon', 'modifiedon', ...fields].join(',')}`);
  assert(!rows['@odata.nextLink'], 'Unexpected pagination');
  report.totalRows = rows.value.length;
  report.recentRows = rows.value
    .filter(r => /^[JD]\d{2}$/.test(r.wmkf_cyclecode || '') && Number(r.wmkf_cyclecode.slice(1)) >= 26)
    .map(r => Object.fromEntries([['state', r.statecode], ['createdOn', r.createdon], ['modifiedOn', r.modifiedon], ...fields.map(f => [f, r[f] ?? null])]))
    .sort((a, b) => String(a.wmkf_cyclecode).localeCompare(String(b.wmkf_cyclecode)));

  report.dataverseGetCalls = calls;
  fs.writeFileSync(args[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved non-secret evidence: ${args[3]}; Dataverse GETs: ${calls}; custom attributes: ${custom.length}; recent rows: ${report.recentRows.length}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
