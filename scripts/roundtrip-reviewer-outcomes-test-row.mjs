#!/usr/bin/env node
/**
 * Prove the Wave 35 reviewer-outcome schema end to end on ONE reviewer row of
 * a marked test request, then put the row back exactly as it was
 * (docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md).
 *
 * Writes wmkf_endedby = Foundation and wmkf_reviewstatus = Did not submit,
 * reads them back, optionally pauses so staff screens can be checked while the
 * values are set, then restores the two original values and verifies them.
 *
 * Refuses unless:
 * - the suggestion's request has wmkf_istestrequest = true;
 * - wmkf_endedby is selectable and Did not submit exists in the live option set;
 * - every write is bound to an ETag (If-Match). The test write returns the
 *   written row (Prefer: return=representation), and the restore is bound to
 *   that exact version, so any other change in between makes the restore stop
 *   (412) instead of overwriting. The written row must still belong to the
 *   original request.
 *
 * Before writing, it creates a recovery record (target, row, original values)
 * under outputs/ (exclusive create, so one run per row). A 5xx or gateway
 * response to a write counts as an unknown outcome and keeps the record. If the run cannot finish the restore, it prints the record
 * path; `--recover` restores from it, only while the row is still on the same
 * marked test request and still holds exactly the test values. --pause waits
 * at most 10 minutes, and an --execute run refuses to start within 20 minutes
 * of UTC midnight, when the day's write ACK expires.
 *
 * Usage:
 *   node scripts/roundtrip-reviewer-outcomes-test-row.mjs --target=sandbox --suggestion=<guid>
 *   DATAVERSE_PROD_WRITE_ACK="outcomes round trip $(date -u +%F)" \
 *     node scripts/roundtrip-reviewer-outcomes-test-row.mjs --target=prod --suggestion=<guid> --execute [--pause]
 *   DATAVERSE_PROD_WRITE_ACK="outcomes round trip $(date -u +%F)" \
 *     node scripts/roundtrip-reviewer-outcomes-test-row.mjs --target=prod --suggestion=<guid> --recover
 *
 * Without --execute it only reads and prints what it would write. Production
 * runs need DATAVERSE_TARGET_INTERLOCK=on and DATAVERSE_ALLOW_PROD_READS=yes;
 * --execute also needs a same-UTC-day DATAVERSE_PROD_WRITE_ACK
 * (scripts/lib/dataverse-script-target.cjs). Dataverse auditing records both
 * writes on the test row.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import {
  ENDED_BY_VALUES, DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
} from '../shared/config/reviewerOutcome.js';

const require = createRequire(import.meta.url);

const ENTITY_SET = 'wmkf_appreviewersuggestions';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_SELECT = 'wmkf_appreviewersuggestionid,wmkf_reviewstatus,wmkf_endedby,_wmkf_request_value';
const PAUSE_LIMIT_MS = 10 * 60 * 1000;
const MIDNIGHT_MARGIN_MS = 20 * 60 * 1000;
const TEST_VALUES = Object.freeze({
  wmkf_endedby: ENDED_BY_VALUES.foundation,
  wmkf_reviewstatus: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
});

export function parseArgs(argv) {
  const args = { execute: false, pause: false, recover: false, suggestionId: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--execute') args.execute = true;
    else if (arg === '--recover') args.recover = true;
    else if (arg === '--pause') args.pause = true;
    else if (arg.startsWith('--suggestion=')) args.suggestionId = arg.slice('--suggestion='.length).toLowerCase();
    else if (!arg.startsWith('--target=')) throw new Error(`Unknown flag: ${arg}`);
  }
  if (!GUID_RE.test(args.suggestionId || '')) throw new Error('Pass --suggestion=<reviewer suggestion GUID>.');
  if (args.pause && !args.execute) throw new Error('--pause only applies with --execute.');
  if (args.recover && args.execute) throw new Error('Choose --execute or --recover, not both.');
  return args;
}

export function originalValues(row) {
  return { wmkf_endedby: row.wmkf_endedby ?? null, wmkf_reviewstatus: row.wmkf_reviewstatus ?? null };
}

export function matches(row, values) {
  return Object.entries(values).every(([field, value]) => (row[field] ?? null) === value);
}

/** Refuse anything other than one ordinary reviewer row on a marked test request. */
export function assertRoundTripAllowed({ row, request, options }) {
  if (!row?.['@odata.etag']) throw new Error('Refusing: the reviewer row has no ETag.');
  if (!Object.hasOwn(row, 'wmkf_endedby')) throw new Error('Refusing: wmkf_endedby is not readable yet.');
  if (request?.wmkf_istestrequest !== true) {
    throw new Error('Refusing: the reviewer row does not belong to a marked test request.');
  }
  if (!options.some((option) => option.Value === DID_NOT_SUBMIT_REVIEW_STATUS_VALUE)) {
    throw new Error(`Refusing: review status ${DID_NOT_SUBMIT_REVIEW_STATUS_VALUE} (Did not submit) does not exist yet.`);
  }
  if (matches(row, TEST_VALUES)) {
    throw new Error('Refusing: the row already holds the test values, so a restore could not be told apart.');
  }
}

