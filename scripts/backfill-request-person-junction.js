#!/usr/bin/env node

/**
 * One-time backfill: legacy akoya_request PI/co-PI slot fields →
 * wmkf_apprequestperson junction rows.
 *
 * Source fields on akoya_request (all contact lookups):
 *   _wmkf_projectleader_value          → role=pi,    position=0
 *   _wmkf_copi1_value .. copi5_value   → role=copi,  position=1..5
 *
 * Steady-state read strategy is the UNION described in
 * docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md §5: junction OR
 * _wmkf_projectleader_value. So this backfill creates a parallel source for
 * historical PI data alongside the still-live projectleader field, and the
 * sole source for legacy co-PI data once Connor's PA flows take over
 * ongoing sync. The co-PI slot fields become read-only legacy after that.
 *
 * Idempotent — pre-fetches every existing junction row and skips inserts
 * that match (request, contact, role). Re-running after a partial run is
 * safe; the alt key (wmkf_request, wmkf_contact, wmkf_role) is the
 * authoritative dedupe.
 *
 * Usage:
 *   node scripts/backfill-request-person-junction.js --dry-run
 *   node scripts/backfill-request-person-junction.js --execute
 *   node scripts/backfill-request-person-junction.js --execute --limit 50
 *
 * Refusing to run without --dry-run or --execute is intentional.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const EXECUTE = args.includes('--execute');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : null;
})();

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('backfill-request-person-junction');

// Picklist values from lib/dataverse/schema/wave2/wmkf_app_request_person.json
const ROLE_PI = 100000000;
const ROLE_COPI = 100000001;

const REQUESTS_ENTITY = 'akoya_requests';
const JUNCTION_ENTITY = 'wmkf_apprequestpersons';

// ────────────────────────────────────────────────────────────────────────────
// Step 1: pre-fetch every existing junction row for dedupe.
// On first run this is empty; on subsequent runs (after a partial backfill or
// after Connor's PA flows have written some rows) we use this set to skip
// rows already present. The alt-key lookup avoids relying on Dataverse to
// reject duplicates — failures are then real failures, not "already there".
//
// DynamicsService.queryAllRecords caps at 5000; the backfill itself created
// 5,561 rows, so a rerun must use raw @odata.nextLink pagination. Mirrors the
// pattern used in Step 2 below for akoya_request.
// ────────────────────────────────────────────────────────────────────────────
console.log('Pre-fetching existing junction rows for dedupe (raw paginated fetch)...');
const existingKeys = new Set();
{
  const token = await DynamicsService.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const params = new URLSearchParams({
    $select: '_wmkf_request_value,_wmkf_contact_value,wmkf_role',
    $filter: 'wmkf_role ne null',
    $count: 'true',
  });
  let url = `${baseUrl}/api/data/v9.2/${JUNCTION_ENTITY}?${params.toString()}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'OData-Version': '4.0',
    Accept: 'application/json',
    Prefer: 'odata.maxpagesize=5000',
  };
  let totalCount = null;
  let pulled = 0;
  let page = 0;
  while (url) {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`junction prefetch failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json();
    if (totalCount === null && data['@odata.count'] !== undefined) {
      totalCount = data['@odata.count'];
    }
    for (const r of (data.value || [])) {
      existingKeys.add(`${r._wmkf_request_value}|${r._wmkf_contact_value}|${r.wmkf_role}`);
      pulled++;
    }
    page++;
    url = data['@odata.nextLink'] || null;
  }
  console.log(`  ${pulled} existing junction rows over ${page} page(s) (totalCount=${totalCount ?? pulled})`);
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2: pull every akoya_request with the 6 lookup fields.
// DynamicsService.queryAllRecords caps at 5000; akoya_request exceeds that.
// Use raw fetch + @odata.nextLink pagination instead. Page size 5000 (Dataverse
// max via Prefer header) so we cover ~tens of thousands of rows in a few hops.
// ────────────────────────────────────────────────────────────────────────────
console.log('\nPulling akoya_request rows (raw paginated fetch)...');
const slotFields = [
  '_wmkf_projectleader_value',
  '_wmkf_copi1_value',
  '_wmkf_copi2_value',
  '_wmkf_copi3_value',
  '_wmkf_copi4_value',
  '_wmkf_copi5_value',
];

const requests = await (async () => {
  const token = await DynamicsService.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const params = new URLSearchParams({
    $select: ['akoya_requestid', 'akoya_requestnum', ...slotFields].join(','),
    $filter: 'akoya_requestnum ne null',
    $orderby: 'akoya_requestnum asc',
    $count: 'true',
  });
  let url = `${baseUrl}/api/data/v9.2/${REQUESTS_ENTITY}?${params.toString()}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'OData-Version': '4.0',
    Accept: 'application/json',
    Prefer: 'odata.maxpagesize=5000',
  };
  const all = [];
  let totalCount = null;
  let page = 0;
  while (url) {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`akoya_request fetch failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json();
    if (totalCount === null && data['@odata.count'] !== undefined) {
      totalCount = data['@odata.count'];
      console.log(`  totalCount=${totalCount}`);
    }
    all.push(...(data.value || []));
    page++;
    process.stdout.write(`  page ${page}: +${(data.value || []).length} rows (running total ${all.length})\n`);
    url = data['@odata.nextLink'] || null;
  }
  return all;
})();
console.log(`  ${requests.length} requests pulled`);

// ────────────────────────────────────────────────────────────────────────────
// Step 3: build candidate junction rows.
// One per populated slot, with within-request dedupe (same contact appearing
// in two co-PI slots collapses to lowest-position; PI slot stays distinct
// from co-PI because role is part of the alt key).
// ────────────────────────────────────────────────────────────────────────────
const candidates = []; // { requestId, requestNum, contactId, role, position }
let totalSlotsRead = 0;
let withinRequestDeduped = 0;

for (const req of requests) {
  const requestId = req.akoya_requestid;
  const requestNum = req.akoya_requestnum;
  const seenInRequest = new Map(); // `${contactId}|${role}` → existing candidate

  const slots = [
    { contactId: req._wmkf_projectleader_value, role: ROLE_PI, position: 0 },
    { contactId: req._wmkf_copi1_value, role: ROLE_COPI, position: 1 },
    { contactId: req._wmkf_copi2_value, role: ROLE_COPI, position: 2 },
    { contactId: req._wmkf_copi3_value, role: ROLE_COPI, position: 3 },
    { contactId: req._wmkf_copi4_value, role: ROLE_COPI, position: 4 },
    { contactId: req._wmkf_copi5_value, role: ROLE_COPI, position: 5 },
  ];

  for (const slot of slots) {
    if (!slot.contactId) continue;
    totalSlotsRead++;
    const key = `${slot.contactId}|${slot.role}`;
    if (seenInRequest.has(key)) {
      withinRequestDeduped++;
      continue; // keep the first (lowest-position) occurrence
    }
    seenInRequest.set(key, true);
    candidates.push({ requestId, requestNum, contactId: slot.contactId, role: slot.role, position: slot.position });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4: filter against pre-fetched existing rows.
// ────────────────────────────────────────────────────────────────────────────
const toInsert = [];
let alreadyExist = 0;
for (const c of candidates) {
  const key = `${c.requestId}|${c.contactId}|${c.role}`;
  if (existingKeys.has(key)) {
    alreadyExist++;
    continue;
  }
  toInsert.push(c);
}

console.log('\n─── Plan ───');
console.log(`Requests scanned:               ${requests.length}`);
console.log(`Populated PI/co-PI slots read:  ${totalSlotsRead}`);
console.log(`Within-request dedupes:         ${withinRequestDeduped}`);
console.log(`Candidate junction rows:        ${candidates.length}`);
console.log(`Already in junction (skip):     ${alreadyExist}`);
console.log(`To insert:                      ${toInsert.length}`);
console.log(`Mode:                           ${DRY ? 'DRY-RUN' : 'EXECUTE'}${LIMIT ? `  limit=${LIMIT}` : ''}`);

const work = LIMIT ? toInsert.slice(0, LIMIT) : toInsert;
if (LIMIT && work.length < toInsert.length) {
  console.log(`(--limit ${LIMIT} → only first ${work.length} of ${toInsert.length} will be inserted)`);
}

if (work.length === 0) {
  console.log('\nNothing to do. Exiting.');
  process.exit(0);
}

// Sample preview for sanity-check
console.log('\nFirst 5 candidates:');
for (const c of work.slice(0, 5)) {
  const roleLabel = c.role === ROLE_PI ? 'PI' : 'Co-PI';
  console.log(`  req ${c.requestNum}  contact ${c.contactId.slice(0, 8)}…  ${roleLabel} pos=${c.position}`);
}

if (DRY) {
  console.log('\n(dry run — no writes)');
  process.exit(0);
}

// ────────────────────────────────────────────────────────────────────────────
// Step 5: insert.
// Sequential — Dataverse throttles aggressive concurrent metadata + data
// traffic and we're not in a hurry. ~200ms/request × 3000 ≈ 10 min.
// Each insert sets:
//   wmkf_request@odata.bind   = /akoya_requests({guid})
//   wmkf_contact@odata.bind   = /contacts({guid})
//   wmkf_role                 = picklist int
//   wmkf_authorposition       = 0..5
// Primary name (wmkf_assignmentkey) is ApplicationRequired — synthesize from
// request number + role + position so picker rendering has a stable label.
// ────────────────────────────────────────────────────────────────────────────
console.log('\nInserting...');
const stats = { ok: 0, dup: 0, fail: 0 };
const failures = [];
const startedAt = Date.now();

for (let i = 0; i < work.length; i++) {
  const c = work[i];
  const roleLabel = c.role === ROLE_PI ? 'PI' : 'Co-PI';
  // @odata.bind keys use the lookup *schema name* (PascalCase), matching the
  // navigation-property convention. The schema spec declared lookupSchemaName:
  // wmkf_Request and wmkf_Contact — so these are the nav properties, not the
  // lowercase logical column names. Lowercase keys produce a 0x80048d19
  // "Error identified in Payload" 400 (caught during smoke before full run).
  const payload = {
    'wmkf_Request@odata.bind': `/akoya_requests(${c.requestId})`,
    'wmkf_Contact@odata.bind': `/contacts(${c.contactId})`,
    wmkf_role: c.role,
    wmkf_authorposition: c.position,
    wmkf_assignmentkey: `${c.requestNum}-${roleLabel}-${c.position}`,
  };

  try {
    await DynamicsService.createRecord(JUNCTION_ENTITY, payload);
    stats.ok++;
  } catch (err) {
    // Defense-in-depth: even though we pre-fetched, a parallel writer (PA flow
    // already cutting over, or another concurrent run) could have inserted
    // the same alt key. Treat duplicate-key errors as "ok, already there".
    const msg = err.message || '';
    if (/duplicate/i.test(msg) || msg.includes('0x80040237') || msg.includes('0x80060891')) {
      stats.dup++;
    } else {
      stats.fail++;
      failures.push({ ...c, error: msg.slice(0, 300) });
      console.log(`  [fail ${i + 1}] req ${c.requestNum} ${roleLabel} pos=${c.position} → ${msg.slice(0, 200)}`);
    }
  }

  if ((i + 1) % 100 === 0 || i === work.length - 1) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const rate = ((i + 1) / (Date.now() - startedAt) * 1000).toFixed(1);
    console.log(`  ${i + 1}/${work.length}  ok=${stats.ok}  dup=${stats.dup}  fail=${stats.fail}  ${elapsed}s  ${rate}/s`);
  }
}

console.log('\n─── Done ───');
console.log(`Inserted:        ${stats.ok}`);
console.log(`Duplicate-skip:  ${stats.dup}`);
console.log(`Failures:        ${stats.fail}`);
if (failures.length) {
  console.log('\nFailure details (first 20):');
  for (const f of failures.slice(0, 20)) {
    const roleLabel = f.role === ROLE_PI ? 'PI' : 'Co-PI';
    console.log(`  req ${f.requestNum}  contact ${f.contactId.slice(0, 8)}…  ${roleLabel} pos=${f.position}`);
    console.log(`    ${f.error}`);
  }
}
process.exit(stats.fail === 0 ? 0 : 1);
