#!/usr/bin/env node
/**
 * Sandbox setup for the meeting-date retirement
 * (docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md, build step 1).
 *
 * The sandbox Grant Cycle table (wmkf_grantcycles) is empty and no sandbox
 * request carries the Grant Cycle link, so nothing cycle-dependent can be
 * rehearsed there once the apps read cycles only from the link. This script:
 *   1. reads the J26, D26 and J27 calendar rows from PRODUCTION (GET only),
 *   2. creates those rows in the SANDBOX, plus test-only D97 and D99 rows whose
 *      Board date matches the existing sandbox test requests,
 *   3. links sandbox requests whose meeting date falls in one of those cycles.
 * Rows that already exist and requests already linked are left alone.
 *
 * Usage: node scripts/seed-sandbox-grant-cycles.cjs --env-file <path> [--execute]
 * Without --execute it only prints the plan. Writes go to the sandbox only; the
 * target interlock refuses any production write.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const PRODUCTION = 'https://wmkf.crm.dynamics.com';
const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const REAL_CODES = ['J26', 'D26', 'J27'];
const TEST_CYCLES = [
  { code: 'D97', name: 'December 2097 (sandbox test cycle)', month: '2097-12' },
  { code: 'D99', name: 'December 2099 (sandbox test cycle)', month: '2099-12' },
];

async function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf('--env-file');
  assert(envIndex !== -1 && args[envIndex + 1], 'Use --env-file <path> [--execute]');
  const execute = args.includes('--execute');
  const credentials = parseEnv(fs.readFileSync(args[envIndex + 1], 'utf8'));
  for (const name of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
    assert(credentials[name], 'Required application credential missing');
    process.env[name] = credentials[name];
  }
  delete process.env.VERCEL_ENV;
  delete process.env.DATAVERSE_PROD_WRITE_ACK;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });

  const repo = path.resolve(__dirname, '..');
  const { createClient, getAccessToken } = require(path.join(repo, 'lib/dataverse/client.js'));
  const calendar = await import(path.join(repo, 'shared/config/cycleCalendar.js'));
  const dateColumns = [calendar.CYCLE_CALENDAR_BOARD_DATE.column, ...calendar.CYCLE_CALENDAR_DATE_COLUMNS.map(({ column }) => column)];

  const production = createClient({ resourceUrl: PRODUCTION, token: await getAccessToken(PRODUCTION) });
  const sandbox = createClient({ resourceUrl: SANDBOX, token: await getAccessToken(SANDBOX) });
  const read = async (client, p) => {
    const rows = [];
    let next = p;
    for (let pages = 0; next; pages++) {
      assert(pages < 100, 'Too many pages');
      const r = await client.get(next);
      if (!r.ok) throw new Error(`GET ${String(next).split('?')[0]} failed HTTP ${r.status}: ${r.body?.error?.code || 'unknown'}`);
      rows.push(...r.body.value);
      next = r.body['@odata.nextLink'];
    }
    return rows;
  };
  const dateOnly = (v) => (typeof v === 'string' ? v.slice(0, 10) : null);

  // 1. Production calendar rows (dates only).
  const codeFilter = REAL_CODES.map((c) => `wmkf_cyclecode eq '${c}'`).join(' or ');
  const prodRows = await read(production, `/wmkf_grantcycles?$select=wmkf_cyclecode,wmkf_name,${dateColumns.join(',')}&$filter=${codeFilter}`);
  assert.equal(prodRows.length, REAL_CODES.length, `Expected ${REAL_CODES.length} production calendar rows, found ${prodRows.length}`);

  // Sandbox test requests fix the test cycles' Board dates.
  const sandboxRequests = await read(sandbox, '/akoya_requests?$select=akoya_requestid,akoya_requestnum,wmkf_meetingdate,_wmkf_grantcycle_value,wmkf_istestrequest&$filter=wmkf_meetingdate ge 2025-06-01');
  const wanted = [];
  for (const row of prodRows) {
    const body = { wmkf_cyclecode: row.wmkf_cyclecode, wmkf_name: row.wmkf_name || row.wmkf_cyclecode };
    for (const column of dateColumns) if (row[column]) body[column] = row[column];
    wanted.push(body);
  }
  for (const test of TEST_CYCLES) {
    const dates = [...new Set(sandboxRequests.map((r) => dateOnly(r.wmkf_meetingdate)).filter((d) => d?.startsWith(test.month)))];
    assert(dates.length === 1, `Expected one sandbox meeting date in ${test.month}, found ${dates.join(', ') || 'none'}`);
    wanted.push({ wmkf_cyclecode: test.code, wmkf_name: test.name, [calendar.CYCLE_CALENDAR_BOARD_DATE.column]: `${dates[0]}T00:00:00Z` });
  }

  // 2. Sandbox rows to create.
  const existing = await read(sandbox, '/wmkf_grantcycles?$select=wmkf_grantcycleid,wmkf_cyclecode');
  const idByCode = new Map(existing.map((r) => [r.wmkf_cyclecode, r.wmkf_grantcycleid]));
  const toCreate = wanted.filter((w) => !idByCode.has(w.wmkf_cyclecode));

  // 3. Sandbox requests to link (month of the meeting date → cycle code).
  const codeForDate = (d) => {
    const m = Number(d.slice(5, 7));
    return m === 6 ? `J${d.slice(2, 4)}` : m === 12 ? `D${d.slice(2, 4)}` : null;
  };
  const wantedCodes = new Set(wanted.map((w) => w.wmkf_cyclecode));
  const toLink = sandboxRequests
    .map((r) => ({ id: r.akoya_requestid, number: r.akoya_requestnum, test: r.wmkf_istestrequest === true, date: dateOnly(r.wmkf_meetingdate), linked: Boolean(r._wmkf_grantcycle_value) }))
    .map((r) => ({ ...r, code: codeForDate(r.date) }))
    .filter((r) => r.code && wantedCodes.has(r.code) && !r.linked);

  console.log(`Mode: ${execute ? 'EXECUTE (sandbox writes)' : 'dry run (no writes)'}`);
  console.log(`Sandbox Grant Cycle rows to create (${toCreate.length}):`);
  for (const w of toCreate) {
    const dates = dateColumns.filter((c) => w[c]).map((c) => `${c.replace(/^wmkf_(research)?/, '')}=${dateOnly(w[c])}`);
    console.log(`  ${w.wmkf_cyclecode}  "${w.wmkf_name}"  ${dates.join(' ')}`);
  }
  for (const w of wanted.filter((x) => idByCode.has(x.wmkf_cyclecode))) console.log(`  ${w.wmkf_cyclecode}: already exists, left alone`);
  const byCode = {};
  for (const r of toLink) (byCode[r.code] ||= []).push(`${r.number}${r.test ? ' (test)' : ''}`);
  console.log(`Sandbox requests to link (${toLink.length}):`);
  for (const [code, list] of Object.entries(byCode)) console.log(`  ${code} ← ${list.join(', ')}`);
  if (!execute) return;

  for (const w of toCreate) {
    const r = await sandbox.post('/wmkf_grantcycles', w, { Prefer: 'return=representation' });
    if (!r.ok) throw new Error(`Create ${w.wmkf_cyclecode} failed HTTP ${r.status}: ${r.body?.error?.message || 'unknown'}`);
    idByCode.set(w.wmkf_cyclecode, r.body.wmkf_grantcycleid);
    console.log(`created ${w.wmkf_cyclecode}`);
  }
  for (const r of toLink) {
    const result = await sandbox.patch(`/akoya_requests(${r.id})`, { 'wmkf_GrantCycle@odata.bind': `/wmkf_grantcycles(${idByCode.get(r.code)})` }, { 'If-Match': '*' });
    if (!result.ok) throw new Error(`Link ${r.number} failed HTTP ${result.status}: ${result.body?.error?.message || 'unknown'}`);
    console.log(`linked ${r.number} → ${r.code}`);
  }
}

main().catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
