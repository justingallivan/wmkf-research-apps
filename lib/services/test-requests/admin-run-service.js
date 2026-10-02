/**
 * Admin Test Request Factory form: server plumbing (plan
 * docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md, slice 1).
 *
 * One service a thin route can call. It owns the deployment-bound Dataverse
 * client, the Graph object, the ledger (via the registry guard) and the
 * private Blob store, and drives the unchanged runner (advanceRun, reserveRun,
 * the production fence, the basic steps). The deployment alone picks the
 * target: only Production addresses the production host. Write entry points
 * (exportSource, confirmRun, advance) sit behind TEST_REQUEST_FACTORY_FORM;
 * read entry points never do, so a stopped deployment can still be inspected.
 *
 * Every external is injectable (see createAdminRunService); the defaults are
 * the real implementations. The twin of the owner-run CLI's reserve/advance
 * paths: scripts/rehearse-test-request-sandbox.mjs (runReserve, runAdvance).
 */

import crypto from 'crypto';
import { createRequire } from 'node:module';
import { ServiceHttpError } from '../service-http-error.js';
import { classifyDeployment } from '../../dataverse/core/interlock.js';
import { requireLedgerUrl, ledgerSchemaCheck } from '../../db/ledger-guard.js';
import { pgLedgerDb } from './run-ledger-db.js';
import { createRunLedger } from './run-ledger.js';
import {
  deriveActorId, deriveRunIds, targetFromDeployment,
} from './admin-run-identity.js';
import { createFactoryArtifactStore } from './factory-artifact-store.js';
import {
  factoryFormEnabled, syntheticReviewerIsolationEnabled, testRequestIsolationEnabled,
} from './isolation.js';
import {
  TARGET_URLS,
  buildCloneManifest,
  computeRunPlanDigest,
  getLocations,
  isBundleManifest,
  resolveLocationParents,
  resolveProgramDirector as defaultResolveProgramDirector,
  runPreflight as defaultRunPreflight,
  targetEnvironmentOf,
  targetHostOf,
} from './basic-clone-steps.js';
import { ARCHIVE_LIBRARIES } from '../../utils/sharepoint-buckets.js';
import { advanceRun, recipeLeaseSeconds } from './run-runner.js';
import { recheckFoundationTransition } from './foundation-transition.js';
import {
  fieldFor, readCurrentStatus as defaultReadCurrentStatus, readLiveOptions as defaultReadLiveOptions, recheckStatusChange as defaultRecheckStatusChange,
  runStatusChange as defaultRunStatusChange,
} from './status-change-runner.js';
import { readCast as defaultReadCast } from './cast-runner.js';
import { assertBundleFresh } from './bundle-file-copy.js';
import { resolveCloneCycle } from './sandbox-clone.js';
import { exportTestRequestSourceBundle, readSourceBundle, summarizeSourceBundle } from './source-bundle.js';

// lib/dataverse/client.js is CommonJS; same loader shape as lib/db/ledger-registry.js.
const require = createRequire(import.meta.url);

