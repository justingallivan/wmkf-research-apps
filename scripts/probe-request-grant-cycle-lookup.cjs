#!/usr/bin/env node
/**
 * Read-only probe: can the request's grant-cycle lookup (akoya_request.wmkf_grantcycle
 * → wmkf_grantcycle) replace meeting-date cycle derivation (lib/utils/cycle-code.js)?
 * Dataverse GETs only; the sole POST acquires the application's OAuth token.
 * Usage: node scripts/probe-request-grant-cycle-lookup.cjs --env-file <local env> --output <new json>
 *
 * Reports, for requests with a meeting date or creation date since 2024-01-01:
 * lookup coverage, lookup-vs-meeting-date agreement (with sample request numbers),
 * coverage by status and creation month (is the lookup set at submission?), the
 * Research D26/J27 picture, opportunity → cycle links, lookup metadata, and
 * workflow definitions that mention the lookup. No titles, people or free text.
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const SINCE = '2024-01-01';
const RESEARCH_PROGRAM_IDS = new Set([
  '8dcab30b-958f-ee11-8179-000d3a341e8f', // Science and Engineering Research
  '94cab30b-958f-ee11-8179-000d3a341e8f', // Medical Research
]);
const SAMPLE_LIMIT = 10;

// Mirrors meetingDateToCycleCode in lib/utils/cycle-code.js (UTC month; June → J, December → D).
function meetingDateToCycleCode(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1;
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  if (month === 6) return `J${yy}`;
  if (month === 12) return `D${yy}`;
  return null;
}

function bump(map, key, by = 1) { map[key] = (map[key] || 0) + by; }

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
  const report = { capturedAt: new Date().toISOString(), target, since: SINCE, externalMethods: ['OAuth token POST', 'Dataverse GET'], errors: [], queries: [] };
  async function get(path) {
    const url = new URL(path, target + '/api/data/v9.2/');
    assert(url.origin === target, 'Refuse cross-origin pagination');
    calls++;
    const result = await client.get(path, { Prefer: 'odata.maxpagesize=500,odata.include-annotations="OData.Community.Display.V1.FormattedValue"' }, { timeoutMs: 30000 });
    if (!result.ok) throw new Error(`GET failed HTTP ${result.status}: ${result.body?.error?.code || 'unknown_code'}`);
    return result.body;
  }
  async function all(path) {
    const rows = []; let next = path; let pages = 0;
    while (next && pages < 100) {
      const body = await get(next); assert(Array.isArray(body.value), 'Expected collection');
      rows.push(...body.value); next = body['@odata.nextLink']; pages++;
    }
    assert(!next, 'Incomplete pagination');
    report.queries.push({ path: path.split('?')[0], pages, rows: rows.length, complete: true });
    return rows;
  }
  async function section(name, fn) {
    try { report[name] = await fn(); console.log(`${name}: complete`); }
    catch (error) { report.errors.push({ section: name, message: error.message }); console.log(`${name}: ${error.message}`); }
  }

  await section('lookup_metadata', async () => {
    const base = "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_grantcycle')";
    const attr = await get(`${base}/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,AttributeType,Targets,RequiredLevel,IsAuditEnabled,IsValidForUpdate,SourceType`);
    return { name: attr.LogicalName, type: attr.AttributeType, targets: attr.Targets, required: attr.RequiredLevel?.Value ?? null, auditEnabled: attr.IsAuditEnabled?.Value ?? null, writable: attr.IsValidForUpdate, sourceType: attr.SourceType };
  });

  const cycles = new Map();
  await section('cycles', async () => {
    const rows = await all('/wmkf_grantcycles?$select=wmkf_grantcycleid,wmkf_name,wmkf_cyclecode,wmkf_meetingdate,statecode');
    for (const r of rows) cycles.set(r.wmkf_grantcycleid, r);
    const modern = rows.filter(r => /^[JD]\d{2}$/.test(r.wmkf_cyclecode || ''));
    return {
      total: rows.length,
      modernCodes: modern.length,
      recent: modern.filter(r => Number(r.wmkf_cyclecode.slice(1)) >= 24)
        .map(r => ({ code: r.wmkf_cyclecode, name: r.wmkf_name, boardDate: r.wmkf_meetingdate, boardDateCycle: meetingDateToCycleCode(r.wmkf_meetingdate), state: r.statecode }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  });

  await section('requests', async () => {
    const filter = encodeURIComponent(`wmkf_meetingdate ge ${SINCE}T00:00:00Z or createdon ge ${SINCE}T00:00:00Z`);
    const rows = await all(`/akoya_requests?$select=akoya_requestnum,_wmkf_grantcycle_value,wmkf_meetingdate,akoya_requeststatus,_akoya_programid_value,createdon,wmkf_istestrequest&$filter=${filter}`);
    const out = { scanned: rows.length, withLookup: 0, withMeetingDateCycle: 0, agreement: {}, mismatchSamples: {}, byStatus: {}, byCreatedMonth: {}, byCreatedMonthProgram: {}, missingByProgramStatus: {}, research: { byLookupCode: {}, byMeetingDateCycle: {}, d26j27: {} } };
    for (const r of rows) {
      if (r.wmkf_istestrequest === true) { bump(out, 'skippedTest'); continue; }
      const lookupId = r._wmkf_grantcycle_value || null;
      const lookupCode = lookupId ? (cycles.get(lookupId)?.wmkf_cyclecode || 'unknown-cycle-row') : null;
      const dateCode = meetingDateToCycleCode(r.wmkf_meetingdate);
      if (lookupId) out.withLookup++;
      if (dateCode) out.withMeetingDateCycle++;
      const pair = `${lookupCode || 'no lookup'} | ${dateCode || (r.wmkf_meetingdate ? 'date not Jun/Dec' : 'no date')}`;
      bump(out.agreement, pair);
      if (lookupCode !== dateCode) {
        const list = (out.mismatchSamples[pair] ||= []);
        if (list.length < SAMPLE_LIMIT) list.push(r.akoya_requestnum);
      }
      const status = r.akoya_requeststatus || '(blank)';
      const s = (out.byStatus[status] ||= { total: 0, withLookup: 0 });
      s.total++; if (lookupId) s.withLookup++;
      const month = (r.createdon || '').slice(0, 7) || '(none)';
      if (month >= SINCE.slice(0, 7)) {
        const m = (out.byCreatedMonth[month] ||= { total: 0, withLookup: 0 });
        m.total++; if (lookupId) m.withLookup++;
      }
      const program = r['_akoya_programid_value@OData.Community.Display.V1.FormattedValue'] || (r._akoya_programid_value ? 'unnamed program' : '(no program)');
      if (month >= '2026-01') {
        const mp = ((out.byCreatedMonthProgram[month] ||= {})[program] ||= { total: 0, withLookup: 0 });
        mp.total++; if (lookupId) mp.withLookup++;
      }
      if (!lookupId) bump(out.missingByProgramStatus, `${program} | ${status}`);
      if (RESEARCH_PROGRAM_IDS.has(r._akoya_programid_value)) {
        bump(out.research.byLookupCode, lookupCode || 'no lookup');
        bump(out.research.byMeetingDateCycle, dateCode || 'none');
        if (['D26', 'J27'].includes(lookupCode) || ['D26', 'J27'].includes(dateCode)) {
          bump(out.research.d26j27, `${lookupCode || 'no lookup'} | ${dateCode || 'none'} | ${status}`);
        }
      }
    }
    return out;
  });

  await section('opportunities', async () => {
    const entity = await get("/EntityDefinitions(LogicalName='akoya_akoyaapply')?$select=PrimaryIdAttribute,PrimaryNameAttribute");
    const rows = await all(`/akoya_akoyaapplies?$select=${entity.PrimaryIdAttribute},${entity.PrimaryNameAttribute},_wmkf_grantcycle_value,statecode`);
    return {
      total: rows.length,
      withLookup: rows.filter(r => r._wmkf_grantcycle_value).map(r => ({
        name: r[entity.PrimaryNameAttribute] ?? null,
        cycleCode: cycles.get(r._wmkf_grantcycle_value)?.wmkf_cyclecode || 'unknown-cycle-row',
        state: r.statecode,
      })),
    };
  });

  await section('workflows_mentioning_lookup', async () => {
    const flowFilter = encodeURIComponent("type eq 1 and (category eq 0 or category eq 5) and (primaryentity eq 'akoya_request' or primaryentity eq 'akoya_akoyaapply' or primaryentity eq 'akoya_goapplystatustracking' or primaryentity eq 'wmkf_grantcycle' or primaryentity eq 'none')");
    const rows = await all('/workflows?$select=name,category,statecode,primaryentity,clientdata,xaml,triggeronupdateattributelist,triggeroncreate,modifiedon&$filter=' + flowFilter);
    return rows
      .filter(row => [row.clientdata, row.xaml].filter(Boolean).join('\n').toLowerCase().includes('wmkf_grantcycle'))
      .map(row => ({ name: row.name, category: row.category, state: row.statecode, primaryEntity: row.primaryentity, onCreate: row.triggeroncreate || false, updateAttributes: row.triggeronupdateattributelist || null, modifiedOn: row.modifiedon }));
  });

  report.dataverseGetCalls = calls;
  fs.writeFileSync(args[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved non-secret evidence: ${args[3]}; Dataverse GETs: ${calls}; failed sections: ${report.errors.length}`);
  if (report.errors.length) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
