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

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
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
import {
  readSourceBundle,
  summarizeSourceBundle,
  assertBundleHasPreSiteSectionForRecipe,
  assertBundleHasReviewerSectionForRecipe,
} from '../lib/services/test-requests/source-bundle.js';
import {
  assertBundleFresh,
  copyBundleFiles,
  planBundleFileCopies,
  reconcileJournaledCopies,
} from '../lib/services/test-requests/bundle-file-copy.js';
import {
  READBACK_FIELDS,
  SANDBOX_URL,
  TARGET_URLS,
  resolveProgramDirector,
  targetEnvironmentOf,
  targetHostOf,
  SOURCE_SELECT,
  bodyOrThrow,
  buildCloneManifest,
  bundleSourceOf,
  checkPreallocatedRequestAbsent,
  compileBody,
  computeRunPlanDigest,
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
import { advanceRun, recipeLeaseSeconds, RECIPE_STEP_ORDER } from '../lib/services/test-requests/run-runner.js';
import { recheckFoundationTransition } from '../lib/services/test-requests/foundation-transition.js';
import { fieldFor, recheckStatusChange, runStatusChange } from '../lib/services/test-requests/status-change-runner.js';
import { CAST_DEFAULT_NAMES, CAST_ROLE_ORDER, planCastAddresses, readCast, runCastCreate } from '../lib/services/test-requests/cast-runner.js';
import { runCastBinding } from '../lib/services/test-requests/cast-binding-runner.js';
import { TEST_REQUEST_EMAIL_ALLOWLIST_KEY, parseAllowlistValue } from '../lib/services/test-requests/email-allowlist.js';
import * as odata from '../lib/dataverse/core/odata.js';
import { recipeSeedsPreSite, recipeSeedsReviewers } from '../lib/services/test-requests/recipe-capabilities.js';
import {
  LEDGER_RECIPES, cliActorId, createRunLedger, idempotencyKeyDigest, reviewerAddressSha256,
} from '../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../lib/services/test-requests/run-ledger-db.js';
import { createReviewsSandboxDeps } from '../lib/services/test-requests/reviews-sandbox-deps.js';
import { validateReviewFilePlan } from '../lib/services/test-requests/review-file-copy.js';
import { syntheticPersonProjection } from '../lib/services/reviewer-engagement/seed-synthetic-review.js';
import { syntheticReviewerIsolationEnabled, SYNTHETIC_REVIEWER_MARKER_FIELDS } from '../lib/services/test-requests/isolation.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const PRINCIPAL_ACTOR = /^(?:admin|user):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OS_USERNAME = /^[A-Za-z0-9._-]{1,64}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ledger stores only an authenticated principal GUID or the one-way
 * `cliActorId` digest of an OS username; free text never reaches it.
 */
const DEFAULT_REVIEWER_ADDRESS_ENV = 'TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS';

/**
 * The default address for one source reviewer: the base inbox's local part
 * plus-tagged with the first 12 hex of SHA-256(lowercase source GUID). Stable
 * per source reviewer, so re-cloning a source reuses its synthetic person, and
 * distinct across sources, so the one-source-per-address provenance rule
 * holds. A base that already carries a plus tag is refused.
 */
export function defaultReviewerAddressFor(base, sourcePersonId) {
  let normalized;
  try {
    ({ address: normalized } = reviewerAddressSha256(base));
  } catch {
    throw new Error(`${DEFAULT_REVIEWER_ADDRESS_ENV} is not a plausible email address.`);
  }
  const at = normalized.lastIndexOf('@');
  const local = normalized.slice(0, at);
  if (local.includes('+')) throw new Error(`${DEFAULT_REVIEWER_ADDRESS_ENV} must not already carry a plus tag.`);
  const tag = crypto.createHash('sha256').update(String(sourcePersonId).toLowerCase()).digest('hex').slice(0, 12);
  const address = `${local}+${tag}${normalized.slice(at)}`;
  try {
    reviewerAddressSha256(address);
  } catch {
    throw new Error(`${DEFAULT_REVIEWER_ADDRESS_ENV}'s local part is too long for a plus tag (64 characters at most, including +<12 hex>).`);
  }
  return address;
}

/**
 * Owner decision 2026-09-26 (S544): no minted addresses; a reviewer with no
 * flag gets the owner-supplied default base inbox, plus-tagged per source
 * reviewer. Called by main() AFTER loadEnvLocal() (the value normally lives in
 * .env.local) and before any Dataverse read, so a bad value fails fast.
 */
export function applyDefaultReviewerAddress(args, env = process.env) {
  if (!args.reserve || !recipeSeedsReviewers(args.recipe)) return;
  const base = env[DEFAULT_REVIEWER_ADDRESS_ENV];
  if (base) {
    defaultReviewerAddressFor(base, '00000000-0000-4000-8000-000000000000');
    args.defaultReviewerAddress = base;
  } else if (args.reviewerAddress.length === 0) {
    throw new Error(`--reserve --recipe=reviews requires at least one --reviewer-address=<sourcePersonGuid>=<address> or ${DEFAULT_REVIEWER_ADDRESS_ENV}.`);
  }
}

function resolveActorId(actor) {
  if (actor == null) return cliActorId(os.userInfo().username);
  if (PRINCIPAL_ACTOR.test(actor)) return actor.toLowerCase();
  if (OS_USERNAME.test(actor)) return cliActorId(actor);
  throw new Error('--actor must be admin:<guid>, user:<guid>, or an OS username (stored as its cli:<16 hex> digest).');
}

// Exported (slice 4a) so a test can prove --recipe fails closed for a
// LEDGER_RECIPES token with no built RECIPE_STEP_ORDER entry, before any
// Dataverse read or ledger write.
export function parseArgs(argv) {
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
    recipe: 'basic',
    reviewerAddress: [],
    reviewerAddressFlags: [],
    defaultReviewerAddress: null,
    manifestOut: null,
    idempotencyKey: null,
    actor: null,
    advance: null,
    manifest: null,
    steps: 1,
    runInspect: null,
    runRecheck: null,
    setStatus: null,
    statusField: null,
    statusOption: null,
    rerun: false,
    statusRecheck: null,
    target: 'sandbox',
    director: null,
    createCast: false,
    castPi: null,
    castLiaison: null,
    castReviewer: null,
    confirm: false,
    bindReviewer: null,
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
    else if (arg.startsWith('--recipe=')) parsed.recipe = arg.slice('--recipe='.length);
    else if (arg.startsWith('--reviewer-address=')) parsed.reviewerAddress.push(arg.slice('--reviewer-address='.length));
    else if (arg.startsWith('--manifest-out=')) parsed.manifestOut = arg.slice('--manifest-out='.length);
    else if (arg.startsWith('--idempotency-key=')) parsed.idempotencyKey = arg.slice('--idempotency-key='.length);
    else if (arg.startsWith('--actor=')) parsed.actor = arg.slice('--actor='.length);
    else if (arg.startsWith('--advance=')) parsed.advance = arg.slice('--advance='.length);
    else if (arg.startsWith('--manifest=')) parsed.manifest = arg.slice('--manifest='.length);
    else if (arg.startsWith('--steps=')) parsed.steps = Number(arg.slice('--steps='.length));
    else if (arg.startsWith('--run-inspect=')) parsed.runInspect = arg.slice('--run-inspect='.length);
    else if (arg.startsWith('--run-recheck=')) parsed.runRecheck = arg.slice('--run-recheck='.length);
    else if (arg.startsWith('--set-status=')) parsed.setStatus = arg.slice('--set-status='.length);
    else if (arg.startsWith('--field=')) parsed.statusField = arg.slice('--field='.length);
    else if (arg.startsWith('--option=')) parsed.statusOption = arg.slice('--option='.length);
    else if (arg === '--rerun') parsed.rerun = true;
    else if (arg.startsWith('--status-recheck=')) parsed.statusRecheck = arg.slice('--status-recheck='.length);
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
    else if (arg.startsWith('--director=')) parsed.director = arg.slice('--director='.length);
    else if (arg === '--create-cast') parsed.createCast = true;
    else if (arg.startsWith('--cast-pi=')) parsed.castPi = arg.slice('--cast-pi='.length);
    else if (arg.startsWith('--cast-liaison=')) parsed.castLiaison = arg.slice('--cast-liaison='.length);
    else if (arg.startsWith('--cast-reviewer=')) parsed.castReviewer = arg.slice('--cast-reviewer='.length);
    else if (arg === '--confirm') parsed.confirm = true;
    else if (arg.startsWith('--bind-reviewer=')) parsed.bindReviewer = arg.slice('--bind-reviewer='.length);
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const modes = [parsed.prepare, parsed.execute, parsed.inspect, parsed.reserve ? '--reserve' : null, parsed.advance, parsed.runInspect, parsed.runRecheck, parsed.setStatus, parsed.statusRecheck, parsed.createCast ? '--create-cast' : null, parsed.bindReviewer];
  if (modes.filter(Boolean).length > 1) {
    throw new Error('Choose exactly one of --prepare, --execute, --inspect, --reserve, --advance, --run-inspect, --run-recheck, --set-status, --status-recheck, --create-cast, or --bind-reviewer.');
  }
  if ((parsed.createCast || parsed.bindReviewer) && parsed.target !== 'production') {
    throw new Error('--create-cast and --bind-reviewer are valid only with --target=production.');
  }
  if (parsed.createCast && !(parsed.castPi && parsed.castLiaison && parsed.castReviewer)) {
    throw new Error('--create-cast requires --cast-pi=, --cast-liaison= and --cast-reviewer= (allowlisted addresses).');
  }
  if (!parsed.createCast && (parsed.castPi || parsed.castLiaison || parsed.castReviewer || parsed.confirm)) {
    throw new Error('--cast-pi, --cast-liaison, --cast-reviewer and --confirm are valid only with --create-cast.');
  }
  // Production plan P1 / MVP list item 1: the destination is an explicit
  // operator choice, never inferred from the environment.
  if (!Object.hasOwn(TARGET_URLS, parsed.target)) throw new Error('--target must be sandbox or production.');
  if (parsed.target === 'production') {
    if (parsed.prepare || parsed.execute || parsed.inspect) {
      throw new Error('--target=production supports only --reserve, --advance and the read-only preflight; the legacy one-shot paths are sandbox-only.');
    }
    if (parsed.bypassGoverify) throw new Error('--bypass-goverify is never valid with --target=production.');
    if (parsed.reserve && (parsed.recipe !== 'basic' || !parsed.director)) {
      throw new Error('--target=production --reserve requires --recipe=basic (the default) and --director=<your sign-in>.');
    }
  }
  if ((parsed.setStatus || parsed.statusRecheck) && parsed.target !== 'production') {
    throw new Error('--set-status and --status-recheck are valid only with --target=production.');
  }
  if (parsed.setStatus && (!['phase1', 'phase2'].includes(parsed.statusField) || !String(parsed.statusOption || '').trim())) {
    throw new Error('--set-status requires --field=phase1|phase2 and --option="<live option label>".');
  }
  if (!parsed.setStatus && (parsed.statusField || parsed.statusOption || parsed.rerun)) {
    throw new Error('--field, --option and --rerun are valid only with --set-status.');
  }
  if (parsed.runRecheck && parsed.target !== 'production') {
    throw new Error('--run-recheck is valid only with --target=production.');
  }
  if (parsed.director && !(parsed.reserve && parsed.target === 'production')) {
    throw new Error('--director is valid only with --target=production --reserve.');
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
  if (!parsed.prepare && !parsed.reserve && (parsed.fiscalYear !== null || parsed.meetingDate !== null || parsed.sourceRequestNumber !== null || parsed.testLabel !== null)) {
    throw new Error('--source-request-number, --fiscal-year, --meeting-date, and --test-label are valid only with --prepare or --reserve.');
  }
  if (!parsed.prepare && !parsed.reserve && !parsed.advance && parsed.bundle !== null) {
    throw new Error('--bundle is valid only with --prepare, --reserve, or --advance.');
  }
  if (parsed.reserve && (!parsed.bundle || !parsed.manifestOut || !parsed.idempotencyKey)) {
    throw new Error('--reserve requires --bundle, --manifest-out, and --idempotency-key.');
  }
  if (!parsed.reserve && parsed.recipe !== 'basic') {
    throw new Error('--recipe is valid only with --reserve.');
  }
  // run-ledger.js's finite recipe set; the ledger enforces it again
  // server-side, but a bad value should fail before any Dataverse read.
  if (!LEDGER_RECIPES.includes(parsed.recipe)) {
    throw new Error(`--recipe must be one of: ${LEDGER_RECIPES.join(', ')}.`);
  }
  // Slice 4a: pre_site_visit/final_writeup/site_visit_materials are valid
  // LEDGER_RECIPES tokens (the ledger's enum accepts them so a future slice
  // can build their steps without touching the migration/enum again), but
  // RECIPE_STEP_ORDER (run-runner.js) has no entry for any of them yet --
  // stepOrderForRecipe/nextStepFor would throw on first use. Refuse here,
  // before any Dataverse read or ledger write, rather than let a run get
  // reserved and immediately stick at recipe_step_not_built.
  if (!Object.prototype.hasOwnProperty.call(RECIPE_STEP_ORDER, parsed.recipe)) {
    throw new Error(`--recipe=${parsed.recipe} has no built step order yet; supported recipes are: ${Object.keys(RECIPE_STEP_ORDER).join(', ')}.`);
  }
  // --reviewer-address is valid only with --reserve --recipe=reviews (D-R2/decision 4);
  // the reviews recipe requires at least one, since a run with zero
  // assignments is refused by the ledger.
  if (parsed.reviewerAddress.length > 0 && (!parsed.reserve || !recipeSeedsReviewers(parsed.recipe))) {
    throw new Error('--reviewer-address is valid only with --reserve --recipe=reviews (or a later recipe that seeds reviewers).');
  }
  if (parsed.reserve) {
    parsed.actorId = resolveActorId(parsed.actor);
    try {
      idempotencyKeyDigest(parsed.idempotencyKey);
    } catch {
      throw new Error('--idempotency-key must be 1-200 printable ASCII characters (no spaces); the ledger stores only its SHA-256.');
    }
    if (recipeSeedsReviewers(parsed.recipe)) {
      const SOURCE_PERSON_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const parsedFlags = parsed.reviewerAddress.map((raw) => {
        const eq = raw.indexOf('=');
        if (eq < 1) throw new Error('--reviewer-address must be <sourcePersonGuid>=<address>.');
        const sourcePersonId = raw.slice(0, eq);
        const address = raw.slice(eq + 1);
        if (!SOURCE_PERSON_GUID.test(sourcePersonId)) throw new Error(`--reviewer-address: ${sourcePersonId} is not a GUID.`);
        // reviewerAddressSha256 normalizes and validates the address shape;
        // resolveActorId-style fail-fast before any Dataverse read.
        reviewerAddressSha256(address);
        return { sourcePersonId: sourcePersonId.toLowerCase(), address };
      });
      // Canonical order (sorted by source GUID) so the digest and the
      // assignment `sequence` never depend on the flags' order on the
      // command line -- a same-key retry with the flags reordered is still
      // the same reservation.
      parsedFlags.sort((a, b) => (a.sourcePersonId < b.sourcePersonId ? -1 : a.sourcePersonId > b.sourcePersonId ? 1 : 0));
      const seen = new Set();
      for (const { sourcePersonId } of parsedFlags) {
        if (seen.has(sourcePersonId)) throw new Error(`--reviewer-address names ${sourcePersonId} more than once.`);
        seen.add(sourcePersonId);
      }
      // Resolving each address against the bundle's reviewers[] and the
      // sandbox's synthetic-only lookup (slice 6c-ii Stage B) needs a
      // Dataverse read and a ledger read, neither available yet during sync
      // arg parsing; runReserve's resolveReviewerAssignments does that
      // resolution and builds the final { sourcePersonId, destinationPersonId,
      // reused, address } assignments passed to ledger.reserveRun. This only
      // carries the raw flag pairs forward.
      parsed.reviewerAddressFlags = parsedFlags;
    }
  }
  for (const runId of [parsed.advance, parsed.runInspect, parsed.runRecheck, parsed.setStatus, parsed.statusRecheck, parsed.bindReviewer].filter(Boolean)) {
    if (!RUN_ID.test(runId)) throw new Error('--advance/--run-inspect/--run-recheck/--set-status/--status-recheck/--bind-reviewer take a run ID GUID.');
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
  console.log('Reserve a ledger-driven bundle run: ... --reserve --bundle=/absolute/source-bundle.json --source-request-number=<authorized-source-number> --manifest-out=/absolute/new-manifest.json --idempotency-key=<key> [--actor=<id>] [--recipe=basic|initial_assessment|reviews]');
  console.log('  --recipe: basic (default), initial_assessment, or reviews; a same idempotency key reserved under a different recipe is a conflict, not a return of the first run.');
  console.log('  --reviewer-address=<sourcePersonGuid>=<address> (repeatable): valid only with --reserve --recipe=reviews. Each names one source reviewer and the throwaway address its synthetic reviewer will use; an address that already names an owned synthetic person bound to the same source reviewer reuses it (reused: true), otherwise a fresh destination GUID is preallocated. A reviewer with no flag takes its synthetic bundle address, else TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS plus-tagged per source reviewer (<local>+<12 hex of sha256(source GUID)>@<domain>); with neither the reservation refuses. Reservation refuses zero assignments, a malformed address, or two assignments naming the same source reviewer or the same (case-insensitive) address.');
  console.log('  --idempotency-key: 1-200 printable ASCII characters, no spaces; the ledger stores only its SHA-256.');
  console.log('  --actor: admin:<guid> or user:<guid>, or an OS username; a username (default: the current OS user) is stored only as cli:<16 hex digest>.');
  console.log('Advance a reserved run by bounded steps: ... --advance=<runId> --manifest=/absolute/manifest.json --bundle=/absolute/source-bundle.json [--steps=N] [--bypass-goverify]');
  console.log('Inspect a ledger run (read-only, no Dataverse): ... --run-inspect=<runId>');
  console.log('Set Phase I or II Status on a ready production test Request (owner-run; writes need DATAVERSE_PROD_WRITE_ACK): ... --target=production --set-status=<runId> --field=phase1|phase2 --option="<live option label>" [--rerun]');
  console.log('Recheck a status change for late effects (read-only): DATAVERSE_ALLOW_PROD_READS=yes ... --target=production --status-recheck=<runId>');
  console.log('Recheck a production run\'s Foundation account against its pre-create baseline (read-only; plan P5\'s later check): DATAVERSE_ALLOW_PROD_READS=yes ... --target=production --run-recheck=<runId>');
  console.log('Create the reused synthetic cast (owner-run once; addresses must be on the Admin allowlist; prints the plan and stops unless --confirm; every run needs DATAVERSE_ALLOW_PROD_READS=yes, and --confirm also DATAVERSE_PROD_WRITE_ACK): ... --target=production --create-cast --cast-pi=<address> --cast-liaison=<address> --cast-reviewer=<address> [--confirm]');
  console.log('Bind the cast suggested reviewer to a ready production test Request (owner-run; needs DATAVERSE_ALLOW_PROD_READS=yes and DATAVERSE_PROD_WRITE_ACK): ... --target=production --bind-reviewer=<runId>');
  console.log('Production (owner-run; MVP basic only): --target=production with --reserve (plus --director=<your sign-in>, who becomes the program director) or --advance; never --bypass-goverify. Writes need DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>" inline.');
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
export async function buildGraphContext() {
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { configuredSharePointTargetInfo } = await import('../lib/services/sharepoint-target-registry.js');
  const graph = {
    getSiteId: () => GraphService.getSiteId(),
    getDriveId: (library, options) => GraphService.getDriveId(library, options),
    ensureFolderPath: (library, folder, options) => GraphService.ensureFolderPath(library, folder, options),
    listFiles: (parentRelativeUrl, locationRelativeUrl, options) => GraphService.listFiles(parentRelativeUrl, locationRelativeUrl, options),
    // options forwarded (Stage B round 2, P1-B): the seed_initial_assessment
    // step's upload-resume path passes { siteId } through this wrapper so
    // the re-read of a journaled item stays bound to the preflight-verified
    // site, matching ensureFolderPath/uploadFile's existing options passthrough.
    getFileMetadataById: (driveId, itemId, options) => GraphService.getFileMetadataById(driveId, itemId, options),
    downloadFile: (driveId, itemId) => GraphService.downloadFile(driveId, itemId),
    // P3 (Opus round 1): the Pre-Site Visit recipe's steps (via
    // presite-sandbox-deps.js's own passthrough wrapper) can call
    // deleteFile -- upload-recovery's orphan cleanup on a create-only
    // conflict -- so it must be reachable through this CLI's Graph object
    // like every other Graph method the sandbox deps forward.
    deleteFile: (driveId, itemId) => GraphService.deleteFile(driveId, itemId),
    getFileMetadataByPath: (library, folder, filename, options) => GraphService.getFileMetadataByPath(library, folder, filename, options),
    // Stage C: forwarded so the sandbox-bound Initial Assessment Board
    // snapshot step (ia-sandbox-deps.js createIaSandboxDeps) can be driven
    // through this CLI, matching every other read/write above. Never used by
    // stepSeedInitialAssessment.
    getFileVersionMetadata: (driveId, itemId, versionId) => GraphService.getFileVersionMetadata(driveId, itemId, versionId),
    downloadFileVersion: (driveId, itemId, versionId) => GraphService.downloadFileVersion(driveId, itemId, versionId),
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

/**
 * B5 (slice 6c-ii Stage B): the seeder must never run where the read-side
 * fences are off. `SYNTHETIC_REVIEWER_ISOLATION=on` is required in THIS
 * process for both `--reserve --recipe=reviews` (the resolution below reads
 * the synthetic-only lookup) and `--advance` of a `reviews` run.
 */
export function assertSyntheticReviewerIsolationOnForReviews(recipe) {
  if (!recipeSeedsReviewers(recipe)) return;
  if (!syntheticReviewerIsolationEnabled()) {
    throw new Error(
      'SYNTHETIC_REVIEWER_ISOLATION must be "on" in this process to reserve or advance a reviews-recipe run '
      + '(the seeder must never run where the read-side fences are off). Set SYNTHETIC_REVIEWER_ISOLATION=on '
      + 'in the operator shell and confirm the target sandbox has wave30 (wmkf_issyntheticreviewer) applied.',
    );
  }
}

/** Marker/active/Contact-link check on a raw (unfiltered) person row (P2-4). */
function isSyntheticActiveContactless(row) {
  return !!row && row[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] === true
    && (row.statecode === undefined || row.statecode === 0)
    && !row._wmkf_contact_value;
}

/**
 * B1 (slice 6c-ii Stage B, plan "Reserve"/"Identity contract"). Resolves
 * EVERY bundle reviewer (not only the ones named by an explicit
 * --reviewer-address flag) to a destination assignment, entirely before
 * ledger.reserveRun ever runs:
 *   - the source GUID must name a reviewer in the bundle (else refuse);
 *   - an address is required for every bundle reviewer (a synthetic source
 *     reviewer with an exported address may default to it; a real source
 *     reviewer requires the flag); two reviewers sharing an address refuse;
 *   - the address is resolved through an UNFILTERED lookup (P2-4,
 *     `findAnyPersonByEmail` -- deliberately not a synthetic-only lookup: a
 *     synthetic-only lookup would return null for a REAL reviewer's address,
 *     which would then get a fresh preallocated GUID and store that real
 *     address as the run's recipient-confinement address, refusing only much
 *     later at seed time on the alternate-key conflict). A row that exists
 *     and is NOT an active, Contact-less, marker-true synthetic person
 *     refuses the reservation immediately (`reviewer_person_not_synthetic`).
 *     A marker-true/active/Contact-less row is reused ONLY IF every prior
 *     assignment naming that destination GUID (any run, any status) names
 *     this same source GUID, AND the row equals syntheticPersonProjection
 *     field-by-field with null preserved; otherwise a fresh destination GUID
 *     is preallocated (reused: false). The cross-run provenance check
 *     (`listAssignmentsByDestinationPerson`) reads OUTSIDE the reservation's
 *     own transaction (`reserveRun`'s INSERT), so it cannot itself observe or
 *     prevent a concurrent second reservation racing the same destination
 *     GUID; it is backstopped by the field-by-field projection check here
 *     AND by `resolveReviewerPerson`'s identical re-verification at seed time
 *     (run-runner.js), which re-reads and re-checks both before any write --
 *     a race that slipped past this reservation-time check would still be
 *     caught, never silently written.
 */
export async function resolveReviewerAssignments({
  deps, ledger, bundle, reviewerAddressFlags, defaultReviewerAddress = null,
}) {
  const bundleReviewersByPersonId = new Map(
    (bundle.reviewers || []).map((reviewer) => [String(reviewer.personId).toLowerCase(), reviewer]),
  );
  const flagsBySource = new Map(reviewerAddressFlags.map((flag) => [flag.sourcePersonId, flag.address]));
  for (const sourcePersonId of flagsBySource.keys()) {
    if (!bundleReviewersByPersonId.has(sourcePersonId)) {
      throw new Error(`--reviewer-address names ${sourcePersonId}, which is not a reviewer in the bundle.`);
    }
  }

  const resolved = [];
  const seenAddresses = new Map();
  const sourceIds = [...bundleReviewersByPersonId.keys()].sort();
  for (const sourcePersonId of sourceIds) {
    const bundleReviewer = bundleReviewersByPersonId.get(sourcePersonId);
    let rawAddress = flagsBySource.get(sourcePersonId);
    if (rawAddress === undefined) {
      if (bundleReviewer.personIsSynthetic && bundleReviewer.person?.wmkf_emailaddress) {
        rawAddress = bundleReviewer.person.wmkf_emailaddress;
      } else if (defaultReviewerAddress) {
        rawAddress = defaultReviewerAddressFor(defaultReviewerAddress, sourcePersonId);
      } else {
        throw new Error(`Reviewer ${sourcePersonId} has no --reviewer-address, no synthetic default address in the bundle, and no ${DEFAULT_REVIEWER_ADDRESS_ENV}; refusing.`);
      }
    }
    const { address: normalizedAddress } = reviewerAddressSha256(rawAddress);
    if (seenAddresses.has(normalizedAddress)) {
      throw new Error(`--reviewer-address: address ${normalizedAddress} is assigned to more than one source reviewer.`);
    }
    seenAddresses.set(normalizedAddress, sourcePersonId);

    const existing = await deps.findAnyPersonByEmail(normalizedAddress);
    if (!existing) {
      resolved.push({
        sourcePersonId, destinationPersonId: crypto.randomUUID(), reused: false, address: rawAddress,
      });
      continue;
    }
    if (!isSyntheticActiveContactless(existing)) {
      throw Object.assign(
        new Error(`Address ${normalizedAddress} is already owned by a person that is not an active, Contact-less synthetic reviewer; refusing (reviewer_person_not_synthetic).`),
        { code: 'reviewer_person_not_synthetic' },
      );
    }
    const destinationPersonId = existing.wmkf_potentialreviewersid;
    const priorSources = await ledger.listAssignmentsByDestinationPerson(destinationPersonId);
    if (priorSources.some((id) => String(id).toLowerCase() !== sourcePersonId)) {
      throw Object.assign(
        new Error(`Address ${normalizedAddress} resolves to a synthetic person already bound to a different source reviewer; refusing (reviewer_person_provenance_mismatch).`),
        { code: 'reviewer_person_provenance_mismatch' },
      );
    }
    const expected = syntheticPersonProjection(bundleReviewer, normalizedAddress);
    for (const [field, expectedValue] of Object.entries(expected)) {
      const actualValue = existing[field] ?? null;
      const wanted = expectedValue ?? null;
      if (actualValue !== wanted) {
        throw Object.assign(
          new Error(`Existing synthetic person ${destinationPersonId} field ${field} does not match the bundle's synthetic-person projection; refusing reuse (reviewer_person_projection_drift).`),
          { code: 'reviewer_person_projection_drift' },
        );
      }
    }
    resolved.push({
      sourcePersonId, destinationPersonId, reused: true, address: rawAddress,
    });
  }
  return resolved;
}

export async function runReserve(client, args, ledgerUrl) {
  assertSyntheticReviewerIsolationOnForReviews(args.recipe);
  if (recipeSeedsReviewers(args.recipe)) {
    // Same script-only precedent as runAdvance: a single-process,
    // single-invocation CLI, entered narrowly before the first sandbox-bound
    // dependency call this recipe needs.
    const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
    enterDynamicsBypassForScript('rehearse-test-request-sandbox:reserve-reviews');
  }
  const { graph, sharePointTarget } = await buildGraphContext();
  const preflight = await runPreflight(client, graph, sharePointTarget);
  const bundle = readSourceBundle(readJson(args.bundle));
  assertBundleHasReviewerSectionForRecipe(args.recipe, bundle);
  assertBundleHasPreSiteSectionForRecipe(args.recipe, bundle);
  const source = bundle.source.request;
  if (source.akoya_requestnum !== args.sourceRequestNumber) {
    throw new Error(`Bundle source is Request ${source.akoya_requestnum}; --source-request-number attests ${args.sourceRequestNumber}. Refusing.`);
  }
  assertBundleFresh(bundle);
  if (source.akoya_requesttype !== preflight.grantOption.value) {
    throw new Error('Source Request must be a Grant Request matching the live Grant option.');
  }
  const cycle = resolveCloneCycle(source, args);
  // The cloning admin is the clone's program director (owner, S546),
  // resolved from their sign-in on the target, never a supplied GUID.
  const target = args.target ?? 'sandbox';
  const programDirector = target === 'production' ? await resolveProgramDirector(client, args.director) : null;
  // Every production clone binds the synthetic cast PI and Liaison (owner,
  // S548); the reservation refuses until the cast exists and reads back.
  let cast = null;
  if (target === 'production') {
    const castDb = pgLedgerDb(ledgerUrl);
    try {
      const members = await readCast({ client, ledger: createRunLedger(castDb), environment: 'production' });
      cast = { piContactId: members.pi.memberId, liaisonContactId: members.liaison.memberId };
    } finally {
      await castDb.end();
    }
  }
  const manifest = buildCloneManifest(preflight, {
    ...cycle, source, testLabel: args.testLabel, bundle, recipe: args.recipe, programDirector, ...(cast ? { cast } : {}),
  });
  if (targetEnvironmentOf(manifest) !== target) throw new Error('Manifest target does not match --target.');
  if (!isBundleManifest(manifest)) throw new Error('The bounded ledger-driven runner only supports bundle (v4) manifests.');

  const { actorId } = args;
  let reviewerAssignments = [];
  if (recipeSeedsReviewers(manifest.recipe)) {
    const resolutionDb = pgLedgerDb(ledgerUrl);
    try {
      const ledgerForResolution = createRunLedger(resolutionDb);
      const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
      reviewerAssignments = await resolveReviewerAssignments({
        deps, ledger: ledgerForResolution, bundle, reviewerAddressFlags: args.reviewerAddressFlags,
        defaultReviewerAddress: args.defaultReviewerAddress,
      });
    } finally {
      // Resolution is read-only and self-contained; the reservation itself
      // reopens its own connection below (mirrors the pre-existing
      // pgLedgerDb-per-call shape rather than threading one connection through
      // both an unconditional and a recipe-conditional path).
      await resolutionDb.end();
    }
  }
  // F2 (Codex slice 6c-ii Stage C round 1): a `reviews` reservation must
  // validate the review-file policy against the bundle's uploaded
  // reviewers BEFORE anything is written -- no manifest, no ledger row --
  // so a policy violation never strands a half-reserved run.
  if (recipeSeedsReviewers(manifest.recipe)) {
    validateReviewFilePlan(bundle, reviewerAssignments.map((a) => a.sourcePersonId));
  }
  // The plan digest binds the ledger-relevant identities/hashes, never
  // purpose text or the create body itself. Recipe is included so a same-key
  // retry naming a different recipe conflicts instead of returning the first
  // run. For `reviews`, the address digests (sorted, order-independent) and
  // the assignment count are bound too (6c-i build notes), so a same-key
  // retry naming different addresses conflicts instead of silently reusing
  // the first reservation's assignments. computeRunPlanDigest (F2 change 3)
  // is the SAME shared helper the runner's pre-lease check recomputes from
  // the manifest alone at advance time.
  const planDigest = computeRunPlanDigest({
    manifest,
    reviewerAddressDigests: reviewerAssignments.map((a) => reviewerAddressSha256(a.address).addressSha256),
  });
  const plan = {
    runId: manifest.values.runId,
    recipe: manifest.recipe,
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
    destinationEnvironment: targetEnvironmentOf(manifest),
    destinationDataverseHost: targetHostOf(manifest),
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
      reserved = await ledger.reserveRun({
        actorId, idempotencyKey: args.idempotencyKey, plan, reviewerAssignments,
      });
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

export async function runAdvance(client, args, ledgerUrl) {
  // Every Initial Assessment step's sandbox dependency
  // (lib/services/test-requests/ia-sandbox-deps.js) calls
  // assertTrustedDalContext; this CLI is a single-process, single-invocation
  // script with no concurrent request contexts to leak the bypass into, so
  // it uses the documented script-only precedent
  // (scripts/rebaseline-email-defaults.mjs) rather than a route/library-shaped
  // withDalContext/bypassDynamicsRestrictions scope. Entered once, narrowly,
  // at the top of this function (not module load) so `--reserve`/`--inspect`
  // invocations of this same file, which never reach a sandbox-bound
  // dependency, never carry it.
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('rehearse-test-request-sandbox:advance');
  const manifest = readJson(args.manifest);
  if (targetEnvironmentOf(manifest) !== (args.target ?? 'sandbox')) {
    throw new Error(`Manifest target is ${targetEnvironmentOf(manifest)}; pass --target=${targetEnvironmentOf(manifest)} to advance it.`);
  }
  assertSyntheticReviewerIsolationOnForReviews(manifest.recipe ?? 'basic');
  const bundle = readSourceBundle(readJson(args.bundle));
  const { graph, sharePointTarget } = await buildGraphContext();
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    const before = await ledger.getRun(args.advance);
    if (!before) throw new Error(`No test request run found for ${args.advance}.`);
    if (before.status !== 'prepared' && before.status !== 'creating' && before.status !== 'needs_attention') {
      // Nothing to advance: a ready or retiring run has no working step left.
      console.log(JSON.stringify({
        mode: 'NOT_ADVANCED', runId: args.advance, status: before.status, currentStep: before.currentStep,
        destinationRequestNumber: before.destinationRequestNumber ?? null, note: `run is ${before.status}; nothing to advance`,
      }, null, 2));
      return;
    }
    for (let i = 0; i < args.steps; i += 1) {
      const result = await advanceRun({
        runId: args.advance,
        ledger,
        manifest,
        bundle,
        deps: { client, graph, sharePointTarget },
        // Owner decision 2026-09-24 (Codex adversarial round 1, F4): any
        // recipe whose step order runs the IA steps chains many sequential
        // Dataverse and Graph calls under one lease and the runner never
        // renews it, so it takes the ledger's maximum (900 s, run-ledger.js
        // claimLease clamp) instead of the Basic 300 s -- derived via
        // recipeLeaseSeconds (run-runner.js) rather than named per recipe
        // here, so a future IA-cumulative recipe cannot miss it (slice 6c-i
        // Opus review, P1-b: `reviews` is cumulative on `initial_assessment`
        // and needs the same 900 s). No renewal mechanism; reconsidered only
        // if a live run shows longer phases.
        options: { bypassGoverify: args.bypassGoverify, leaseSeconds: recipeLeaseSeconds(manifest.recipe ?? 'basic') },
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

/**
 * Slice 6c-ii Stage C: a curated per-reviewer summary (form, file count,
 * attested digest, pointers) for `--run-inspect`, distinct from the raw
 * `resources` dump below. Every value here already passed run-ledger.js's
 * no-text-invariant receipt validation at write time (finite enum tokens,
 * GUIDs, hashes and grammar-matched paths only -- never free text or a
 * plaintext address), so this summary carries nothing new to redact; it
 * exists to make the reviews recipe's outcome legible without hand-parsing
 * the raw resource rows.
 */
export function summarizeReviewResources(resources, reviewerAssignments) {
  return reviewerAssignments.map((assignment) => {
    const suggestionResource = resources.find((r) => r.step === 'seed_reviewers' && r.resourceKind === 'dataverse_reviewer_suggestion'
      && r.plannedIdentity?.assignmentSequence === assignment.sequence);
    const answersResource = resources.find((r) => r.step === 'seed_review_answers' && r.resourceKind === 'dataverse_review_answer_set'
      && r.plannedIdentity?.assignmentSequence === assignment.sequence);
    const folderResource = resources.find((r) => r.step === 'copy_review_file' && r.resourceKind === 'sharepoint_folder'
      && r.plannedIdentity?.assignmentSequence === assignment.sequence);
    const fileResources = resources.filter((r) => r.step === 'copy_review_file' && r.resourceKind === 'sharepoint_file'
      && r.plannedIdentity?.assignmentSequence === assignment.sequence);
    const attestedDigests = fileResources.map((r) => r.readback?.attestedDigest).filter(Boolean);
    return {
      sequence: assignment.sequence,
      destinationSuggestionId: suggestionResource?.plannedIdentity?.suggestionId ?? null,
      reviewForm: answersResource?.plannedIdentity?.reviewForm ?? null,
      answerCount: answersResource?.readback?.answerCount ?? null,
      fileCount: fileResources.length,
      // Only present for a DOCX file (property-promotion evidence); null for
      // an exact-hash PDF/DOC file or when no file was copied.
      attestedDigests: attestedDigests.length ? attestedDigests : null,
      // The folder is the ledger's own grammar-matched relative path, never
      // a full URL; the filename is one of `Review_[1-5].(pdf|docx|doc)`.
      // Both null for received_no_file/unreceived, exactly mirroring the
      // verifier's own mutually-exclusive branch.
      pointers: folderResource?.readback?.filename
        ? { folder: folderResource.plannedIdentity?.folder ?? null, filename: folderResource.readback.filename }
        : null,
    };
  });
}

/**
 * Slice 4b: a curated Pre-Site summary for `--run-inspect` -- ids, the
 * generation-key digest and content hash, never section text/prompt bodies
 * (every value here already passed run-ledger.js's no-text-invariant
 * receipt validation at write time, same rationale as
 * summarizeReviewResources above).
 */
export function summarizePresiteResources(resources) {
  const aiRun = resources.find((r) => r.step === 'seed_presite_ai_run' && r.resourceKind === 'dataverse_ai_run');
  const draft = resources.find((r) => r.step === 'seed_presite_draft' && r.resourceKind === 'dataverse_request_document');
  if (!aiRun && !draft) return null;
  return {
    aiRunId: aiRun?.readback?.confirmedRunId ?? null,
    requestDocumentId: draft?.readback?.requestDocumentId ?? null,
    generationKeyDigest: draft?.plannedIdentity?.generationKey ?? null,
  };
}

async function runRunInspect(runInspect, ledgerUrl) {
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    const run = await ledger.getRun(runInspect);
    if (!run) throw new Error(`No test request run found for ${runInspect}.`);
    const resources = await ledger.listRunResources(runInspect);
    // Never the plaintext address, only its digest (D-R2): listRunReviewerAssignments
    // never selects the `address` column, so there is nothing to redact here.
    const reviewerAssignments = recipeSeedsReviewers(run.recipe) ? await ledger.listRunReviewerAssignments(runInspect) : [];
    const reviewsSummary = recipeSeedsReviewers(run.recipe) ? summarizeReviewResources(resources, reviewerAssignments) : [];
    const presiteSummary = recipeSeedsPreSite(run.recipe) ? summarizePresiteResources(resources) : null;
    console.log(JSON.stringify({
      mode: 'READ_ONLY_RUN_INSPECT', run, resources, reviewerAssignments, reviewsSummary, presiteSummary,
    }, null, 2));
  } finally {
    await db.end();
  }
}

/**
 * Status setter (cast-and-status plan, slice C): --set-status makes one Phase I
 * or Phase II Status change (or resumes the run's open one); --status-recheck
 * reports effects that arrived after the last change. Writes need
 * DATAVERSE_PROD_WRITE_ACK inline; the recheck only reads.
 */
export async function runStatusMode(client, args, ledgerUrl) {
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    const result = args.setStatus
      ? await runStatusChange({ client, ledger, runId: args.setStatus, field: fieldFor(args.statusField), optionLabel: args.statusOption, rerun: args.rerun })
      : await recheckStatusChange({ client, ledger, runId: args.statusRecheck });
    console.log(JSON.stringify({ mode: args.setStatus ? 'STATUS_CHANGED' : 'READ_ONLY_STATUS_RECHECK', runId: args.setStatus || args.statusRecheck, ...result }, null, 2));
  } finally {
    await db.end();
  }
}

/** The Admin test-Request allowlist, read from the target org (the local settings service may point at the sandbox). */
async function readTargetAllowlist(client) {
  const filter = odata.eq('wmkf_settingkey', TEST_REQUEST_EMAIL_ALLOWLIST_KEY);
  const response = await client.get(`/wmkf_appsystemsettings?$select=wmkf_settingvalue&$filter=${encodeURIComponent(filter)}&$top=1`);
  if (!response.ok) throw new Error(`Reading the test-Request allowlist failed (${response.status}).`);
  return parseAllowlistValue(response.body?.value?.[0]?.wmkf_settingvalue ?? null);
}

/**
 * Synthetic cast (cast-and-status plan, slices A + B): --create-cast creates
 * or resumes the reused PI, Liaison and suggested-reviewer person (prints
 * the plan and stops without --confirm); --bind-reviewer attaches the cast
 * reviewer to one ready production test Request. Output carries no addresses.
 */
export async function runCastMode(client, args, ledgerUrl) {
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    if (args.bindReviewer) {
      const result = await runCastBinding({ client, ledger, runId: args.bindReviewer });
      console.log(JSON.stringify({ mode: 'CAST_REVIEWER_BOUND', runId: args.bindReviewer, ...result }, null, 2));
      return;
    }
    const addresses = { pi: args.castPi, liaison: args.castLiaison, suggested_reviewer: args.castReviewer };
    const allowlist = await readTargetAllowlist(client);
    planCastAddresses({ addresses, allowlist });
    if (!args.confirm) {
      console.log(JSON.stringify({
        mode: 'CAST_PLAN_ONLY',
        target: client.baseUrl,
        members: CAST_ROLE_ORDER.map((role) => ({ role, ...CAST_DEFAULT_NAMES[role] })),
        next: 'Re-run with --confirm (and DATAVERSE_PROD_WRITE_ACK) to create or resume these members.',
      }, null, 2));
      return;
    }
    const result = await runCastCreate({ client, ledger, environment: 'production', addresses, allowlist });
    console.log(JSON.stringify({ mode: 'CAST_CREATED', ...result }, null, 2));
  } finally {
    await db.end();
  }
}

/**
 * Read-only: re-evaluates a production run's Foundation account and Contacts
 * against its journaled pre-create baseline (foundation-transition.js). No
 * ledger or Dataverse write. Prints outcome and failure text only.
 */
export async function runRecheck(client, runId, ledgerUrl) {
  const db = pgLedgerDb(ledgerUrl);
  try {
    const ledger = createRunLedger(db);
    const run = await ledger.getRun(runId);
    if (!run) throw new Error(`No test request run found for ${runId}.`);
    if (run.destinationEnvironment !== 'production') throw new Error(`Run ${runId} is not a production run.`);
    const resources = await ledger.listRunResources(runId);
    // The cast Liaison is the one contact the Foundation Primary Contact may
    // become (slice B); a run journaled before the cast fails closed without it.
    const liaison = (await ledger.listCastMembers({ environment: 'production' }))
      .find((member) => member.role === 'liaison' && member.status === 'verified');
    const { failures, outcome } = await recheckFoundationTransition({
      client, organizationId: run.expectedOrganizationId, resources, liaisonContactId: liaison?.memberId ?? null,
    });
    console.log(JSON.stringify({
      mode: 'READ_ONLY_FOUNDATION_RECHECK', runId, status: run.status, ok: failures.length === 0, outcome, failures,
    }, null, 2));
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
  applyDefaultReviewerAddress(args);

  if (args.runInspect) {
    const ledgerUrl = requireLedgerUrl();
    await runRunInspect(args.runInspect, ledgerUrl);
    return;
  }

  const targetUrl = TARGET_URLS[args.target];
  if (args.setStatus || args.statusRecheck) {
    const ledgerUrl = requireLedgerUrl();
    // No marker writes: a status change never touches the Test Request marker.
    const statusClient = createClient({ resourceUrl: targetUrl, token: await getAccessToken(targetUrl) });
    await runStatusMode(statusClient, args, ledgerUrl);
    return;
  }
  if (args.createCast || args.bindReviewer) {
    const ledgerUrl = requireLedgerUrl();
    // The cast person create is a sanctioned marker write (wmkf_potentialreviewerses).
    const castClient = createClient({ resourceUrl: targetUrl, token: await getAccessToken(targetUrl), allowTestRequestMarkerWrites: true });
    await runCastMode(castClient, args, ledgerUrl);
    return;
  }
  if (args.runRecheck) {
    const ledgerUrl = requireLedgerUrl();
    const readClient = createClient({ resourceUrl: targetUrl, token: await getAccessToken(targetUrl) });
    await runRecheck(readClient, args.runRecheck, ledgerUrl);
    return;
  }
  if (args.target === 'sandbox' && process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_URL) {
    throw new Error(`DYNAMICS_SANDBOX_URL must equal the registered sandbox ${SANDBOX_URL}.`);
  }
  // A production write still needs the interlock's per-invocation
  // DATAVERSE_PROD_WRITE_ACK, set by the owner inline on the command.
  const client = createClient({
    resourceUrl: targetUrl,
    token: await getAccessToken(targetUrl),
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

// Guarded so a test can import this module's exported pure helpers
// (resolveReviewerAssignments, assertSyntheticReviewerIsolationOnForReviews)
// without triggering a live run (mirrors
// export-test-request-source-bundle.mjs's own guard).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
