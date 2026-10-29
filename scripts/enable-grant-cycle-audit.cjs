#!/usr/bin/env node
/**
 * Enable Dataverse table auditing on the operations Grant Cycle table
 * (wmkf_grantcycle) so field-level audit history records who changed each
 * cycle date and when (alignment log D43, T14;
 * docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md §4). Organization
 * auditing and every column's audit flag are already on; only the table flag
 * is off (scripts/probe-grant-cycle-dates.cjs, 2026-10-28).
 *
 * Precedent: scripts/enable-suggestion-audit.mjs (same metadata PUT), here
 * routed through lib/dataverse/client.js so the target interlock applies.
 * Changes only IsAuditEnabled; no rows, columns or other settings. Idempotent.
 * Reversible by setting the flag back to false the same way.
 *
 * Usage (owner-run):
 *   node scripts/enable-grant-cycle-audit.cjs --env-file .env.local --check
 *   DATAVERSE_PROD_WRITE_ACK="enable grant cycle audit <today UTC YYYY-MM-DD>" \
 *     node scripts/enable-grant-cycle-audit.cjs --env-file .env.local --apply
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const ENTITY = "/EntityDefinitions(LogicalName='wmkf_grantcycle')";

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 3 && args[0] === '--env-file' && ['--check', '--apply'].includes(args[2]), 'Use --env-file <path> --check|--apply');
  const apply = args[2] === '--apply';
  const credentials = parseEnv(fs.readFileSync(args[1], 'utf8'));
  for (const name of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
    assert(credentials[name], 'Required application credential missing');
    process.env[name] = credentials[name];
  }
  const target = 'https://wmkf.crm.dynamics.com';
  assert(new URL(credentials.DYNAMICS_URL).origin === target, 'Credential environment target differs from approved production hostname');
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  if (!apply) delete process.env.DATAVERSE_PROD_WRITE_ACK;
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });

  async function auditFlag() {
    const result = await client.get(`${ENTITY}?$select=LogicalName,IsAuditEnabled`);
    if (!result.ok) throw new Error(`Metadata read failed HTTP ${result.status}: ${result.body?.error?.code || 'unknown_code'}`);
    return result.body.IsAuditEnabled;
  }

  const before = await auditFlag();
  console.log(`Before: IsAuditEnabled=${before?.Value} CanBeChanged=${before?.CanBeChanged}`);
  if (!apply) return;
  if (before?.Value === true) { console.log('Already enabled; no change made.'); return; }
  assert(before?.CanBeChanged !== false, 'Audit setting is locked (CanBeChanged=false); stopping without a write');

  // The metadata update needs the full entity definition, not a partial body.
  const full = await client.get(ENTITY);
  if (!full.ok) throw new Error(`Full metadata read failed HTTP ${full.status}: ${full.body?.error?.code || 'unknown_code'}`);
  const body = { ...full.body, IsAuditEnabled: { ...before, Value: true } };
  delete body['@odata.context'];
  const put = await client.raw('PUT', ENTITY, body, { 'MSCRM.MergeLabels': 'true' });
  if (!put.ok) throw new Error(`Metadata update failed HTTP ${put.status}: ${put.body?.error?.code || 'unknown_code'} ${put.body?.error?.message || ''}`);
  console.log(`Update: HTTP ${put.status}`);

  const publish = await client.post('/PublishXml', { ParameterXml: '<importexportxml><entities><entity>wmkf_grantcycle</entity></entities></importexportxml>' });
  console.log(`Publish: ${publish.ok ? `HTTP ${publish.status}` : `failed HTTP ${publish.status}: ${publish.body?.error?.code || 'unknown_code'}`}`);

  const after = await auditFlag();
  console.log(`After: IsAuditEnabled=${after?.Value}`);
  if (after?.Value !== true) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