// policy.js's own bound (compileTestRequestDraft enforces it again); not exported there.
const MAX_LABEL_LENGTH = 120;
const POOL = Object.freeze({ max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
const RESUMABLE = new Set(['prepared', 'creating', 'needs_attention']);
const EMAIL = /^[^\s@']+@[^\s@']+$/;
// One advance step includes the 60 s observe wait; do not start one with less than this left.
const MIN_STEP_BUDGET_MS = 150_000;
// A status change PATCHes once, then waits for jobs: do not start one with less than this left,
// and stop waiting this long before the route's own deadline.
const MIN_STATUS_BUDGET_MS = 150_000;
const STATUS_WAIT_MARGIN_MS = 30_000;
const STATUS_RUNNER_REFUSALS = new Set([
  'status_change_noop', 'status_change_open', 'status_change_conflict', 'status_change_resume', 'status_change_effects',
  'status_change_edge', 'status_change_concurrent', 'status_change_refused',
]);
const STATUS_REPLAY_MESSAGE = 'An earlier change to this status created, or may have created, a payment or status-tracking row on this Request. Repeating it needs the owner CLI (`--set-status … --rerun`) after inspection.';
const abandonCommandFor = (runId, changeId) => `node scripts/rehearse-test-request-sandbox.mjs --target=production --status-abandon=${runId} --change-id=${changeId}`;

const refuse = (message, httpStatus, code) => new ServiceHttpError(message, { httpStatus, code });

/** A run as the form may see it: no lease token, no idempotency-key digest. */
function publicRun(run) {
  if (!run) return null;
  const { leaseToken, idempotencyKey, ...rest } = run; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * Twin of the CLI's buildGraphContext (scripts/rehearse-test-request-sandbox.mjs):
 * the injected GraphService-shaped object and SharePoint target getter. Kept
 * as a copy on purpose in this slice; do not refactor the CLI to share it yet.
 */
async function defaultGraphContext() {
  const { GraphService } = await import('../graph-service.js');
  const { configuredSharePointTargetInfo } = await import('../sharepoint-target-registry.js');
  const graph = {
    getSiteId: () => GraphService.getSiteId(),
    getDriveId: (library, options) => GraphService.getDriveId(library, options),
    ensureFolderPath: (library, folder, options) => GraphService.ensureFolderPath(library, folder, options),
    listFiles: (parentRelativeUrl, locationRelativeUrl, options) => GraphService.listFiles(parentRelativeUrl, locationRelativeUrl, options),
    getFileMetadataById: (driveId, itemId, options) => GraphService.getFileMetadataById(driveId, itemId, options),
    downloadFile: (driveId, itemId) => GraphService.downloadFile(driveId, itemId),
    deleteFile: (driveId, itemId) => GraphService.deleteFile(driveId, itemId),
    getFileMetadataByPath: (library, folder, filename, options) => GraphService.getFileMetadataByPath(library, folder, filename, options),
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

/**
 * Document buckets for the source Request, read through the explicit
 * production client. The shared resolver (lib/utils/sharepoint-buckets.js
 * getRequestSharePointBuckets) goes through DynamicsService, i.e. the
 * deployment's own DYNAMICS_URL, so on a Preview deployment it would look for
 * the production Request in the sandbox org and find no locations (Codex
 * slice 1 review). Same strict contract as that resolver with both flags on:
 * a complete location result, every parent resolved, then the archive probes.
 */
async function bucketsViaClient(client, requestId, requestNumber) {
  const locations = await getLocations(client, requestId); // refuses a truncated result
  const parents = await resolveLocationParents(client, locations);
  const buckets = new Map();
  locations.forEach((location, index) => {
    if (!location.relativeurl) return;
    const library = parents[index]?.relativeurl;
    if (!library) throw new Error(`Unable to verify the parent library for SharePoint location "${location.relativeurl}".`);
    const key = `${library}::${location.relativeurl}`;
    if (!buckets.has(key)) buckets.set(key, { library, folder: location.relativeurl, source: 'dynamics' });
  });
  const archiveFolder = `${requestNumber}_${requestId.replace(/-/g, '').toUpperCase()}`;
  for (const library of ARCHIVE_LIBRARIES) {
    const key = `${library}::${archiveFolder}`;
    if (!buckets.has(key)) buckets.set(key, { library, folder: archiveFolder, source: 'archive' });
  }
  return [...buckets.values()];
}

/**
 * Read-only production export of one source Request as a v2 bundle (twin of
 * scripts/export-test-request-source-bundle.mjs, no reviewer/Pre-Site
 * sections). Every Dataverse read, including document discovery, goes through
 * the explicit production client; Graph reads use the shared SharePoint site.
 * `sourceDependencies` lets tests supply the Graph side.
 */
async function defaultExportBundle({ sourceRequestNumber, exportedAt, assertTime = () => {} }, { createClient, getAccessToken, sourceDependencies = null }) {
  const { withDalContext } = await import('../../dataverse/core/context.js');
  const { requireUniqueSourceRequest } = await import('./sandbox-clone.js');
  const adminPreview = await import('./admin-preview-service.js');
  const resourceUrl = TARGET_URLS.production;
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const dependencies = adminPreview.createStrictTestRequestSourceDependencies({
    ...adminPreview.TEST_REQUEST_ADMIN_PREVIEW_DEPENDENCIES,
    ...(sourceDependencies ?? {}),
    getRequestSharePointBuckets: (requestId, requestNumber) => bucketsViaClient(client, requestId, requestNumber),
  });
  const okBody = (label, response) => {
    if (!response?.ok) throw new Error(`${label} failed (${response?.status ?? 'no status'}).`);
    return response.body || {};
  };
  const select = [
    'akoya_requestid', 'akoya_requestnum', 'akoya_requesttype', 'akoya_purpose',
    'akoya_request', 'akoya_fiscalyear', 'wmkf_meetingdate', 'versionnumber',
  ].join(',');
  return withDalContext('admin-run-service:export-source', () => exportTestRequestSourceBundle({
    sourceRequestNumber,
    dataverseHost: new URL(resourceUrl).hostname,
    exportedAt,
  }, {
    readSourceRow: async (requestNumber) => {
      const filter = encodeURIComponent(`akoya_requestnum eq '${requestNumber}'`);
      const body = okBody('source Request lookup', await client.get(`/akoya_requests?$select=${select}&$filter=${filter}&$top=2`));
      const rows = body.value || [];
      // Not found and ambiguous are the admin's to fix: answer them by name, not as the generic 500.
      // requireUniqueSourceRequest stays as is (the CLI uses it); it still validates the row.
      if (rows.length === 0) throw refuse('No Request has that number.', 404, 'factory_source_not_found');
      if (rows.length > 1 || body['@odata.nextLink']) throw refuse('More than one Request has that number.', 409, 'factory_source_ambiguous');
      requireUniqueSourceRequest(rows, false);
      return rows[0];
    },
    discoverDocuments: (source) => adminPreview.discoverTestRequestSourceDocuments(source, dependencies),
    assertReadLimits: adminPreview.assertTestRequestSourceReadLimits,
    hydrateDocument: (document) => {
      assertTime();
      return adminPreview.hydrateTestRequestSourceDocument(document, dependencies);
    },
    getDriveId: dependencies.getDriveId,
    getFileMetadataById: dependencies.getFileMetadataById,
    readSourceRevision: async (requestId) => {
      const body = okBody('source Request revalidation', await client.get(`/akoya_requests(${requestId})?$select=akoya_requestid,versionnumber`));
      return body.versionnumber == null ? null : String(body.versionnumber);
    },
  }));
}

/**
 * Maps a status runner refusal to the form's answer: `{ handled, value }` for the
 * "check again" states (the route answers 202), a ServiceHttpError for the rest.
 * Anything unlisted is returned unchanged, so it becomes the generic 500. Never forwards upstream error text.
 */
function statusOutcome(error, runId) {
  const code = error?.code;
  if (code === '23505') return refuse('Another status change on this run is already open; reload.', 409, 'status_change_open');
  if (code === 'status_change_jobs_open') {
    return { handled: true, value: { outcome: 'jobs_open', code, message: 'The change was written. Background jobs on the Request are still finishing; check again.', changeId: error.changeId } };
  }
  if (code === 'status_change_in_progress') {
    return {
      handled: true,
      value: {
        outcome: 'in_progress', code,
        message: 'This change is being sent, or was sent and its result is not yet known. Do not retry. If it never resolves, the owner closes it from the CLI after establishing that no sender is still running.',
        changeId: error.changeId, abandonCommand: abandonCommandFor(runId, error.changeId),
      },
    };
  }
  if (code === 'status_change_ambiguous') {
    return {
      handled: true,
      value: { outcome: 'unconfirmed', code, message: 'The change was sent but its result could not be read. Check again; do not start a different change.', changeId: error.changeId },
    };
  }
  if (code === 'status_change_replay') return refuse(STATUS_REPLAY_MESSAGE, 409, code);
  if (STATUS_RUNNER_REFUSALS.has(code)) return refuse(error.message, 409, code);
  return error;
}

export function createAdminRunService(deps = {}) {
  const env = deps.env ?? process.env;
  const dataverseClient = () => {
    // CJS module; loaded lazily so injecting both functions needs no Dataverse env.
    if (deps.createClient && deps.getAccessToken) return { createClient: deps.createClient, getAccessToken: deps.getAccessToken };
    const real = require('../../dataverse/client.js');
    return { createClient: deps.createClient ?? real.createClient, getAccessToken: deps.getAccessToken ?? real.getAccessToken };
  };
  const ledgerDbFactory = deps.ledgerDbFactory ?? pgLedgerDb;
  const schemaCheck = deps.schemaCheck ?? ledgerSchemaCheck;
  const graphContext = deps.graphContext ?? defaultGraphContext;
  const now = deps.now ?? (() => Date.now());
  const runPreflight = deps.runPreflight ?? defaultRunPreflight;
  const advanceOne = deps.advanceRun ?? advanceRun;
  const runStatus = deps.runStatusChange ?? defaultRunStatusChange;
  const recheckStatus = deps.recheckStatusChange ?? defaultRecheckStatusChange;
  const readLiveOptions = deps.readLiveOptions ?? defaultReadLiveOptions;
  const readCurrentStatus = deps.readCurrentStatus ?? defaultReadCurrentStatus;
  const readCast = deps.readCast ?? defaultReadCast;
  const resolveProgramDirector = deps.resolveProgramDirector ?? defaultResolveProgramDirector;
  const store = createFactoryArtifactStore({ env, blob: deps.blob ?? null });

  // Cooperative deadline (brief decision 5): a checkpoint refuses to start work
  // that cannot finish; it never cancels in-flight work. No deadlineAt, no check.
  function assertTime(deadlineAt, minRemainingMs = 0) {
    if (deadlineAt == null) return;
    if (now() + minRemainingMs > deadlineAt) {
      throw refuse('There was not enough time left to start this safely. Nothing was started; try again.', 504, 'factory_deadline_exceeded');
    }
  }

  const currentTarget = () => targetFromDeployment(deps.deployment ?? classifyDeployment());

  function actorFor(profileId) {
    try {
      return deriveActorId(profileId);
    } catch {
      throw refuse('A signed-in staff profile is required.', 403, 'factory_profile_required');
    }
  }

  function requireWritable() {
    if (!factoryFormEnabled(env)) throw refuse('The test request form is switched off.', 503, 'factory_form_disabled');
  }

  // Production runs bind the synthetic cast; both marker waves must be live
  // on the serving deployment (plan 2e). Off production there is no requirement.
  function assertIsolation(target) {
    if (target !== 'production') return;
    if (!testRequestIsolationEnabled(env) || !syntheticReviewerIsolationEnabled(env)) {
      throw refuse('Test request isolation is not switched on for this deployment.', 503, 'factory_isolation_off');
    }
  }

  // Never let the registry's fallback to the production variable be reached
  // for a sandbox target (plan 2d / brief decision 5).
  function ledgerUrlFor(target) {
    if (target === 'sandbox' && !env.TEST_REQUEST_SANDBOX_LEDGER_URL) {
      throw refuse('The sandbox ledger is not configured for this deployment.', 503, 'factory_ledger_unconfigured');
    }
    try {
      return requireLedgerUrl(target, env);
    } catch (error) {
      throw refuse(error.message, 503, 'factory_ledger_unconfigured');
    }
  }

  // Opens the pool, uses it, ends it in `finally` on every path.
  async function withLedger(target, fn) {
    const ledgerUrl = ledgerUrlFor(target);
    const db = ledgerDbFactory(ledgerUrl, { pool: POOL });
    try {
      return await fn({ db, ledger: createRunLedger(db), ledgerUrl });
    } finally {
      await db.end();
    }
  }

  async function loadOwnedRun(ledger, actorId, runId) {
    if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
      throw refuse('Run not found.', 404, 'factory_run_not_found');
    }
    const run = await ledger.getRun(runId.toLowerCase());
    if (!run || run.actorId !== actorId) throw refuse('Run not found.', 404, 'factory_run_not_found');
    return run;
  }

  async function writeClient(target) {
    const { createClient, getAccessToken } = dataverseClient();
    const resourceUrl = TARGET_URLS[target];
    return createClient({ resourceUrl, token: await getAccessToken(resourceUrl), allowTestRequestMarkerWrites: true });
  }

  async function readClient(target) {
    const { createClient, getAccessToken } = dataverseClient();
    const resourceUrl = TARGET_URLS[target];
    return createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  }

  function assertProductionRun(run, what) {
    if (run.destinationEnvironment !== 'production') throw refuse(`Only a production run can ${what}.`, 409, 'factory_run_not_production');
  }

  return {
    async exportSource({ profileId, sourceRequestNumber, deadlineAt }) {
      requireWritable();
      const actorId = actorFor(profileId);
      const target = currentTarget();
      if (!/^\d{1,10}$/.test(String(sourceRequestNumber ?? ''))) {
        throw refuse('Source Request number must be bounded digits.', 400, 'factory_invalid_input');
      }
      const exportBundle = deps.exportBundle
        ?? ((args) => defaultExportBundle(args, { ...dataverseClient(), sourceDependencies: deps.sourceDependencies ?? null }));
      assertTime(deadlineAt);
      const bundle = await exportBundle({
        sourceRequestNumber: String(sourceRequestNumber),
        exportedAt: new Date(now()),
        assertTime: () => assertTime(deadlineAt),
      });
      assertTime(deadlineAt);
      const draftId = crypto.randomUUID();
      await store.putCreateOnly(store.draftPathname(target, actorId, draftId), bundle);
      let defaults = { fiscalYear: null, meetingDate: null };
      try {
        defaults = resolveCloneCycle(bundle.source.request, {});
      } catch {
        // A source without a usable cycle: the admin supplies both at Confirm.
      }
      return { draftId, summary: summarizeSourceBundle(bundle), defaults };
    },

    async confirmRun({
      profileId, actorEmail, draftId, idempotencyKey, confirmSourceRequestNumber, testLabel, fiscalYear, meetingDate, deadlineAt,
    }) {
      requireWritable();
      const actorId = actorFor(profileId);
      const target = currentTarget();
      assertIsolation(target);
      let ids;
      try {
        ids = deriveRunIds(actorId, idempotencyKey);
      } catch (error) {
        throw refuse(error.message, 400, 'factory_invalid_input');
      }
      const label = typeof testLabel === 'string' ? testLabel.trim() : '';
      if (label.length < 1 || label.length > MAX_LABEL_LENGTH) {
        throw refuse(`Label must be 1-${MAX_LABEL_LENGTH} characters.`, 400, 'factory_invalid_input');
      }
      if (target === 'production' && !EMAIL.test(String(actorEmail ?? '').trim())) {
        throw refuse('A signed-in staff email is required to name the program director.', 403, 'factory_actor_email_required');
      }
      const draftPath = store.draftPathname(target, actorId, draftId); // validates draftId

      return withLedger(target, async ({ ledger, ledgerUrl }) => {
        // Ledger first: the row is the only owner of a run. An existing row is
        // returned with no new freshness requirement.
        const existing = await ledger.getRun(ids.runId);
        if (existing) {
          if (existing.actorId !== actorId) throw refuse('Run not found.', 404, 'factory_run_not_found');
          // The typed confirmation (decision 2) applies to a retry too; the
          // stored row knows its own source number.
          if (existing.sourceRequestNumber !== String(confirmSourceRequestNumber ?? '')) {
            throw refuse(`The typed Request number does not match this run's source (${existing.sourceRequestNumber}).`, 400, 'factory_source_mismatch');
          }
          return { run: publicRun(existing), created: false };
        }

        const draft = await store.read(draftPath);
        if (!draft) throw refuse('The saved source is gone; re-export the source Request.', 410, 'factory_draft_missing');
        const bundle = readSourceBundle(draft.value);
        try {
          assertBundleFresh(bundle, now());
        } catch (error) {
          throw refuse(`${error.message}`, 409, 'factory_draft_stale');
        }
        const source = bundle.source.request;
        if (source.akoya_requestnum !== String(confirmSourceRequestNumber ?? '')) {
          throw refuse(`The typed Request number does not match the source (${source.akoya_requestnum}).`, 400, 'factory_source_mismatch');
        }

        const client = await writeClient(target);
        const { graph, sharePointTarget } = await graphContext();
        const preflight = await runPreflight(client, graph, sharePointTarget);
        if (source.akoya_requesttype !== preflight.grantOption.value) {
          throw refuse('Source Request must be a Grant Request matching the live Grant option.', 409, 'factory_source_not_grant');
        }
        let cycle;
        try {
          cycle = resolveCloneCycle(source, { fiscalYear, meetingDate });
        } catch {
          throw refuse('A valid fiscal year and meeting date are required for this source.', 400, 'factory_invalid_input');
        }

        // Director and cast are production-only: buildCloneManifest throws for either elsewhere.
        let programDirector = null;
        let cast = null;
        if (target === 'production') {
          programDirector = await resolveProgramDirector(client, actorEmail);
          const members = await readCast({
            client, ledger, environment: 'production', parentAccountId: preflight.foundation.accountid,
          });
          cast = {
            piContactId: members.pi.memberId,
            liaisonContactId: members.liaison.memberId,
            researchLeaderContactId: members.research_leader.memberId,
          };
        }
        const manifest = buildCloneManifest(preflight, {
          ...cycle, source, testLabel: label, bundle, recipe: 'basic', programDirector, ...(cast ? { cast } : {}), ids,
        });
        if (targetEnvironmentOf(manifest) !== target) throw refuse('Manifest target does not match this deployment.', 409, 'factory_target_mismatch');
        if (!isBundleManifest(manifest)) throw refuse('Only bundle (v4) manifests are supported.', 409, 'factory_manifest_unsupported');

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
          planDigest: computeRunPlanDigest({ manifest }),
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

        // Artifacts first, create-only, then the ledger row. Nothing here ever
        // deletes: a failed or ambiguous reserve leaves them for the sweep. The
        // manifest (which embeds the bundle) is sized before the first write so
        // an oversized pair never leaves a lone bundle behind.
        store.assertFits(store.runPathname(target, ids.runId, 'manifest'), manifest);
        assertTime(deadlineAt); // once, before the first run-path write; never between the three writes
        await store.putCreateOnly(store.runPathname(target, ids.runId, 'bundle'), bundle);
        await store.putCreateOnly(store.runPathname(target, ids.runId, 'manifest'), manifest);
        await schemaCheck(ledgerUrl, { mode: 'reserve' });
        const { run, created } = await ledger.reserveRun({ actorId, idempotencyKey, plan });
        return { run: publicRun(run), created };
      });
    },

    async advance({ profileId, runId, deadlineAt }) {
      requireWritable();
      const actorId = actorFor(profileId);
      const target = currentTarget();
      return withLedger(target, async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        if (run.status === 'ready') {
          return {
            outcome: 'ready', step: run.currentStep, currentStep: run.currentStep, stepIndex: run.stepIndex, status: run.status, destinationRequestNumber: run.destinationRequestNumber ?? null,
          };
        }
        if (!RESUMABLE.has(run.status)) {
          return {
            outcome: 'not_advanced', step: run.currentStep, currentStep: run.currentStep, stepIndex: run.stepIndex, status: run.status, destinationRequestNumber: run.destinationRequestNumber ?? null,
          };
        }
        assertIsolation(target);
        const manifestDoc = await store.read(store.runPathname(target, run.runId, 'manifest'));
        const bundleDoc = await store.read(store.runPathname(target, run.runId, 'bundle'), { expectedSha256: run.bundleSha256 });
        if (!manifestDoc || !bundleDoc) {
          throw refuse(
            `The stored artifacts for run ${run.runId} are missing; recovery is required (do not re-export). Use the owner CLI with the downloaded files.`,
            409,
            'factory_recovery_required',
          );
        }
        const manifest = manifestDoc.value;
        if (targetEnvironmentOf(manifest) !== target) throw refuse('Manifest target does not match this deployment.', 409, 'factory_target_mismatch');
        const bundle = readSourceBundle(bundleDoc.value);
        const client = await writeClient(target);
        const { graph, sharePointTarget } = await graphContext();
        assertTime(deadlineAt, MIN_STEP_BUDGET_MS); // never inside a step
        const result = await advanceOne({
          runId: run.runId,
          ledger,
          manifest,
          bundle,
          deps: { client, graph, sharePointTarget },
          options: { leaseSeconds: recipeLeaseSeconds(manifest.recipe ?? 'basic') },
        });
        return {
          step: result.step,
          outcome: result.outcome,
          currentStep: result.run?.currentStep ?? null,
          stepIndex: result.run?.stepIndex ?? null,
          status: result.run?.status ?? null,
          destinationRequestNumber: result.run?.destinationRequestNumber ?? null,
          errorMessage: result.errorMessage ?? null,
        };
      });
    },

    // Read entry point (never behind the write switch): the form needs the switch and the target to say why it is disabled.
    async listRuns({ profileId }) {
      const actorId = actorFor(profileId);
      const target = currentTarget();
      return withLedger(target, async ({ ledger }) => ({
        runs: (await ledger.listRuns({ actorId })).map(publicRun),
        formEnabled: factoryFormEnabled(env),
        target,
      }));
    },

    async inspectRun({ profileId, runId }) {
      const actorId = actorFor(profileId);
      return withLedger(currentTarget(), async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        const resources = await ledger.listRunResources(run.runId);
        const baseline = resources.find((row) => row.step === 'fence_source' && row.resourceKind === 'foundation_transition');
        return { run: publicRun(run), resources, foundationCapturedAt: baseline?.plannedIdentity?.capturedAt ?? null };
      });
    },

    async readArtifacts({ profileId, runId }) {
      const actorId = actorFor(profileId);
      const target = currentTarget();
      return withLedger(target, async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        const manifestDoc = await store.read(store.runPathname(target, run.runId, 'manifest'));
        const bundleDoc = await store.read(store.runPathname(target, run.runId, 'bundle'), { expectedSha256: run.bundleSha256 });
        if (!manifestDoc || !bundleDoc) {
          if (run.status === 'ready') return { runId: run.runId, cleanedUp: true, manifest: null, bundle: null };
          throw refuse(`The stored artifacts for run ${run.runId} are missing.`, 404, 'factory_artifacts_missing');
        }
        return {
          runId: run.runId, cleanedUp: false, manifest: manifestDoc.value, bundle: bundleDoc.value,
        };
      });
    },

    async recheck({ profileId, runId }) {
      const actorId = actorFor(profileId);
      const target = currentTarget();
      return withLedger(target, async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        if (run.destinationEnvironment !== 'production') throw refuse('Only a production run can be rechecked.', 409, 'factory_run_not_production');
        const resources = await ledger.listRunResources(run.runId);
        const client = await readClient(target);
        const { failures, outcome } = await recheckFoundationTransition({
          client, organizationId: run.expectedOrganizationId, resources,
        });
        return {
          runId: run.runId, status: run.status, ok: failures.length === 0, outcome, failures,
        };
      });
    },

    async statusOptions({ profileId, runId }) {
      const actorId = actorFor(profileId);
      const target = currentTarget();
      return withLedger(target, async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        assertProductionRun(run, 'set a status');
        const client = await readClient(target);
        const phase1 = await readLiveOptions(client, fieldFor('phase1'));
        const phase2 = await readLiveOptions(client, fieldFor('phase2'));
        // Only a ready run has a Request whose status can be read or changed.
        const current = run.status === 'ready' ? await readCurrentStatus(client, run.destinationRequestId) : null;
        return {
          runId: run.runId, runStatus: run.status, options: { phase1, phase2 }, current, changes: await ledger.listStatusChanges(run.runId),
        };
      });
    },

    // One fenced If-Match PATCH per change, ever (status-change-runner.js). `rerun` is never passed:
    // repeating a payment- or tracking-producing change needs the owner CLI.
    async changeStatus({ profileId, runId, field, optionLabel, deadlineAt }) {
      requireWritable();
      const actorId = actorFor(profileId);
      const target = currentTarget();
      assertIsolation(target);
      if (field !== 'phase1' && field !== 'phase2') throw refuse('field must be phase1 or phase2.', 400, 'factory_invalid_input');
      if (typeof optionLabel !== 'string' || !optionLabel.trim()) throw refuse('optionLabel is required.', 400, 'factory_invalid_input');
      return withLedger(target, async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        assertProductionRun(run, 'set a status');
        if (run.status !== 'ready') throw refuse(`Run is ${run.status}; only a ready run's Request can change status.`, 409, 'factory_run_not_ready');
        assertTime(deadlineAt, MIN_STATUS_BUDGET_MS);
        const client = await readClient(target);
        const completion = { now, ...(deadlineAt == null ? {} : { deadlineAt: deadlineAt - STATUS_WAIT_MARGIN_MS }), ...(deps.statusCompletion ?? {}) };
        try {
          const result = await runStatus({ client, ledger, runId: run.runId, field: fieldFor(field), optionLabel, completion });
          return { outcome: 'complete', ...result };
        } catch (error) {
          const mapped = statusOutcome(error, run.runId);
          if (mapped?.handled) return mapped.value;
          throw mapped;
        }
      });
    },

    // Writes the ledger journal only (late effects); never Dataverse.
    async statusRecheck({ profileId, runId }) {
      requireWritable();
      const actorId = actorFor(profileId);
      const target = currentTarget();
      return withLedger(target, async ({ ledger }) => {
        const run = await loadOwnedRun(ledger, actorId, runId);
        assertProductionRun(run, 'recheck a status');
        const client = await readClient(target);
        try {
          return await recheckStatus({ client, ledger, runId: run.runId });
        } catch (error) {
          if (error?.code === 'status_change_refused') throw refuse(error.message, 409, error.code);
          throw error;
        }
      });
    },
  };
}