async function readRow(client, id) {
  const response = await client.get(`/${ENTITY_SET}(${id})?$select=${ROW_SELECT}`);
  if (!response.ok) throw new Error(`Reviewer row read failed (${response.status}): ${response.text.slice(0, 400)}`);
  return response.body;
}

function describe(values) {
  return `wmkf_endedby=${values.wmkf_endedby} wmkf_reviewstatus=${values.wmkf_reviewstatus}`;
}

export function recordPathFor(suggestionId) {
  return path.join('outputs', `roundtrip-reviewer-outcomes-${suggestionId}.json`);
}

export function assertAwayFromUtcMidnight(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  if (midnight - now.getTime() < MIDNIGHT_MARGIN_MS) {
    throw new Error('Refusing: less than 20 minutes to UTC midnight, when the write ACK expires. Run after midnight with a new ACK.');
  }
}

/**
 * The PATCH response row (return=representation) is the only version a
 * restore may be bound to. It must hold exactly the expected values on the
 * original request, with an ETag.
 */
export function assertWrittenRow(row, { requestId, values, label }) {
  if (!row?.['@odata.etag']) throw new Error(`${label}: the response carried no row version.`);
  if ((row._wmkf_request_value || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new Error(`${label}: the row no longer belongs to the original request.`);
  }
  if (!matches(row, values)) throw new Error(`${label}: the response row does not hold ${describe(values)}.`);
  return row;
}

/**
 * Explicit operator recovery: only while the row is still on the recorded
 * marked test request and still holds exactly the test values.
 */
export function planRecovery({ record, row, request }) {
  if ((row._wmkf_request_value || '').toLowerCase() !== record.requestId.toLowerCase()) {
    throw new Error('Refusing recovery: the row no longer belongs to the recorded request.');
  }
  if (request?.wmkf_istestrequest !== true) throw new Error('Refusing recovery: the request is not a marked test request.');
  if (matches(row, record.original)) return 'already-restored';
  if (!matches(row, TEST_VALUES)) {
    throw new Error(`Refusing recovery: the row holds neither the test nor the original values (${describe(originalValues(row))}).`);
  }
  return 'restore';
}

async function patchReturning(client, id, etag, values, label) {
  let response;
  try {
    response = await client.patch(`/${ENTITY_SET}(${id})?$select=${ROW_SELECT}`, values, {
      'If-Match': etag,
      Prefer: 'return=representation',
    });
  } catch (error) {
    throw Object.assign(new Error(`${label}: outcome unknown (${error.message}).`), { ambiguous: true });
  }
  if (response.status === 412) {
    throw new Error(`${label}: the row changed since its version was taken (412). Nothing was overwritten.`);
  }
  if (!response.ok) {
    // A 4xx (other than timeout/throttle) proves Dataverse refused the write;
    // a 5xx or gateway status can arrive after the write committed.
    const refused = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
    throw Object.assign(
      new Error(`${label} ${refused ? 'failed' : 'outcome unknown'} (${response.status}): ${response.text.slice(0, 400)}`),
      { ambiguous: !refused },
    );
  }
  return response.body;
}

async function freshClient(resourceUrl) {
  const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
  return createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
}

async function pauseForCheck(requestNumber) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question(
      `Check request ${requestNumber} in Review Manager now. Press Enter to restore (automatic after 10 minutes). `,
      { signal: AbortSignal.timeout(PAUSE_LIMIT_MS) },
    );
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
    console.log('\nPause limit reached; restoring.');
  } finally {
    prompt.close();
  }
}

async function readRequest(client, requestId) {
  const response = await client.get(`/akoya_requests(${requestId})?$select=akoya_requestnum,wmkf_istestrequest`);
  if (!response.ok) throw new Error(`Request read failed (${response.status}).`);
  return response.body;
}

