#!/usr/bin/env node

/**
 * Prepare and execute one bounded Test Request Factory rehearsal in the
 * registered Dataverse sandbox.
 *
 * Default mode is read-only. A live create requires a previously written,
 * unexpired manifest and a new receipt path:
 *
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs --prepare=/absolute/manifest.json --source-request-number=<actual-grant-request-number>
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs --prepare=/absolute/manifest.json --bundle=/absolute/source-bundle.json
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs --execute=/absolute/manifest.json --receipt=/absolute/receipt.json
 *
 * A v3 manifest clones a sandbox source Request (no files). A v4 manifest
 * clones a production source exported by scripts/export-test-request-source-bundle.mjs
 * and copies each bundle document into the new Request folder: destination
 * journaled in the receipt before each write, create-only with conflict
 * refusal, drive re-resolved on the registered site with eTag and SHA-256
 * re-verified, ambiguous outcomes recovered by exact item and never retried
 * (lib/services/test-requests/bundle-file-copy.js).
 *
 * The script never deletes or resets the created Request or copied files. An
 * ambiguous create is not retried: the preallocated GUID in the manifest is
 * the recovery key.
 *
 * Slice 5b (build order item 5) split the executeManifest step bodies into
 * lib/services/test-requests/basic-clone-steps.js and added a bounded,
 * ledger-driven runner (lib/services/test-requests/run-runner.js). This
 * script now has TWO ways to run a v4 (bundle) clone:
 *   - The original --prepare / --execute / --inspect file-receipt path
 *     (unchanged behavior, still supports v3 and v4 manifests).
 *   - A new --reserve / --advance / --run-inspect ledger-driven path (v4
 *     manifests only) that persists progress in Postgres so a bounded step
 *     can be resumed across separate invocations instead of one long-lived
 *     process.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import {
  expectedRequestFolder,
  requireUniqueSourceRequest,
  resolveCloneCycle,
} from '../lib/services/test-requests/sandbox-clone.js';
import {
  reserveRehearsalReceipt,
  updateRehearsalReceipt,
} from '../lib/services/test-requests/rehearsal-receipt.js';
import { readSourceBundle, summarizeSourceBundle } from '../lib/services/test-requests/source-bundle.js';
import {
  assertBundleFresh,
  copyBundleFiles,
  planBundleFileCopies,
  reconcileJournaledCopies,
} from '../lib/services/test-requests/bundle-file-copy.js';
import {
  READBACK_FIELDS,
  SANDBOX_URL,
  SOURCE_SELECT,
  bodyOrThrow,
  buildCloneManifest,
  bundleSourceOf,
  checkPreallocatedRequestAbsent,
  compileBody,
  correctMeetingDate,
  createRequestWithGoverifyBypass,
  fenceSource,
  getContactSnapshot,
  getEmails,
  getFoundationSnapshot,
  getLocations,
  getPayments,
  guidEqual,
  isBundleManifest,
  listSharePointFiles,
  observe,
  odataString,
  preflightSummary,
  provisionSharePointLocation,
  readRequestForCorrection,
  resolveLocationParents,
  reverifyClone,
  runPreflight,
  sanitizedRequestIdentity,
  sha256,
  validateCloneManifest,
  verifyClone,
} from '../lib/services/test-requests/basic-clone-steps.js';
import { advanceRun } from '../lib/services/test-requests/run-runner.js';
import { cliActorId, createRunLedger, idempotencyKeyDigest } from '../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../lib/services/test-requests/run-ledger-db.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const PRINCIPAL_ACTOR = /^(?:admin|user):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OS_USERNAME = /^[A-Za-z0-9._-]{1,64}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ledger stores only an authenticated principal GUID or the one-way
 * `cliActorId` digest of an OS username; free text never reaches it.
 */
function resolveActorId(actor) {
  if (actor == null) return cliActorId(os.userInfo().username);
  if (PRINCIPAL_ACTOR.test(actor)) return actor.toLowerCase();
  if (OS_USERNAME.test(actor)) return cliActorId(actor);
  throw new Error('--actor must be admin:<guid>, user:<guid>, or an OS username (stored as its cli:<16 hex> digest).');
}

