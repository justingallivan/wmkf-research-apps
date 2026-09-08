#!/usr/bin/env node
/**
 * Add akoya_programid to the exact production akoya_request Quick Find view's
 * projected FetchXML attributes and rendered layout column.
 *
 * Dry-run is the default. The guarded apply path is prepared for a supported
 * metadata update, but production PATCH attempts are currently blocked by
 * Dataverse error 0x80040216; do not blindly retry until that platform error
 * is resolved. Every apply call is routed through lib/dataverse/client.js so
 * the target interlock guards the GET, PATCH, and PublishXml POST. The script
 * never adds a Quick Find search condition.
 *
 * Usage:
 *   node scripts/add-akoya-request-programid-quick-find-column.mjs
 *   node scripts/add-akoya-request-programid-quick-find-column.mjs --dry-run
 *   node scripts/add-akoya-request-programid-quick-find-column.mjs --apply
 *
 * Production apply additionally requires:
 *   DATAVERSE_TARGET_INTERLOCK=on
 *   DATAVERSE_ALLOW_PROD_READS=yes
 *   DATAVERSE_PROD_WRITE_ACK="<purpose> YYYY-MM-DD"  # today's UTC date
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  FIELD,
  planQuickFindViewUpdate,
  quickFindFieldPresent,
} from './lib/akoya-request-quick-find-view.mjs';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const solutionManifest = require('../lib/dataverse/schema/solution.json');

export const VIEW_ID = '08b51bf9-47c5-4ef5-a1a5-6af4713bca5b';
export const VIEW_NAME = 'Quick Find Active Requests';
export const VIEW_QUERY_TYPE = 4;
export const ENTITY = 'akoya_request';
export const SOLUTION_UNIQUE_NAME = solutionManifest.uniqueName;
const VIEW_PATH = `/savedqueries(${VIEW_ID})`;
const VIEW_SELECT = [
  'savedqueryid',
  'name',
  'returnedtypecode',
  'querytype',
  'isquickfindquery',
  'ismanaged',
  'iscustomizable',
  'fetchxml',
  'layoutxml',
].join(',');

function boolValue(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'Value')) return value.Value;
  return value;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function parseArgs(argv = process.argv) {
  const args = { apply: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  if (args.apply && args.dryRun) throw new Error('Choose either --apply or --dry-run, not both');
  return args;
}

export function parseDatedProdWriteAck(raw, date = todayUtc()) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(.*)\s+(\d{4}-\d{2}-\d{2})$/);
  if (!match || !match[1].trim() || match[2] !== date) return null;
  return { purpose: match[1].trim(), date: match[2] };
}

export function assertProductionResource(resourceUrl) {
  let parsed;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    throw new Error('DYNAMICS_URL must be a valid URL for the exact production hostname');
  }
  const authority = String(resourceUrl).match(/^https:\/\/([^/?#]*)/i)?.[1] || '';
  const hasExplicitPort = authority.includes(':');
  if (
    parsed.protocol !== 'https:'
    || !PRODUCTION_HOSTS.includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.port
    || hasExplicitPort
    || parsed.search
    || parsed.hash
    || !['', '/'].includes(parsed.pathname)
  ) {
    throw new Error(`Refusing: DYNAMICS_URL must be exactly https://${PRODUCTION_HOSTS[0]} with only an optional trailing slash`);
  }
  return `https://${PRODUCTION_HOSTS[0]}`;
}

export function assertApplyEnvironment({ apply, env = process.env, date = todayUtc() }) {
  if (env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes');
  }
  if (!apply) return;
  if (env.DATAVERSE_TARGET_INTERLOCK !== 'on') {
    throw new Error('Apply requires DATAVERSE_TARGET_INTERLOCK=on');
  }
  if (!parseDatedProdWriteAck(env.DATAVERSE_PROD_WRITE_ACK, date)) {
    throw new Error(`Apply requires DATAVERSE_PROD_WRITE_ACK with a nonempty purpose and today\'s UTC date (${date})`);
  }
}

export function validateTargetView(view) {
  if (!view || typeof view !== 'object') throw new Error('savedquery response is empty');
  if (String(view.savedqueryid || '').toLowerCase() !== VIEW_ID) {
    throw new Error(`Refusing: savedquery id is ${view.savedqueryid || 'missing'}, expected ${VIEW_ID}`);
  }
  if (view.name !== VIEW_NAME) throw new Error(`Refusing: view name is ${view.name || 'missing'}, expected ${VIEW_NAME}`);
  if (view.returnedtypecode !== ENTITY) throw new Error(`Refusing: view entity is ${view.returnedtypecode || 'missing'}, expected ${ENTITY}`);
  if (view.querytype !== VIEW_QUERY_TYPE) throw new Error(`Refusing: querytype is ${view.querytype}, expected ${VIEW_QUERY_TYPE}`);
  if (view.isquickfindquery !== true) throw new Error('Refusing: target is not marked as a Quick Find view');
  if (boolValue(view.ismanaged) !== true) throw new Error('Refusing: target view is not managed=true');
  if (boolValue(view.iscustomizable) !== true) throw new Error('Refusing: target view is not customizable=true');
  if (typeof view['@odata.etag'] !== 'string' || !view['@odata.etag'].trim()) {
    throw new Error('Refusing: target view has no current @odata.etag');
  }
  return view;
}

async function readTargetView(client) {
  const response = await client.get(`${VIEW_PATH}?$select=${VIEW_SELECT}`);
  if (!response.ok) throw new Error(`GET target Quick Find view failed (${response.status}): ${response.text}`);
  return validateTargetView(response.body);
}

function formatViewReadback(view) {
  return `fetchxml=${JSON.stringify(view.fetchxml)} layoutxml=${JSON.stringify(view.layoutxml)}`;
}

/** Re-read the exact savedquery after an uncertain transport outcome. */
export async function readExactViewReadback(client) {
  try {
    const view = await readTargetView(client);
    return formatViewReadback(view);
  } catch (error) {
    return `unavailable (${error.message})`;
  }
}