export async function recover({ client, resourceUrl, suggestionId }) {
  const recordPath = recordPathFor(suggestionId);
  if (!fs.existsSync(recordPath)) throw new Error(`No recovery record at ${recordPath}.`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (record.suggestionId !== suggestionId || record.resourceUrl !== resourceUrl) {
    throw new Error('Refusing recovery: the record names a different row or target.');
  }
  const row = await readRow(client, suggestionId);
  const plan = planRecovery({ record, row, request: await readRequest(client, record.requestId) });
  if (plan === 'restore') {
    assertWrittenRow(
      await patchReturning(client, suggestionId, row['@odata.etag'], record.original, 'Recovery restore'),
      { requestId: record.requestId, values: record.original, label: 'Recovery restore' },
    );
  }
  fs.unlinkSync(recordPath);
  console.log(`${plan === 'restore' ? 'Restored' : 'Already restored'} and verified: ${describe(record.original)}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
  const { parseTargetArg, resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
  const target = parseTargetArg(process.argv);
  loadEnvLocal();
  const resourceUrl = resolveTargetResource({ target, write: args.execute || args.recover });
  console.log(`Target: ${target} (${resourceUrl})`);
  console.log(`Mode:   ${args.execute ? 'EXECUTE' : args.recover ? 'RECOVER' : 'PREVIEW (no writes)'}`);
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  if (args.recover) {
    await recover({ client, resourceUrl, suggestionId: args.suggestionId });
    return;
  }
  await runRoundTrip({
    client,
    makeRestoreClient: () => freshClient(resourceUrl),
    resourceUrl,
    suggestionId: args.suggestionId,
    execute: args.execute,
    pause: args.pause,
  });
}

export async function runRoundTrip({
  client, makeRestoreClient, resourceUrl, suggestionId, execute, pause,
  pauseFn = pauseForCheck, now = new Date(),
}) {
  const args = { suggestionId, execute, pause };
  const row = await readRow(client, args.suggestionId);
  const requestId = row._wmkf_request_value;
  if (!GUID_RE.test(requestId || '')) throw new Error('Refusing: the reviewer row has no request.');
  const request = await readRequest(client, requestId);
  const optionsResponse = await client.get(
    "/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')/Attributes(LogicalName='wmkf_reviewstatus')"
      + '/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet',
  );
  if (!optionsResponse.ok) throw new Error(`Review Status metadata read failed (${optionsResponse.status}).`);

  assertRoundTripAllowed({ row, request, options: optionsResponse.body?.OptionSet?.Options || [] });
  const original = originalValues(row);
  console.log(`Request ${request.akoya_requestnum} (marked test request)`);
  console.log(`Original:  ${describe(original)}`);
  console.log(`Test:      ${describe(TEST_VALUES)}`);
  if (!args.execute) {
    console.log('Preview only. Re-run with --execute to write the test values and restore them.');
    return;
  }

  assertAwayFromUtcMidnight(now);
  const recordPath = recordPathFor(args.suggestionId);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  try {
    // Exclusive create: a second run on the same row refuses instead of
    // sharing (and later deleting) this run's record.
    fs.writeFileSync(recordPath, `${JSON.stringify({
      resourceUrl, suggestionId: args.suggestionId, requestId, requestNumber: request.akoya_requestnum,
      original, originalEtag: row['@odata.etag'], startedAt: new Date().toISOString(),
    }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Refusing: another or unfinished run holds ${recordPath}. Run with --recover first.`);
  }
  const recoveryHint = `Recovery record: ${recordPath}. Run again with --recover (and a current ACK) to restore ${describe(original)}.`;

  let written;
  try {
    written = await patchReturning(client, args.suggestionId, row['@odata.etag'], TEST_VALUES, 'Test write');
  } catch (error) {
    if (!error.ambiguous) fs.unlinkSync(recordPath);
    throw new Error(error.ambiguous ? `${error.message} ${recoveryHint}` : error.message);
  }

  try {
    assertWrittenRow(written, { requestId, values: TEST_VALUES, label: 'Test write' });
  } catch (error) {
    // No trusted version (or a different request): never restore blind.
    throw new Error(`${error.message} ${recoveryHint}`);
  }
  console.log('Test values written and confirmed by the write response.');
  if (args.pause) {
    try {
      await pauseFn(request.akoya_requestnum);
    } catch (error) {
      console.error(`Pause ended early (${error.message}); restoring.`);
    }
  }

  try {
    const restoreClient = await makeRestoreClient();
    assertWrittenRow(
      await patchReturning(restoreClient, args.suggestionId, written['@odata.etag'], original, 'Restore'),
      { requestId, values: original, label: 'Restore' },
    );
  } catch (error) {
    throw new Error(`${error.message} ${recoveryHint}`);
  }
  fs.unlinkSync(recordPath);
  console.log(`Restored and verified: ${describe(original)}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
