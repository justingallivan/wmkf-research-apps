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
 * - every write is bound to the row's current ETag (If-Match). If anything
 *   else changes the row between steps, the script stops and prints the
 *   original values instead of overwriting.
 *
 * Usage:
 *   node scripts/roundtrip-reviewer-outcomes-test-row.mjs --target=sandbox --suggestion=<guid>
 *   DATAVERSE_PROD_WRITE_ACK="outcomes round trip $(date -u +%F)" \
 *     node scripts/roundtrip-reviewer-outcomes-test-row.mjs --target=prod --suggestion=<guid> --execute [--pause]
 *
 * Without --execute it only reads and prints what it would write. Production
 * runs need DATAVERSE_TARGET_INTERLOCK=on and DATAVERSE_ALLOW_PROD_READS=yes;
 * --execute also needs a same-UTC-day DATAVERSE_PROD_WRITE_ACK
 * (scripts/lib/dataverse-script-target.cjs). Dataverse auditing records both
 * writes on the test row.
 */

import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import {
  ENDED_BY_VALUES, DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
} from '../shared/config/reviewerOutcome.js';

const require = createRequire(import.meta.url);

const ENTITY_SET = 'wmkf_appreviewersuggestions';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_SELECT = 'wmkf_appreviewersuggestionid,wmkf_reviewstatus,wmkf_endedby,_wmkf_request_value';
const TEST_VALUES = Object.freeze({
  wmkf_endedby: ENDED_BY_VALUES.foundation,
  wmkf_reviewstatus: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
});

export function parseArgs(argv) {
  const args = { execute: false, pause: false, suggestionId: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--execute') args.execute = true;
    else if (arg === '--pause') args.pause = true;
    else if (arg.startsWith('--suggestion=')) args.suggestionId = arg.slice('--suggestion='.length).toLowerCase();
    else if (!arg.startsWith('--target=')) throw new Error(`Unknown flag: ${arg}`);
  }
  if (!GUID_RE.test(args.suggestionId || '')) throw new Error('Pass --suggestion=<reviewer suggestion GUID>.');
  if (args.pause && !args.execute) throw new Error('--pause only applies with --execute.');
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

async function patchBound(client, id, etag, values, label) {
  const response = await client.patch(`/${ENTITY_SET}(${id})`, values, { 'If-Match': etag });
  if (response.status === 412) {
    throw new Error(`${label}: the row changed since it was read (412). Nothing was overwritten.`);
  }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${response.text.slice(0, 400)}`);
}

function describe(values) {
  return `wmkf_endedby=${values.wmkf_endedby} wmkf_reviewstatus=${values.wmkf_reviewstatus}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
  const { parseTargetArg, resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
  const target = parseTargetArg(process.argv);
  loadEnvLocal();
  const resourceUrl = resolveTargetResource({ target, write: args.execute });
  console.log(`Target: ${target} (${resourceUrl})`);
  console.log(`Mode:   ${args.execute ? 'EXECUTE' : 'PREVIEW (no writes)'}`);
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });

  const row = await readRow(client, args.suggestionId);
  const requestId = row._wmkf_request_value;
  if (!GUID_RE.test(requestId || '')) throw new Error('Refusing: the reviewer row has no request.');
  const requestResponse = await client.get(`/akoya_requests(${requestId})?$select=akoya_requestnum,wmkf_istestrequest`);
  if (!requestResponse.ok) throw new Error(`Request read failed (${requestResponse.status}).`);
  const optionsResponse = await client.get(
    "/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')/Attributes(LogicalName='wmkf_reviewstatus')"
      + '/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet',
  );
  if (!optionsResponse.ok) throw new Error(`Review Status metadata read failed (${optionsResponse.status}).`);

  assertRoundTripAllowed({
    row,
    request: requestResponse.body,
    options: optionsResponse.body?.OptionSet?.Options || [],
  });
  const original = originalValues(row);
  console.log(`Request ${requestResponse.body.akoya_requestnum} (marked test request)`);
  console.log(`Original:  ${describe(original)}`);
  console.log(`Test:      ${describe(TEST_VALUES)}`);
  if (!args.execute) {
    console.log('Preview only. Re-run with --execute to write the test values and restore them.');
    return;
  }

  await patchBound(client, args.suggestionId, row['@odata.etag'], TEST_VALUES, 'Test write');
  const written = await readRow(client, args.suggestionId);
  if (!matches(written, TEST_VALUES)) {
    throw new Error(`Test write did not read back (${describe(originalValues(written))}). Restore by hand to: ${describe(original)}`);
  }
  console.log('Test values written and read back.');

  if (args.pause) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question(`Check request ${requestResponse.body.akoya_requestnum} in Review Manager now. Press Enter to restore. `);
    prompt.close();
  }

  try {
    await patchBound(client, args.suggestionId, written['@odata.etag'], original, 'Restore');
  } catch (error) {
    throw new Error(`${error.message} Restore by hand to: ${describe(original)}`);
  }
  const restored = await readRow(client, args.suggestionId);
  if (!matches(restored, original)) {
    throw new Error(`Restore did not read back (${describe(originalValues(restored))}). Restore by hand to: ${describe(original)}`);
  }
  console.log(`Restored and verified: ${describe(original)}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