/**
 * Execute one mutation exactly once. A transport throw can happen after the
 * server committed the request, so never retry it; re-read the exact view and
 * surface the projection/layout state to the operator instead.
 */
export async function runUncertainDataverseMutation({ label, execute, readback }) {
  try {
    return await execute();
  } catch (error) {
    let state;
    try {
      state = await readback();
    } catch (readbackError) {
      state = `unavailable (${readbackError.message})`;
    }
    throw new Error(
      `PARTIAL/UNKNOWN OUTCOME: ${label} transport threw after an uncertain dispatch; `
      + `no retry attempted. Exact savedquery projection/layout readback: ${state}; `
      + `transport error: ${error.message}`,
    );
  }
}

async function unknownMutationResponse({ label, response, readback }) {
  let state;
  try {
    state = await readback();
  } catch (readbackError) {
    state = `unavailable (${readbackError.message})`;
  }
  throw new Error(
    `PARTIAL/UNKNOWN OUTCOME: ${label} returned non-OK HTTP ${response.status}; `
    + `no retry attempted. Exact savedquery projection/layout readback: ${state}; `
    + `response body: ${response.text}`,
  );
}

function publishBody() {
  return {
    ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>`,
  };
}

export async function applyViewPlan({ client, current, plan, readback = () => readExactViewReadback(client) }) {
  const patch = await runUncertainDataverseMutation({
    label: 'Quick Find view PATCH',
    readback,
    execute: () => client.raw('PATCH', VIEW_PATH, {
      fetchxml: plan.fetchxml,
      layoutxml: plan.layoutxml,
    }, { 'If-Match': current['@odata.etag'] }),
  });
  if (!patch.ok) await unknownMutationResponse({ label: 'Quick Find view PATCH', response: patch, readback });

  const publish = await runUncertainDataverseMutation({
    label: 'PublishXml for akoya_request',
    readback,
    execute: () => client.post('/PublishXml', publishBody()),
  });
  if (!publish.ok) {
    throw new Error(`PARTIAL STATE: view PATCH succeeded but PublishXml failed (${publish.status}): ${publish.text}; ${await readback()}`);
  }
  return { patch, publish };
}

async function run({ apply }) {
  loadEnvLocal();
  const resourceUrl = assertProductionResource(process.env.DYNAMICS_URL);
  assertApplyEnvironment({ apply });

  const token = await getAccessToken(resourceUrl);
  const client = createClient({
    resourceUrl,
    token,
    solutionUniqueName: SOLUTION_UNIQUE_NAME,
    dryRun: !apply,
  });
  const current = await readTargetView(client);
  const plan = planQuickFindViewUpdate(current);

  console.log(`Target: ${resourceUrl}`);
  console.log(`View: ${VIEW_NAME} (${VIEW_ID})`);
  console.log(`Field: ${FIELD}`);
  if (!plan.changed) {
    console.log('No change needed: field is already present once in both FetchXML projection and layout XML.');
    return;
  }
  console.log('Plan: add one FetchXML attribute and one layout cell; Quick Find conditions remain unchanged.');
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to PATCH with the current ETag, publish akoya_request, and verify readback.');
    return;
  }

  const { patch, publish } = await applyViewPlan({ client, current, plan });
  console.log(`PATCH succeeded (${patch.status}) with If-Match ${current['@odata.etag']}`);
  console.log(`PublishXml succeeded (${publish.status}) for ${ENTITY}`);

  const after = await readTargetView(client);
  const verified = planQuickFindViewUpdate(after);
  if (verified.changed || !quickFindFieldPresent(after)) {
    throw new Error('VERIFY FAILED: readback did not show exactly one projected attribute and one layout cell with no search condition');
  }
  console.log(`VERIFIED: ${FIELD} is present in the published Quick Find projection and layout.`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log('Usage: node scripts/add-akoya-request-programid-quick-find-column.mjs [--dry-run|--apply]');
    return;
  }
  await run({ apply: args.apply });
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exitCode = 1;
  });
}
