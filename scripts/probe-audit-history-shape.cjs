#!/usr/bin/env node
/**
 * Read-only probe: what does Dataverse actually return for per-record audit
 * history, as the cycle calendar reads it (D43;
 * docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md §4)?
 *
 * Settles the Codex adversarial-review finding (2026-10-28) that Web API
 * AuditDetail entries may omit AuditRecord, which would leave no actor or
 * timestamp. Dataverse GETs only; the sole POST acquires the OAuth token.
 *
 * Targets: one recently modified akoya_request (has history) and the J27
 * wmkf_grantcycle row (auditing enabled 2026-10-28; expected empty).
 * Calls: RetrieveRecordChangeHistory (what the calendar uses), plus the
 * fallback route — /audits filtered to the one object, and
 * RetrieveAuditDetails on one audit row — reporting HTTP status and shape.
 *
 * Saves STRUCTURE ONLY: key names, @odata.type values, presence flags and
 * counts. No field values, names, ids or timestamps are written.
 *
 * Usage: node scripts/probe-audit-history-shape.cjs --env-file <local env> --output <new json>
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const FORMATTED = '@OData.Community.Display.V1.FormattedValue';
const PREFER = 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"';

function keysOf(value) {
  return value && typeof value === 'object' ? Object.keys(value).sort() : null;
}

function describeDetail(detail) {
  const record = detail?.AuditRecord;
  return {
    odataType: detail?.['@odata.type'] ?? null,
    topLevelKeys: keysOf(detail),
    auditRecordPresent: Boolean(record),
    auditRecordKeys: keysOf(record),
    hasCreatedOn: Boolean(record?.createdon),
    hasUserId: Boolean(record?._userid_value),
    hasUserIdFormatted: Boolean(record?.[`_userid_value${FORMATTED}`]),
    hasCallingUserId: Boolean(record?._callinguserid_value),
    newValueKeyCount: keysOf(detail?.NewValue)?.filter(k => !k.includes('@')).length ?? null,
    oldValueKeyCount: keysOf(detail?.OldValue)?.filter(k => !k.includes('@')).length ?? null,
    newValueHasAnnotations: Boolean(keysOf(detail?.NewValue)?.some(k => k.includes('@'))),
  };
}

function summarize(details) {
  const signatures = {};
  for (const detail of details) {
    const d = describeDetail(detail);
    const key = JSON.stringify(d);
    signatures[key] = (signatures[key] || 0) + 1;
  }
  return {
    detailCount: details.length,
    distinctShapes: Object.entries(signatures).map(([shape, count]) => ({ count, ...JSON.parse(shape) })),
  };
}

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
  const report = { capturedAt: new Date().toISOString(), target, externalMethods: ['OAuth token POST', 'Dataverse GET'], targets: {} };
  async function get(path) {
    calls++;
    return client.get(path, { Prefer: PREFER });
  }

  const recent = await get(`/akoya_requests?$select=akoya_requestid&$top=1&$orderby=modifiedon desc&$filter=${encodeURIComponent('createdon ge 2024-01-01T00:00:00Z')}`);
  assert(recent.ok && recent.body.value?.length === 1, `Could not pick a request (HTTP ${recent.status})`);
  const cycle = await get(`/wmkf_grantcycles?$select=wmkf_grantcycleid&$filter=${encodeURIComponent("wmkf_cyclecode eq 'J27'")}`);
  assert(cycle.ok && cycle.body.value?.length === 1, `Could not find the J27 cycle row (HTTP ${cycle.status})`);

  const targets = [
    ['akoya_request (most recently modified)', 'akoya_requests', recent.body.value[0].akoya_requestid],
    ['wmkf_grantcycle J27', 'wmkf_grantcycles', cycle.body.value[0].wmkf_grantcycleid],
  ];
  for (const [label, set, id] of targets) {
    const out = {};
    const t = encodeURIComponent(JSON.stringify({ '@odata.id': `${set}(${id})` }));
    const history = await get(`/RetrieveRecordChangeHistory(Target=@t)?@t=${t}`);
    out.retrieveRecordChangeHistory = { status: history.status, responseKeys: keysOf(history.body), collectionKeys: keysOf(history.body?.AuditDetailCollection) };
    if (history.ok) Object.assign(out.retrieveRecordChangeHistory, summarize(history.body?.AuditDetailCollection?.AuditDetails || []));

    // Fallback route: audit rows for exactly this object, then details for one row.
    const audits = await get(`/audits?$select=auditid,createdon,_userid_value,action,operation&$orderby=createdon desc&$top=5&$filter=${encodeURIComponent(`_objectid_value eq ${id}`)}`);
    out.auditsByObject = { status: audits.status, rowCount: audits.body?.value?.length ?? null, rowKeys: keysOf(audits.body?.value?.[0]) };
    if (audits.ok && audits.body.value?.length) {
      const details = await get(`/audits(${audits.body.value[0].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails()`);
      out.retrieveAuditDetails = { status: details.status, responseKeys: keysOf(details.body) };
      if (details.ok && details.body?.AuditDetail) out.retrieveAuditDetails.detail = describeDetail(details.body.AuditDetail);
    }
    report.targets[label] = out;
  }

  report.dataverseGetCalls = calls;
  fs.writeFileSync(args[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved structure-only evidence: ${args[3]}; Dataverse GETs: ${calls}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
