/**
 * probe-graph-write-access.mjs
 *
 * Tests whether the app registration has write access to SharePoint by:
 *  1. Looking up the request's SharePoint folder from Dynamics
 *  2. Uploading a tiny sentinel file to that folder
 *  3. Deleting the sentinel immediately
 *
 * Net result on SharePoint: no change.
 *
 * Usage:
 *   node scripts/probe-graph-write-access.mjs <requestId>
 *
 * <requestId> is the akoya_request GUID. Find one via the Workbench URL:
 *   /workbench/<requestId>  — copy the GUID from the browser address bar.
 *
 * Requires .env.local with DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID,
 * DYNAMICS_CLIENT_SECRET, and DYNAMICS_RESOURCE_URL.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
if (!existsSync(envPath)) {
  console.error('ERROR: .env.local not found. Run from repo root.');
  process.exit(1);
}
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  if (!process.env[key]) process.env[key] = val;
}

// ── Args ─────────────────────────────────────────────────────────────────────
const arg = process.argv[2];
if (!arg) {
  console.error(
    'Usage: node scripts/probe-graph-write-access.mjs <requestId|requestNum>\n' +
    '\n' +
    'Accepts either:\n' +
    '  - A request number (e.g. 1002788)\n' +
    '  - A request GUID (from the Workbench URL /workbench/<guid>)\n'
  );
  process.exit(1);
}

const isGuid   = /^[0-9a-f-]{36}$/i.test(arg);
const isNumber = /^\d+$/.test(arg);
if (!isGuid && !isNumber) {
  console.error(`ERROR: "${arg}" is not a valid request number or GUID.`);
  process.exit(1);
}

// ── Dynamic imports (after env is loaded) ────────────────────────────────────
const { GraphService }                  = await import('../lib/services/graph-service.js');
const { DynamicsService }               = await import('../lib/services/dynamics-service.js');
const { getRequestSharePointBuckets }   = await import('../lib/utils/sharepoint-buckets.js');
const { enterDynamicsBypassForScript }  = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-graph-write-access');

// ── Resolve requestId + requestNumber from Dynamics ──────────────────────────
console.log(`\nGraph API write-access probe`);
console.log(`  Input: ${arg} (${isGuid ? 'GUID' : 'request number'})\n`);

console.log('Step 1: resolving SharePoint folder from Dynamics...');

let requestId, requestNumber;
try {
  if (isGuid) {
    const result = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestnum',
      filter: `akoya_requestid eq '${arg}'`,
      top: 1,
    });
    requestId     = arg;
    requestNumber = result.records?.[0]?.akoya_requestnum;
    if (!requestNumber) throw new Error('Request not found or missing akoya_requestnum');
  } else {
    const result = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum',
      filter: `akoya_requestnum eq '${arg}'`,
      top: 1,
    });
    const row = result.records?.[0];
    if (!row) throw new Error(`No request found with akoya_requestnum = ${arg}`);
    requestId     = row.akoya_requestid;
    requestNumber = row.akoya_requestnum;
  }
} catch (err) {
  console.error(`  ERROR: could not look up request — ${err.message}`);
  process.exit(1);
}

let buckets;
try {
  buckets = await getRequestSharePointBuckets(requestId, requestNumber);
} catch (err) {
  console.error(`  ERROR: could not resolve SharePoint buckets — ${err.message}`);
  process.exit(1);
}

// Use the first Dynamics-tracked bucket (not an archive speculative one)
const bucket = buckets.find(b => b.source === 'dynamics') || buckets[0];
if (!bucket) {
  console.error('  ERROR: no SharePoint folder found for this request in Dynamics');
  process.exit(1);
}

console.log(`  ✓ Folder resolved`);
console.log(`    Library: ${bucket.library}`);
console.log(`    Folder : ${bucket.folder}\n`);

// ── Upload + delete sentinel ─────────────────────────────────────────────────
const SENTINEL_FILENAME = `.probe-write-access-${Date.now()}.txt`;
const SENTINEL_CONTENT  = Buffer.from(
  `Write access probe — created by probe-graph-write-access.mjs at ${new Date().toISOString()}. Safe to delete.`
);

console.log(`Step 2: uploading sentinel file "${SENTINEL_FILENAME}"...`);

let uploadedId = null;
let driveId    = null;

try {
  const result = await GraphService.uploadFile(
    bucket.library,
    bucket.folder,
    SENTINEL_FILENAME,
    SENTINEL_CONTENT,
    'text/plain',
  );
  uploadedId = result.id;
  driveId    = await GraphService.getDriveId(bucket.library);
  console.log(`  ✓ Upload succeeded`);
  console.log(`    size  : ${result.size} bytes`);
  console.log(`    webUrl: ${result.webUrl}`);

  console.log('\nStep 3: deleting sentinel file...');
  await GraphService.deleteFile(driveId, uploadedId);
  console.log('  ✓ Delete succeeded — no net change to SharePoint\n');

  console.log('RESULT: Graph API write access is CONFIRMED for this registration.\n');
  console.log('The D26 Pre-Site-Visit writeup tab can write Word docs to SharePoint directly.');
} catch (err) {
  // Best-effort cleanup
  if (uploadedId && driveId) {
    try {
      await GraphService.deleteFile(driveId, uploadedId);
      console.warn('  (sentinel cleaned up after error)');
    } catch {
      console.warn(`  WARNING: sentinel file "${SENTINEL_FILENAME}" may remain in SharePoint — delete manually.`);
    }
  }

  const status = err.status || err.statusCode || '';
  const msg    = err.message || String(err);
  if (status === 403 || msg.includes('403')) {
    console.error('RESULT: Write access DENIED (403 Forbidden).');
    console.error('  The app registration lacks Files.ReadWrite or Sites.ReadWrite.All.');
    console.error('  Connor will need to grant write permissions in Azure AD.\n');
    console.error('  For D26, the fallback is: generate draft locally → staff uploads to');
    console.error('  SharePoint manually → paste the URL into a capture field in the tab.\n');
  } else if (status === 401 || msg.includes('401')) {
    console.error('RESULT: Authentication failed (401).');
    console.error('  Check DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET in .env.local.\n');
  } else {
    console.error('RESULT: Probe failed with unexpected error.');
    console.error(`  ${msg}\n`);
  }
  process.exit(1);
}
