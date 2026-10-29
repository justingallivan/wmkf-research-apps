#!/usr/bin/env node
/**
 * Read-only probe: print one operations Grant Cycle row's audit history as the
 * cycle calendar reads it (RetrieveRecordChangeHistory), so attribution can be
 * diagnosed against real entries. Scope: the one row named by --cycle (e.g.
 * J27), its current calendar date values, and per entry the type, action,
 * timestamp, acting user name, and the calendar date columns present in
 * NewValue / OldValue / DeletedAttributes with their values. Dataverse GETs
 * only; the sole POST acquires the OAuth token. Prints to stdout; no file.
 *
 * Usage: node scripts/probe-grant-cycle-history-entries.cjs --env-file <local env> --cycle J27
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const FV = '@OData.Community.Display.V1.FormattedValue';
const DATE_COLUMN = /^wmkf_(research\w+date|boardmailingdate|meetingdate)$/;

function pickDates(side) {
  if (!side || typeof side !== 'object') return side ?? null;
  return Object.fromEntries(Object.entries(side).filter(([k]) => DATE_COLUMN.test(k.split('@')[0])));
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--env-file' && args[2] === '--cycle' && /^[JD]\d{2}$/.test(args[3]), 'Use --env-file <path> --cycle <J27|D26|...>');
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
  const prefer = { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' };

  const rows = await client.get(`/wmkf_grantcycles?$filter=${encodeURIComponent(`wmkf_cyclecode eq '${args[3]}'`)}`, prefer);
  assert(rows.ok && rows.body.value?.length === 1, `Cycle row not found (HTTP ${rows.status})`);
  const row = rows.body.value[0];
  console.log('Current row dates:', JSON.stringify(pickDates(row)), 'modifiedon:', row.modifiedon);

  const t = encodeURIComponent(JSON.stringify({ '@odata.id': `wmkf_grantcycles(${row.wmkf_grantcycleid})` }));
  const history = await client.get(`/RetrieveRecordChangeHistory(Target=@t)?@t=${t}`, prefer);
  console.log('History HTTP', history.status, 'MoreRecords:', history.body?.AuditDetailCollection?.MoreRecords, 'TotalRecordCount:', history.body?.AuditDetailCollection?.TotalRecordCount);
  for (const [i, d] of (history.body?.AuditDetailCollection?.AuditDetails || []).entries()) {
    const r = d.AuditRecord || {};
    console.log(`\n#${i} type=${d['@odata.type'] || '(none)'} action=${r[`action${FV}`] || r.action} operation=${r[`operation${FV}`] || r.operation} createdon=${r.createdon} user=${r[`_userid_value${FV}`] || '(no name)'}`);
    console.log('   NewValue dates:', JSON.stringify(pickDates(d.NewValue)));
    console.log('   OldValue dates:', JSON.stringify(pickDates(d.OldValue)));
    console.log('   DeletedAttributes:', JSON.stringify(d.DeletedAttributes ?? null), 'InvalidNewValueAttributes:', JSON.stringify(d.InvalidNewValueAttributes ?? null));
    console.log('   NewValue keys:', JSON.stringify(Object.keys(d.NewValue || {})), 'OldValue keys:', JSON.stringify(Object.keys(d.OldValue || {})));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