function parseArgs(argv) {
  const parsed = {
    prepare: null,
    execute: null,
    inspect: null,
    receipt: null,
    bypassGoverify: false,
    fiscalYear: null,
    meetingDate: null,
    sourceRequestNumber: null,
    bundle: null,
    testLabel: null,
    reserve: false,
    manifestOut: null,
    idempotencyKey: null,
    actor: null,
    advance: null,
    manifest: null,
    steps: 1,
    runInspect: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--prepare=')) parsed.prepare = arg.slice('--prepare='.length);
    else if (arg.startsWith('--bundle=')) parsed.bundle = arg.slice('--bundle='.length);
    else if (arg.startsWith('--execute=')) parsed.execute = arg.slice('--execute='.length);
    else if (arg.startsWith('--inspect=')) parsed.inspect = arg.slice('--inspect='.length);
    else if (arg.startsWith('--receipt=')) parsed.receipt = arg.slice('--receipt='.length);
    else if (arg.startsWith('--fiscal-year=')) parsed.fiscalYear = arg.slice('--fiscal-year='.length);
    else if (arg.startsWith('--meeting-date=')) parsed.meetingDate = arg.slice('--meeting-date='.length);
    else if (arg.startsWith('--source-request-number=')) parsed.sourceRequestNumber = arg.slice('--source-request-number='.length);
    else if (arg.startsWith('--test-label=')) parsed.testLabel = arg.slice('--test-label='.length);
    else if (arg === '--bypass-goverify') parsed.bypassGoverify = true;
    else if (arg === '--reserve') parsed.reserve = true;
    else if (arg.startsWith('--manifest-out=')) parsed.manifestOut = arg.slice('--manifest-out='.length);
    else if (arg.startsWith('--idempotency-key=')) parsed.idempotencyKey = arg.slice('--idempotency-key='.length);
    else if (arg.startsWith('--actor=')) parsed.actor = arg.slice('--actor='.length);
    else if (arg.startsWith('--advance=')) parsed.advance = arg.slice('--advance='.length);
    else if (arg.startsWith('--manifest=')) parsed.manifest = arg.slice('--manifest='.length);
    else if (arg.startsWith('--steps=')) parsed.steps = Number(arg.slice('--steps='.length));
    else if (arg.startsWith('--run-inspect=')) parsed.runInspect = arg.slice('--run-inspect='.length);
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const modes = [parsed.prepare, parsed.execute, parsed.inspect, parsed.reserve ? '--reserve' : null, parsed.advance, parsed.runInspect];
  if (modes.filter(Boolean).length > 1) {
    throw new Error('Choose exactly one of --prepare, --execute, --inspect, --reserve, --advance, or --run-inspect.');
  }
  if (parsed.execute && !parsed.receipt) throw new Error('--execute requires --receipt.');
  if (!parsed.execute && !parsed.inspect && parsed.receipt) throw new Error('--receipt is valid only with --execute or --inspect.');
  if (parsed.bypassGoverify && !parsed.execute && !parsed.advance) {
    throw new Error('--bypass-goverify is valid only with --execute or --advance.');
  }
  // With --bundle the number is the operator's attestation of the authorized
  // production source; prepare/reserve refuse a bundle for any other Request.
  if ((parsed.prepare || parsed.reserve) && (!parsed.sourceRequestNumber || !/^\d{1,10}$/.test(parsed.sourceRequestNumber))) {
    throw new Error('--prepare/--reserve require a bounded numeric --source-request-number (with --bundle it must match the bundle source).');
  }
  if (!parsed.prepare && !parsed.reserve && (parsed.fiscalYear !== null || parsed.meetingDate !== null || parsed.sourceRequestNumber !== null || parsed.bundle !== null || parsed.testLabel !== null)) {
    throw new Error('--bundle, --source-request-number, --fiscal-year, --meeting-date, and --test-label are valid only with --prepare or --reserve.');
  }
  if (parsed.reserve && (!parsed.bundle || !parsed.manifestOut || !parsed.idempotencyKey)) {
    throw new Error('--reserve requires --bundle, --manifest-out, and --idempotency-key.');
  }
  if (parsed.reserve) {
    parsed.actorId = resolveActorId(parsed.actor);
    try {
      idempotencyKeyDigest(parsed.idempotencyKey);
    } catch {
      throw new Error('--idempotency-key must be 1-200 printable ASCII characters (no spaces); the ledger stores only its SHA-256.');
    }
  }
  for (const runId of [parsed.advance, parsed.runInspect].filter(Boolean)) {
    if (!RUN_ID.test(runId)) throw new Error('--advance/--run-inspect take a run ID GUID.');
  }
  if (parsed.advance && (!parsed.manifest || !parsed.bundle)) {
    throw new Error('--advance requires --manifest and --bundle.');
  }
  if (parsed.advance && (!Number.isInteger(parsed.steps) || parsed.steps < 1)) {
    throw new Error('--steps must be a positive integer.');
  }
  for (const value of [parsed.prepare, parsed.execute, parsed.inspect, parsed.receipt, parsed.bundle, parsed.manifestOut, parsed.manifest].filter(Boolean)) {
    if (!path.isAbsolute(value)) throw new Error('Manifest, receipt, and bundle paths must be absolute.');
  }
  return parsed;
}

function printHelp() {
  console.log('Read-only: node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs');
  console.log('Prepare:  ... --prepare=/absolute/new-manifest.json --source-request-number=<actual-grant-request-number> [--fiscal-year=...] [--meeting-date=...]');
  console.log('Prepare from a production source bundle (with file copy): ... --prepare=/absolute/new-manifest.json --bundle=/absolute/source-bundle.json --source-request-number=<authorized-source-number>');
  console.log('Inspect a bundle run with its receipt (read-only, verifies copied items by stable ID): ... --inspect=/absolute/manifest.json --receipt=/absolute/receipt.json');
  console.log('Replace the source-number placeholder with an actual sandbox Grant Request number.');
  console.log('Execute:  ... --execute=/absolute/manifest.json --receipt=/absolute/new-receipt.json');
  console.log('Execute with one-create sandbox bypass: ... --execute=... --receipt=... --bypass-goverify');
  console.log('Inspect:  ... --inspect=/absolute/manifest.json');
  console.log('Reserve a ledger-driven bundle run: ... --reserve --bundle=/absolute/source-bundle.json --source-request-number=<authorized-source-number> --manifest-out=/absolute/new-manifest.json --idempotency-key=<key> [--actor=<id>]');
  console.log('  --idempotency-key: 1-200 printable ASCII characters, no spaces; the ledger stores only its SHA-256.');
  console.log('  --actor: admin:<guid> or user:<guid>, or an OS username; a username (default: the current OS user) is stored only as cli:<16 hex digest>.');
  console.log('Advance a reserved run by bounded steps: ... --advance=<runId> --manifest=/absolute/manifest.json --bundle=/absolute/source-bundle.json [--steps=N] [--bypass-goverify]');
  console.log('Inspect a ledger run (read-only, no Dataverse): ... --run-inspect=<runId>');
  console.log('Ledger-driven modes require TEST_REQUEST_LEDGER_URL, which must not be the shared Production/Preview database.');
}

function writeNewJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Private, local, overwritable sidecar for a run's full error text -- the ledger itself never stores message text. */
function writeErrorSidecar(manifestPath, payload) {
  const sidecarPath = `${manifestPath}.error.json`;
  fs.writeFileSync(sidecarPath, `${JSON.stringify({ ...payload, recordedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

async function getSourceRequestByNumber(client, requestNumber) {
  if (!/^\d{1,10}$/.test(String(requestNumber))) throw new Error('Source Request number must be bounded digits.');
  const filter = `akoya_requestnum eq '${odataString(requestNumber)}'`;
  const response = await client.get(
    `/akoya_requests?$select=${SOURCE_SELECT}&$filter=${encodeURIComponent(filter)}&$top=2`,
  );
  const body = bodyOrThrow('source Request lookup', response);
  try {
    return requireUniqueSourceRequest(body.value || [], Boolean(body['@odata.nextLink']));
  } catch (error) {
    throw new Error(`Source Request ${requestNumber}: ${error.message}`);
  }
}

/** Build the injected GraphService-shaped object and SharePoint target getter once per process. */
async function buildGraphContext() {
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { configuredSharePointTargetInfo } = await import('../lib/services/sharepoint-target-registry.js');
  const graph = {
    getSiteId: () => GraphService.getSiteId(),
    getDriveId: (library, options) => GraphService.getDriveId(library, options),
    ensureFolderPath: (library, folder, options) => GraphService.ensureFolderPath(library, folder, options),
    listFiles: (parentRelativeUrl, locationRelativeUrl, options) => GraphService.listFiles(parentRelativeUrl, locationRelativeUrl, options),
    getFileMetadataById: (driveId, itemId) => GraphService.getFileMetadataById(driveId, itemId),
    downloadFile: (driveId, itemId) => GraphService.downloadFile(driveId, itemId),
    getFileMetadataByPath: (library, folder, filename, options) => GraphService.getFileMetadataByPath(library, folder, filename, options),
    uploadFile: (library, folder, filename, content, contentType, options) => (
      GraphService.uploadFile(library, folder, filename, content, contentType, options)
    ),
    clearGraphCaches: () => GraphService.clearCaches(),
    configuredSharePointTarget: () => configuredSharePointTargetInfo(),
  };
  const sharePointTarget = () => configuredSharePointTargetInfo();
  return { graph, sharePointTarget };
}

async function copyBundleDocuments(manifest, request, requestFolder, preflight, receipt, receiptPath) {
  const { bundle } = bundleSourceOf(manifest);
  if (!request.akoya_requestnum) throw new Error('Destination request number is missing; cannot resolve file destinations.');
  // Numbered destinations resolve only now that the server assigned the number.
  const plannedFiles = planBundleFileCopies(bundle, { destinationRequestNumber: request.akoya_requestnum });
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { configuredSharePointTargetInfo } = await import('../lib/services/sharepoint-target-registry.js');
  receipt.fileCopyStartedAt = new Date().toISOString();
  receipt.fileCopies = [];
  updateRehearsalReceipt(receiptPath, receipt);
  const copies = await copyBundleFiles({
    plannedFiles,
    requestFolder,
    expectedSiteId: preflight.siteId,
    expectedDestinationDriveId: preflight.driveId,
  }, {
    clearGraphCaches: () => GraphService.clearCaches(),
    configuredSharePointTarget: () => configuredSharePointTargetInfo(),
    getSiteId: () => GraphService.getSiteId(),
    getDriveId: (library, options) => GraphService.getDriveId(library, options),
    getFileMetadataById: (driveId, itemId) => GraphService.getFileMetadataById(driveId, itemId),
    downloadFile: (driveId, itemId) => GraphService.downloadFile(driveId, itemId),
    getFileMetadataByPath: (library, folder, filename, options) => (
      GraphService.getFileMetadataByPath(library, folder, filename, options)
    ),
    ensureFolderPath: (library, folder, options) => GraphService.ensureFolderPath(library, folder, options),
    uploadFile: (library, folder, filename, content, contentType, options) => (
      GraphService.uploadFile(library, folder, filename, content, contentType, options)
    ),
  }, (journal) => {
    // Durable before every Graph write; a failure here stops the copy.
    receipt.fileCopies = journal;
    updateRehearsalReceipt(receiptPath, receipt);
  });
  receipt.fileCopyCompletedAt = new Date().toISOString();
  updateRehearsalReceipt(receiptPath, receipt);
  return copies;
}

async function inspectManifest(client, manifest, receipt = null) {
  validateCloneManifest(manifest, { allowExpired: true });
  if (receipt && !guidEqual(receipt.requestId, manifest.values.requestId)) {
    throw new Error('Receipt does not belong to this manifest.');
  }
  const { graph } = await buildGraphContext();
  const response = await client.get(
    `/akoya_requests(${manifest.values.requestId})?$select=${READBACK_FIELDS.join(',')}`,
  );
  const request = response.status === 404 ? null : bodyOrThrow('recovery Request readback', response);
  const [locations, payments, emails, foundation, contacts] = await Promise.all([
    getLocations(client, manifest.values.requestId),
    getPayments(client, manifest.values.requestId),
    getEmails(client, manifest.values.requestId),
    getFoundationSnapshot(client),
    getContactSnapshot(client, manifest.expectedOrganization.accountid),
  ]);
  const locationParents = await resolveLocationParents(client, locations);
  const expectedFolder = request?.akoya_requestnum
    ? expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid)
    : null;
  // Bundle manifests copy files, so recovery also lists the exact folder
  // (read-only) to show which planned destinations already exist.
  let sharePointFiles = null;
  let sharePointFilesError = null;
  let journaledCopies = null;
  if (isBundleManifest(manifest) && expectedFolder) {
    try {
      sharePointFiles = await listSharePointFiles(graph, { locations, locationParents });
    } catch (error) {
      sharePointFilesError = error.message;
    }
  }
  if (isBundleManifest(manifest) && Array.isArray(receipt?.fileCopies)) {
    // Receipt-bound recovery: verify each journaled stable item ID by
    // metadata, size and SHA-256 without any write.
    journaledCopies = await reconcileJournaledCopies(receipt.fileCopies, {
      getFileMetadataById: (driveId, itemId) => graph.getFileMetadataById(driveId, itemId),
      downloadFile: (driveId, itemId) => graph.downloadFile(driveId, itemId),
    });
  }
  console.log(JSON.stringify({
    mode: 'READ_ONLY_RECOVERY_INSPECTION',
    target: SANDBOX_URL,
    requestId: manifest.values.requestId,
    requestExists: Boolean(request),
    request: sanitizedRequestIdentity(request),
    expectedSharePointFolder: expectedFolder,
    expectedSharePointFiles: manifest.invariants?.expectedSharePointFiles ?? 0,
    plannedFiles: isBundleManifest(manifest)
      ? manifest.plannedFiles.map((file) => ({ kind: file.kind, destination: file.destination, sourceName: file.source.name }))
      : null,
    sharePointFiles,
    sharePointFilesError,
    journaledCopies,
    expectedLocationId: manifest.values.locationId || null,
    folderRecoveryHint: expectedFolder && locations.length === 0
      ? 'If the location is absent, inspect this deterministic folder path before creating anything.'
      : null,
    dynamicsLocations: locations,
    locationParents,
    paymentRows: payments,
    regardingEmails: emails,
    foundation: {
      accountid: foundation.accountid,
      name: foundation.name,
      modifiedon: foundation.modifiedon,
      versionnumber: foundation.versionnumber,
    },
    childContacts: contacts,
  }, null, 2));
}

async function executeManifest(client, manifest, receiptPath, { bypassGoverify = false } = {}) {
  validateCloneManifest(manifest, { forExecute: true });
  const receipt = {
    kind: 'test-request-sandbox-rehearsal-receipt/v1',
    startedAt: new Date().toISOString(),
    target: SANDBOX_URL,
    requestId: manifest.values.requestId,
    locationId: manifest.values.locationId,
    runId: manifest.values.runId,
    sourceRequestId: manifest.source?.requestId || null,
    sourceRevision: manifest.source?.revision || null,
    createAttempted: false,
    createResponseStatus: null,
  };
  // Reserve the private receipt path before any request-side write. The open
  // descriptor also lets every later success/failure outcome retain exact IDs.
  reserveRehearsalReceipt(receiptPath, receipt);
  const { graph, sharePointTarget } = await buildGraphContext();

  const journalCreate = async (patch) => {
    if (patch.goverifyBypass) receipt.goverifyBypass = patch.goverifyBypass;
    for (const key of ['createAttempted', 'createAttemptedAt', 'createResponseStatus', 'createResponseReceivedAt', 'postCreateStepsSkipped', 'postCreateStepsSkippedReason']) {
      if (key in patch) receipt[key] = patch[key];
    }
    updateRehearsalReceipt(receiptPath, receipt);
  };
  const journalMeetingDate = async (patch) => {
    receipt.meetingDateCorrection = patch;
    updateRehearsalReceipt(receiptPath, receipt);
  };
  const journalLocation = async (patch) => {
    receipt.locationProvision = patch;
    updateRehearsalReceipt(receiptPath, receipt);
  };

  try {
    const preflightBefore = await runPreflight(client, graph, sharePointTarget);
    if (!guidEqual(preflightBefore.foundation.accountid, manifest.expectedOrganization.accountid)) {
      throw new Error('Foundation account identity changed since prepare.');
    }
    if (preflightBefore.grantOption.value !== manifest.expectedRequestType.value) {
      throw new Error('Grant request-type option changed since prepare.');
    }
    if (!guidEqual(preflightBefore.appUser.systemuserid, manifest.expectedAppUserId)) {
      throw new Error('App-suite application user changed since prepare.');
    }
    if (isBundleManifest(manifest) && (preflightBefore.siteId !== manifest.expectedGraphSiteId
        || preflightBefore.driveId !== manifest.expectedGraphDriveId)) {
      throw new Error('Graph site or Request drive identity changed since prepare.');
    }
    const source = await fenceSource(client, manifest, preflightBefore.grantOption.value);
    const rebuiltBody = compileBody(preflightBefore, manifest.values, source);
    if (sha256(rebuiltBody) !== manifest.createBodySha256) throw new Error('Fresh preflight does not reproduce manifest body.');

    await checkPreallocatedRequestAbsent(client, manifest.values.requestId);

    await createRequestWithGoverifyBypass({
      client, manifest, preflightBefore, bypassGoverify, journal: journalCreate,
    });

    const createdRequest = await readRequestForCorrection(client, manifest.values.requestId);
    const datedRequest = await correctMeetingDate(client, manifest, createdRequest, journalMeetingDate);
    const location = await provisionSharePointLocation(client, graph, sharePointTarget, manifest, datedRequest, journalLocation);
    if (isBundleManifest(manifest)) {
      await copyBundleDocuments(manifest, datedRequest, location.folder, preflightBefore, receipt, receiptPath);
    }

    receipt.observationStartedAt = new Date().toISOString();
    updateRehearsalReceipt(receiptPath, receipt);
    const observation = await observe(client, manifest.values.requestId);
    let files = null;
    let graphError = null;
    try {
      files = await listSharePointFiles(graph, observation);
    } catch (error) {
      graphError = error.message;
    }
    const [foundationAfter, contactsAfter] = await Promise.all([
      getFoundationSnapshot(client),
      getContactSnapshot(client, manifest.expectedOrganization.accountid),
    ]);
    const verification = verifyClone(
      manifest,
      preflightBefore,
      observation,
      files,
      foundationAfter,
      contactsAfter,
      isBundleManifest(manifest) ? receipt.fileCopies || [] : null,
    );
    try {
      await fenceSource(client, manifest, preflightBefore.grantOption.value);
    } catch {
      verification.ok = false;
      verification.failures.push('source changed during clone rehearsal');
    }
    if (graphError) {
      verification.ok = false;
      verification.failures.push(`Graph folder inspection failed: ${graphError}`);
    }
    if (isBundleManifest(manifest)) {
      // Final manifest-authoritative byte check by stable ID, after the
      // observation window, so a later same-size overwrite cannot pass.
      const reverifyFailures = await reverifyClone(graph, receipt.fileCopies || []);
      receipt.fileCopyFinalVerification = { checkedAt: new Date().toISOString(), failures: reverifyFailures };
      if (reverifyFailures.length) {
        verification.ok = false;
        verification.failures.push(...reverifyFailures.map((failure) => `final file check: ${failure}`));
      }
    }

    Object.assign(receipt, {
      completedAt: new Date().toISOString(),
      request: sanitizedRequestIdentity(observation.request),
      dynamicsLocations: observation.locations,
      locationParents: observation.locationParents,
      sharePointFiles: files,
      paymentRows: observation.payments,
      regardingEmails: observation.emails,
      verification,
    });
    updateRehearsalReceipt(receiptPath, receipt);
    console.log(JSON.stringify({ receiptPath, requestNumber: observation.request.akoya_requestnum, verification }, null, 2));
    if (!verification.ok) process.exitCode = 1;
  } catch (error) {
    receipt.completedAt = new Date().toISOString();
    receipt.error = error.message;
    if (receipt.createAttempted && !receipt.postCreateStepsSkipped) {
      receipt.postCreateStepsSkipped = true;
      receipt.postCreateStepsSkippedReason = receipt.createResponseReceivedAt
        ? 'A post-create step failed; inspect the exact destination IDs before continuing.'
        : 'The Request create outcome is ambiguous; inspect the preallocated Request GUID before continuing.';
    }
    updateRehearsalReceipt(receiptPath, receipt);
    throw error;
  }
}

/** Refuse to run a ledger-driven mode against an unset or shared-production ledger URL. */
function requireLedgerUrl() {
  const url = process.env.TEST_REQUEST_LEDGER_URL;
  if (!url) {
    throw new Error('TEST_REQUEST_LEDGER_URL is required for ledger-driven modes (--reserve, --advance, --run-inspect).');
  }
  const sharedUrls = ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'DATABASE_URL']
    .map((name) => process.env[name]).filter(Boolean);
  if (sharedUrls.includes(url) || /neon\.tech/i.test(url)) {
    throw new Error('TEST_REQUEST_LEDGER_URL must not be the shared Production/Preview database.');
  }
  return url;
}

async function runReserve(client, args, ledgerUrl) {
  const { graph, sharePointTarget } = await buildGraphContext();
  const preflight = await runPreflight(client, graph, sharePointTarget);
  const bundle = readSourceBundle(readJson(args.bundle));
  const source = bundle.source.request;
  if (source.akoya_requestnum !== args.sourceRequestNumber) {
    throw new Error(`Bundle source is Request ${source.akoya_requestnum}; --source-request-number attests ${args.sourceRequestNumber}. Refusing.`);
  }
  assertBundleFresh(bundle);
  if (source.akoya_requesttype !== preflight.grantOption.value) {
    throw new Error('Source Request must be a Grant Request matching the live Grant option.');
  }
  const cycle = resolveCloneCycle(source, args);
  const manifest = buildCloneManifest(preflight, { ...cycle, source, testLabel: args.testLabel, bundle });
  if (!isBundleManifest(manifest)) throw new Error('The bounded ledger-driven runner only supports bundle (v4) manifests.');

  const { actorId } = args;
  // The plan digest binds the ledger-relevant identities/hashes, never
  // purpose text or the create body itself.
  const planDigest = sha256({
    runId: manifest.values.runId,
    destinationRequestId: manifest.values.requestId,
    destinationLocationId: manifest.values.locationId,
    sourceRequestId: manifest.source.requestId,
    sourceRevision: manifest.source.revision,
    bundleSha256: manifest.source.bundleSha256,
    copyPolicyDigest: manifest.copyPolicy.digest,
    createBodySha256: manifest.createBodySha256,
  });
  const plan = {
    runId: manifest.values.runId,
    recipe: 'basic',
    sourceDataverseHost: bundle.source.dataverseHost,
    sourceRequestId: manifest.source.requestId,
    sourceRequestNumber: manifest.source.requestNumber,
    sourceRevision: manifest.source.revision,
    bundleSha256: manifest.source.bundleSha256,
    bundleExportedAt: manifest.source.exportedAt,
    copyPolicyVersion: manifest.copyPolicy.version,
    copyPolicyDigest: manifest.copyPolicy.digest,
    planDigest,
    createBodySha256: manifest.createBodySha256,
    destinationEnvironment: 'sandbox',
    destinationDataverseHost: new URL(SANDBOX_URL).hostname,
    destinationRequestId: manifest.values.requestId,
    destinationLocationId: manifest.values.locationId,
    expectedAppUserId: manifest.expectedAppUserId,
    expectedOrganizationId: manifest.expectedOrganization.accountid,
    expectedGraphSiteId: manifest.expectedGraphSiteId,
    expectedGraphDriveId: manifest.expectedGraphDriveId,
    fiscalYear: cycle.fiscalYear,
    meetingDate: cycle.meetingDate,
    testLabel: manifest.values.testLabel,
  };
  // Write the private manifest (exclusive create, 0600) BEFORE reserving, so
  // a reserved run can never exist without the manifest that holds its
  // destination GUIDs. A failed reservation leaves an unreserved manifest.
  writeNewJson(args.manifestOut, manifest);
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    let reserved;
    try {
      reserved = await ledger.reserveRun({ actorId, idempotencyKey: args.idempotencyKey, plan });
    } catch (error) {
      error.message += ` (the manifest at ${args.manifestOut} was NOT reserved; delete it)`;
      throw error;
    }
    const { run, created } = reserved;
    console.log(JSON.stringify({
      mode: created ? 'RESERVED' : 'ALREADY_RESERVED',
      runId: run.runId,
      manifestPath: args.manifestOut,
      destinationRequestId: run.destinationRequestId,
      destinationLocationId: run.destinationLocationId,
      status: run.status,
      currentStep: run.currentStep,
    }, null, 2));
  } finally {
    await db.end();
  }
}

async function runAdvance(client, args, ledgerUrl) {
  const manifest = readJson(args.manifest);
  const bundle = readSourceBundle(readJson(args.bundle));
  const { graph, sharePointTarget } = await buildGraphContext();
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    for (let i = 0; i < args.steps; i += 1) {
      const result = await advanceRun({
        runId: args.advance,
        ledger,
        manifest,
        bundle,
        deps: { client, graph, sharePointTarget },
        options: { bypassGoverify: args.bypassGoverify, leaseSeconds: 300 },
      });
      // The ledger never stores message text (only a lowercase code); the
      // full error, if any, is surfaced here and in a private sidecar file
      // next to the manifest, never written to Postgres.
      if (result.errorMessage) {
        writeErrorSidecar(args.manifest, { runId: args.advance, step: result.step, errorMessage: result.errorMessage });
      }
      console.log(JSON.stringify({
        mode: 'ADVANCED',
        runId: args.advance,
        step: result.step,
        outcome: result.outcome,
        status: result.run?.status ?? null,
        destinationRequestNumber: result.run?.destinationRequestNumber ?? null,
        errorMessage: result.errorMessage ?? null,
      }, null, 2));
      if (result.outcome !== 'advanced') break;
    }
  } finally {
    await db.end();
  }
}

async function runRunInspect(runInspect, ledgerUrl) {
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    const run = await ledger.getRun(runInspect);
    if (!run) throw new Error(`No test request run found for ${runInspect}.`);
    const resources = await ledger.listRunResources(runInspect);
    console.log(JSON.stringify({ mode: 'READ_ONLY_RUN_INSPECT', run, resources }, null, 2));
  } finally {
    await db.end();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  loadEnvLocal();

  if (args.runInspect) {
    const ledgerUrl = requireLedgerUrl();
    await runRunInspect(args.runInspect, ledgerUrl);
    return;
  }

  if (process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_URL) {
    throw new Error(`DYNAMICS_SANDBOX_URL must equal the registered sandbox ${SANDBOX_URL}.`);
  }
  const client = createClient({
    resourceUrl: SANDBOX_URL,
    token: await getAccessToken(SANDBOX_URL),
    // The factory CLI is the one sanctioned writer of the Test Request marker.
    allowTestRequestMarkerWrites: true,
  });

  if (args.execute) {
    await executeManifest(client, readJson(args.execute), args.receipt, {
      bypassGoverify: args.bypassGoverify,
    });
    return;
  }
  if (args.inspect) {
    await inspectManifest(client, readJson(args.inspect), args.receipt ? readJson(args.receipt) : null);
    return;
  }
  if (args.reserve) {
    const ledgerUrl = requireLedgerUrl();
    await runReserve(client, args, ledgerUrl);
    return;
  }
  if (args.advance) {
    const ledgerUrl = requireLedgerUrl();
    await runAdvance(client, args, ledgerUrl);
    return;
  }

  const { graph, sharePointTarget } = await buildGraphContext();
  const preflight = await runPreflight(client, graph, sharePointTarget);
  if (args.prepare) {
    let source;
    let bundle = null;
    if (args.bundle) {
      bundle = readSourceBundle(readJson(args.bundle));
      source = bundle.source.request;
      if (source.akoya_requestnum !== args.sourceRequestNumber) {
        throw new Error(`Bundle source is Request ${source.akoya_requestnum}; --source-request-number attests ${args.sourceRequestNumber}. Refusing.`);
      }
      assertBundleFresh(bundle);
    } else {
      source = await getSourceRequestByNumber(client, args.sourceRequestNumber);
    }
    if (source.akoya_requesttype !== preflight.grantOption.value) {
      throw new Error('Source Request must be a Grant Request matching the live Grant option.');
    }
    const cycle = resolveCloneCycle(source, args);
    const manifest = buildCloneManifest(preflight, { ...cycle, source, testLabel: args.testLabel, bundle });
    writeNewJson(args.prepare, manifest);
    console.log(JSON.stringify({
      manifestPath: args.prepare,
      requestId: manifest.values.requestId,
      runId: manifest.values.runId,
      createBodySha256: manifest.createBodySha256,
      ...(bundle ? {
        bundle: summarizeSourceBundle(bundle),
        plannedFiles: manifest.plannedFiles.map((file) => ({ kind: file.kind, sourceName: file.source.name, destination: file.destination })),
      } : {}),
      preflight: preflightSummary(preflight),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({ mode: 'READ_ONLY_PREFLIGHT', preflight: preflightSummary(preflight) }, null, 2));
}

main().catch((error) => {
  console.error(`FATAL: ${error.message}`);
  process.exit(1);
});
