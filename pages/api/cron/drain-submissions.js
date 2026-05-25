/**
 * GET /api/cron/drain-submissions
 *
 * Applicant intake portal — submission-jobs drain. Vercel cron at
 * every 2 minutes (registered in vercel.json — see crons[] entry). One tick claims up to
 * DRAIN_BATCH_SIZE jobs via the two-phase lease, then advances each
 * by exactly one state.
 *
 * State machine (drain plan v7 §6):
 *   queued
 *     → scanning              (attachments shape + scan_result='clean' for all)
 *     → request_created       (Dataverse Create akoya_request; capture akoya_requestnum)
 *     → files_moved           (Blob → SharePoint)
 *     → dynamics_patched      (budget-line POSTs only — persons children +
 *                              parent aggregate PATCH deferred; await Connor Q2)
 *     → status_flipped        (PATCH source picklist — Connor Q1)          [BUILD-PENDING]
 *     → completed             (clear draft; audit)                         [BUILD-PENDING]
 *
 * Terminal: failed, cancelled.
 *
 * Concurrency model:
 *   Phase 1 (claim): UPDATE with FOR UPDATE SKIP LOCKED + locked_until lease
 *                    + lease_token (UUID). Stable token; renewal mutates only
 *                    locked_until.
 *   Phase 2 (advance): one short txn per state transition (UPDATE +
 *                    intake_audit INSERT). All lease-guarded.
 *
 * What is implemented:
 *   - Cron auth (CRON_SECRET)
 *   - Two-phase claim + lease renewal helper
 *   - Error classifier dispatch (taxonomy → terminal/retry decision)
 *   - State handlers: queued→scanning, scanning→request_created,
 *     request_created→files_moved, files_moved→dynamics_patched
 *   - Duplicate-PK recovery in request_created (Codex round-3 §2, round-7 §1)
 *   - Transactional state-transition+audit (Codex round-6 §4)
 *
 * BUILD-PENDING (later sessions) — see BUILD_PENDING_STATES below:
 *   - dynamics_patched → status_flipped (awaits Connor Q1)
 *   - status_flipped → completed (draft cleanup)
 *
 * When the drain encounters a job whose current status is in
 * BUILD_PENDING_STATES, it pushes next_attempt_at out by 1 hour and
 * writes a system_alerts row, but does NOT terminal-fail the row. This
 * keeps in-flight test submissions recoverable when the next state
 * handler ships.
 */

import crypto from 'crypto';
import pkg from 'pg';
import { get as blobGet } from '@vercel/blob';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { GraphService } from '../../../lib/services/graph-service';
import { classify } from '../../../lib/utils/drain-error-classifier';
import { buildNoResponseError } from '../../../lib/utils/service-error';
import IntakeAuditService from '../../../lib/services/intake-audit-service';
import AlertService from '../../../lib/services/alert-service';
import { validateAttachmentShape, validateAttachmentSet } from '../../../lib/utils/intake-attachment-shape';
import {
  requestFolderName,
  isAlreadyWritten,
  guessContentType,
} from '../../../lib/utils/drain-files-moved-helpers';
import {
  validateBudgetLineRow,
  buildBudgetLinePayload,
} from '../../../lib/utils/intake-budget-line-payload';

const { Pool } = pkg;

// ---------- config ----------

const DRAIN_BATCH_SIZE = parseInt(process.env.DRAIN_BATCH_SIZE || '5', 10);
const DRAIN_LOCK_TTL_SECONDS = parseInt(process.env.DRAIN_LOCK_TTL_SECONDS || '600', 10);
const DRAIN_MAX_ATTEMPTS_DEFAULT = parseInt(process.env.DRAIN_MAX_ATTEMPTS || '10', 10);

const ADVANCED_STATES = new Set([
  'request_created', 'files_moved', 'dynamics_patched',
  'status_flipped', 'completed',
]);

const BUILD_PENDING_STATES = new Set(['dynamics_patched', 'status_flipped']);

// SharePoint destination — applicant uploads parallel the Reviewer_Uploads
// convention (review-upload.js:128). Library is the akoya_request library
// (allowlisted in graph-service.js); folder layout is
// `{akoya_requestnum}_{requestGuid-no-hyphens-upper}/Applicant_Uploads/`.
const SHAREPOINT_LIBRARY = 'akoya_request';
const APPLICANT_UPLOADS_SUBFOLDER = 'Applicant_Uploads';
// requestFolderName / isAlreadyWritten / guessContentType live in
// lib/utils/drain-files-moved-helpers.js so they're unit-testable without
// pulling in the pg module (which doesn't load in the jsdom test env).

// (validateAttachmentShape imported from lib/utils/intake-attachment-shape.js
//  — shared with /api/intake/submit so the contract has a single source of truth.)

// ---------- pg pool (module-scoped — survives across cron ticks) ----------

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('POSTGRES_URL not configured');
  _pool = new Pool({ connectionString, max: 5 });
  return _pool;
}

// ---------- claim / lease helpers ----------

/**
 * Phase 1: claim up to N ready rows. Sets locked_until + fresh lease_token.
 * Returns the claimed rows (post-update snapshot).
 */
async function claimBatch(client, batchSize) {
  const result = await client.query(
    `WITH claimable AS (
       SELECT id
         FROM submission_jobs
        WHERE status NOT IN ('completed', 'failed', 'cancelled')
          AND next_attempt_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY next_attempt_at, created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE submission_jobs sj
        SET locked_until = now() + ($2 || ' seconds')::INTERVAL,
            lease_token = gen_random_uuid()
       FROM claimable
      WHERE sj.id = claimable.id
      RETURNING sj.*`,
    [batchSize, DRAIN_LOCK_TTL_SECONDS],
  );
  return result.rows;
}

/**
 * Lease renewal — bump locked_until without rotating lease_token. Guarded
 * by lease_token so a worker that lost the lease can't extend someone else's.
 */
async function renewLease(client, jobId, leaseToken) {
  await client.query(
    `UPDATE submission_jobs
        SET locked_until = now() + ($1 || ' seconds')::INTERVAL
      WHERE id = $2 AND lease_token = $3`,
    [DRAIN_LOCK_TTL_SECONDS, jobId, leaseToken],
  );
}

/**
 * Transactional state advance + audit (Codex round-6 §4). The pair lives in
 * ONE pg transaction; if either fails, both roll back and the row stays at
 * its prior state for next-tick retry. Returns true on advance, false if
 * the lease check failed (another worker re-claimed mid-process).
 *
 * @param {object} args
 * @param {number} args.jobId
 * @param {string} args.leaseToken
 * @param {string} args.toStatus
 * @param {string} args.action     — audit action label, e.g. 'drain.advance.scanning'
 * @param {object} args.payload    — sha256'd into audit
 * @param {object} [args.extra]    — additional columns to set on submission_jobs
 *                                   { akoya_requestnum?, sharepoint_paths?, dynamics_patches?,
 *                                     last_error?, completed_at?, clear_lock? }
 */
async function advanceState(client, args) {
  const { jobId, leaseToken, toStatus, action, payload, extra = {} } = args;

  // Compose SET clause dynamically — keep the common fields canonical.
  const sets = ['status = $1'];
  const vals = [toStatus];
  let i = 2;

  if (extra.akoya_requestnum !== undefined) {
    sets.push(`akoya_requestnum = $${i++}`);
    vals.push(extra.akoya_requestnum);
  }
  if (extra.sharepoint_paths !== undefined) {
    sets.push(`sharepoint_paths = $${i++}::jsonb`);
    vals.push(JSON.stringify(extra.sharepoint_paths));
  }
  if (extra.dynamics_patches !== undefined) {
    sets.push(`dynamics_patches = $${i++}::jsonb`);
    vals.push(JSON.stringify(extra.dynamics_patches));
  }
  if (extra.last_error !== undefined) {
    sets.push(`last_error = $${i++}`);
    vals.push(extra.last_error);
  }
  if (extra.completed_at !== undefined) {
    sets.push(`completed_at = $${i++}`);
    vals.push(extra.completed_at);
  }
  // Clear the lease on advance unless explicitly told otherwise (e.g., the
  // drain keeps the lease across BUILD_PENDING parking to discourage other
  // ticks from spinning).
  if (extra.clear_lock !== false) {
    sets.push('locked_until = NULL', 'lease_token = NULL');
  }

  // Lease check is part of the same UPDATE — atomic guard.
  vals.push(jobId, leaseToken);
  const query = `
    UPDATE submission_jobs
       SET ${sets.join(', ')}
     WHERE id = $${i++} AND lease_token = $${i}
  `;

  try {
    await client.query('BEGIN');
    const updRes = await client.query(query, vals);
    if (updRes.rowCount === 0) {
      // Lost lease — another worker re-claimed. Don't write audit; roll back.
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO intake_audit (actor_type, action, target_entity, target_id, payload_digest)
       VALUES ('system', $1, 'submission_jobs', $2,
               encode(digest($3, 'sha256'), 'hex'))`,
      [action, String(jobId), JSON.stringify(payload ?? {})],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Failure path: bump attempts, set next_attempt_at, record last_error.
 * Does NOT change status (unless terminal). Audit-paired.
 */
async function recordFailure(client, { jobId, leaseToken, category, errorMessage, terminal, retryable }) {
  const backoffSeconds = terminal ? 0 : Math.min(60 * Math.pow(2, 0), 3600); // simple v1; refined later
  // Note: real exponential backoff key off attempts; we read it back below.

  try {
    await client.query('BEGIN');

    const newStatus = terminal ? 'failed' : null;
    const sets = ['attempts = submission_jobs.attempts + 1', 'last_error = $1'];
    const vals = [`[${category}] ${errorMessage}`];
    let i = 2;

    if (newStatus) {
      sets.push(`status = $${i++}`, `completed_at = now()`);
      vals.push(newStatus);
    } else if (retryable) {
      sets.push(`next_attempt_at = now() + ($${i++} || ' seconds')::INTERVAL`);
      vals.push(backoffSeconds);
    }
    sets.push('locked_until = NULL', 'lease_token = NULL');
    vals.push(jobId, leaseToken);

    const updRes = await client.query(
      `UPDATE submission_jobs SET ${sets.join(', ')} WHERE id = $${i++} AND lease_token = $${i}`,
      vals,
    );
    if (updRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO intake_audit (actor_type, action, target_entity, target_id, payload_digest)
       VALUES ('system', 'drain.error', 'submission_jobs', $1,
               encode(digest($2, 'sha256'), 'hex'))`,
      [String(jobId), JSON.stringify({ category, message: errorMessage })],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ---------- state handlers ----------

/**
 * queued → scanning. Re-validate attachment shape and the all-clean
 * invariant. The validator at submit-entry already passed; getting here
 * means corruption / hand-editing / regression — terminal-fail and alert
 * (Codex round-7 §4).
 */
async function handleQueued(client, job) {
  const payload = job.payload ?? {};
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  try {
    attachments.forEach(validateAttachmentShape);
    validateAttachmentSet(attachments); // Codex round-13 Q5 — filename uniqueness
  } catch (err) {
    // Terminal-fail + system_alerts
    await AlertService.createAlert({
      type: 'intake_drain_corruption',
      severity: 'error',
      title: `Drain: malformed attachment in job ${job.id}`,
      message: err.message,
      source: 'drain-submissions',
      metadata: { jobId: job.id, requestId: job.request_id },
    }).catch(() => {});
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: 'validation_400',
      errorMessage: `attachment-shape: ${err.message}`,
      terminal: true,
      retryable: false,
    });
  }

  const unclean = attachments.filter((a) => a.scan_result !== 'clean');
  if (unclean.length) {
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: 'scan_infected',
      errorMessage: `unclean attachments: ${unclean.length}`,
      terminal: true,
      retryable: false,
    });
  }

  return await advanceState(client, {
    jobId: job.id,
    leaseToken: job.lease_token,
    toStatus: 'scanning',
    action: 'drain.advance.scanning',
    payload: { attachmentCount: attachments.length },
  });
}

/**
 * scanning → request_created. POST akoya_request to Dataverse with our
 * pre-generated GUID (job.request_id). Capture akoya_requestnum from
 * the Prefer: return=representation response. Recover from duplicate_pk
 * via the read-back path (Codex round-3 §2, round-7 §1).
 */
async function handleScanning(client, job) {
  const payload = job.payload ?? {};
  const draftJson = payload.draft_json ?? {};

  // Minimal Create payload — full field-mapping lands with the drain
  // build-out of this state. Required fields per drain plan §"Probe evidence":
  //   - akoya_requestid (our pre-generated GUID)
  //   - _akoya_account_value (institution lookup)
  // Q2 (PI/contact attribution) is open; for the skeleton we set what we know
  // and lean on the AkoyaGO OnCreate plugin defaults for the rest.
  const createBody = {
    akoya_requestid: job.request_id,
    'akoya_Account@odata.bind': `/accounts(${job.account_id})`,
    // form_key drives downstream stage selection; persist on the request for
    // operator visibility. Field name is a placeholder pending Connor Q1.
    // wmkf_formkey: payload.form_key,
    ...(draftJson.dataverseFields ?? {}),
  };

  try {
    const created = await DynamicsService.createRecord('akoya_requests', createBody);
    const akoyaRequestnum = created?.akoya_requestnum;
    if (!akoyaRequestnum) {
      // Shouldn't happen — akoya_requestnum is server-autonumber. Treat as fatal.
      return await recordFailure(client, {
        jobId: job.id,
        leaseToken: job.lease_token,
        category: 'validation_400',
        errorMessage: `request_created: akoya_requestnum missing from Create response (request_id=${job.request_id})`,
        terminal: true,
        retryable: false,
      });
    }
    return await advanceState(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      toStatus: 'request_created',
      action: 'drain.advance.request_created',
      payload: { akoyaRequestnum, requestId: job.request_id },
      extra: { akoya_requestnum: akoyaRequestnum },
    });
  } catch (err) {
    const cls = classify(err);
    if (cls.category === 'duplicate_pk') {
      // Recovery: prior tick created the row but crashed before writing PG.
      // Read back akoya_requestnum via GET, then advance.
      return await recoverRequestCreated(client, job, err);
    }
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: cls.category,
      errorMessage: err.message,
      terminal: !cls.retryable,
      retryable: cls.retryable,
    });
  }
}

/**
 * Duplicate-PK recovery in request_created (drain plan v7 §6 + Codex
 * round-3 §2, round-7 §1). The row exists in Dataverse from a prior tick;
 * read back akoya_requestnum and advance. Accept any state >=
 * request_created (another worker may have advanced further).
 */
async function recoverRequestCreated(client, job, originalError) {
  let existing;
  try {
    existing = await DynamicsService.getRecord(
      'akoya_requests',
      job.request_id,
      { select: 'akoya_requestnum' },
    );
  } catch (err) {
    const cls = classify(err);
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: cls.category,
      errorMessage: `request_created recovery getRecord failed: ${err.message}`,
      terminal: !cls.retryable,
      retryable: cls.retryable,
    });
  }
  if (!existing?.akoya_requestnum) {
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: 'validation_400',
      errorMessage: `request_created recovery: row exists but akoya_requestnum missing for ${job.request_id}`,
      terminal: true,
      retryable: false,
    });
  }

  const advanced = await advanceState(client, {
    jobId: job.id,
    leaseToken: job.lease_token,
    toStatus: 'request_created',
    action: 'drain.recover.request_created',
    payload: { akoyaRequestnum: existing.akoya_requestnum, requestId: job.request_id },
    extra: { akoya_requestnum: existing.akoya_requestnum },
  });

  if (!advanced) {
    // Lost lease. Re-read current row to distinguish safe vs. anomaly.
    const current = await client.query(
      `SELECT status, akoya_requestnum FROM submission_jobs WHERE id = $1`,
      [job.id],
    );
    const row = current.rows[0];
    if (row && ADVANCED_STATES.has(row.status) && row.akoya_requestnum) {
      // Another worker completed recovery and may have advanced further. Safe.
      return true;
    }
    // Truly stuck. Surface for diagnosis.
    await AlertService.createAlert({
      type: 'intake_drain_anomaly',
      severity: 'error',
      title: `Drain: lost lease but row not advanced (job ${job.id})`,
      message: `Job ${job.id} request_created recovery lost lease but status=${row?.status}`,
      source: 'drain-submissions',
      metadata: { jobId: job.id, requestId: job.request_id, originalError: originalError?.message },
    }).catch(() => {});
    return false;
  }
  return true;
}

/**
 * request_created → files_moved. For each attachment:
 *   1. Skip if already in sharepoint_paths (idempotency on retry).
 *   2. Download from the PRIVATE intake Blob store (INTAKE_BLOB_RW_TOKEN).
 *   3. Verify sha256 (defensive — blob content shouldn't change in-flight).
 *   4. Upload to SharePoint at akoya_request/{folder}/Applicant_Uploads/.
 *   5. Append to sharepoint_paths.
 * Lease is renewed before each external HTTP call (drain plan §"Lease
 * renewal trigger" item 1).
 */
async function handleRequestCreated(client, job) {
  const blobToken = process.env.INTAKE_BLOB_RW_TOKEN;
  if (!blobToken) {
    // Config bug — terminal-fail with the structured isTransient=false
    // marker so the classifier routes it correctly.
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: 'validation_400',
      errorMessage: 'INTAKE_BLOB_RW_TOKEN not configured — applicant attach store unreachable',
      terminal: true,
      retryable: false,
    });
  }
  if (!job.akoya_requestnum) {
    // Shouldn't happen — request_created always writes akoya_requestnum.
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: 'validation_400',
      errorMessage: `files_moved entered without akoya_requestnum (job ${job.id})`,
      terminal: true,
      retryable: false,
    });
  }

  const payload = job.payload ?? {};
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const folder = requestFolderName(job.akoya_requestnum, job.request_id);
  const folderPath = `${folder}/${APPLICANT_UPLOADS_SUBFOLDER}`;

  // Start from whatever the prior tick recorded, append as we go. JSONB merge
  // happens at advance time — we hand the FULL array to advanceState.
  const sharepointPaths = Array.isArray(job.sharepoint_paths) ? [...job.sharepoint_paths] : [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (isAlreadyWritten(sharepointPaths, att)) continue;

    // Lease renewal before each external call.
    await renewLease(client, job.id, job.lease_token);

    // 1. Download from private Blob store.
    let blobBuffer;
    let blobMeta;
    try {
      const result = await blobGet(att.pathname, {
        access: 'private', useCache: false, token: blobToken,
      });
      if (!result || !result.stream) {
        return await recordFailure(client, {
          jobId: job.id,
          leaseToken: job.lease_token,
          category: 'not_found_404',
          errorMessage: `files_moved: blob ${att.pathname} not found (expired or never written)`,
          terminal: true,
          retryable: false,
        });
      }
      blobMeta = result.blob || {};
      blobBuffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch (err) {
      // Most Blob get errors are no-response shaped; wrap defensively so the
      // classifier sees a structured network category and retries.
      const wrapped = err?.serviceName ? err : buildNoResponseError('blob', err);
      const cls = classify(wrapped);
      return await recordFailure(client, {
        jobId: job.id,
        leaseToken: job.lease_token,
        category: cls.category,
        errorMessage: `files_moved blobGet(${att.pathname}): ${err.message ?? err}`,
        terminal: !cls.retryable,
        retryable: cls.retryable,
      });
    }

    // 2. Defensive sha256 check.
    const actualSha = crypto.createHash('sha256').update(blobBuffer).digest('hex');
    if (actualSha.toLowerCase() !== att.sha256.toLowerCase()) {
      // Blob content drifted from what the applicant uploaded. Terminal
      // validation failure + alert (corruption-class — operator triage).
      await AlertService.createAlert({
        type: 'intake_drain_attachment_drift',
        severity: 'error',
        title: `Drain: attachment sha256 mismatch (job ${job.id})`,
        message: `${att.filename}: expected ${att.sha256}, got ${actualSha}`,
        source: 'drain-submissions',
        metadata: { jobId: job.id, requestId: job.request_id, pathname: att.pathname },
      }).catch(() => {});
      return await recordFailure(client, {
        jobId: job.id,
        leaseToken: job.lease_token,
        category: 'validation_400',
        errorMessage: `files_moved: sha256 mismatch on ${att.filename}`,
        terminal: true,
        retryable: false,
      });
    }

    // 3. Lease renewal before SharePoint upload.
    await renewLease(client, job.id, job.lease_token);

    // 4. Upload to SharePoint. graph-service.uploadFile throws via
    //    buildServiceError on non-2xx → classifier handles routing.
    let item;
    try {
      const contentType = att.contentType || blobMeta?.contentType || guessContentType(att.filename);
      item = await GraphService.uploadFile(
        SHAREPOINT_LIBRARY,
        folderPath,
        att.filename,
        blobBuffer,
        contentType,
      );
    } catch (err) {
      const cls = classify(err);
      return await recordFailure(client, {
        jobId: job.id,
        leaseToken: job.lease_token,
        category: cls.category,
        errorMessage: `files_moved uploadFile(${att.filename}): ${err.message ?? err}`,
        terminal: !cls.retryable,
        retryable: cls.retryable,
      });
    }

    sharepointPaths.push({
      filename: att.filename,
      sha256: att.sha256,
      size: att.size,
      library: SHAREPOINT_LIBRARY,
      folder: folderPath,
      item_id: item.id,
      web_url: item.webUrl,
      uploaded_at: new Date().toISOString(),
    });
  }

  return await advanceState(client, {
    jobId: job.id,
    leaseToken: job.lease_token,
    toStatus: 'files_moved',
    action: 'drain.advance.files_moved',
    payload: { fileCount: sharepointPaths.length, folder: folderPath },
    extra: { sharepoint_paths: sharepointPaths },
  });
}

/**
 * files_moved → dynamics_patched. POST each pre-gen budget-line GUID;
 * track written IDs in dynamics_patches.budget_lines so a mid-loop crash
 * doesn't re-POST on retry. Idempotency: pre-gen GUIDs + duplicate_pk →
 * success-advance per drain plan §"Per-state idempotency".
 *
 * Phase B step 2 scope: budget-lines only. Persons children (and parent
 * aggregate PATCH) are deferred to the next commit — persons need
 * Connor Q2 (PI/contact attribution) + a contact-resolution service.
 * Until then, this handler advances to dynamics_patched if no persons
 * are queued in payload.children.persons (the steady state for now).
 */
async function handleFilesMoved(client, job) {
  if (!job.request_id) {
    return await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: 'validation_400',
      errorMessage: `dynamics_patched entered without request_id (job ${job.id})`,
      terminal: true,
      retryable: false,
    });
  }

  const payload = job.payload ?? {};
  const children = payload.children ?? {};
  const budgetLines = Array.isArray(children.budget_lines) ? children.budget_lines : [];
  const persons = Array.isArray(children.persons) ? children.persons : [];

  // Persons not yet supported — if any are queued, park (don't drop on the
  // floor and silently advance). When the persons handler ships, the
  // unpark SQL (plan §"Phase B deploy handoff") wakes these rows back up.
  if (persons.length > 0) {
    await AlertService.createAlert({
      type: 'intake_drain_persons_pending',
      severity: 'warning',
      title: `Drain: persons handler not yet built (job ${job.id})`,
      message: `Job ${job.id} has ${persons.length} person rows queued; waiting on Connor Q2 + contact-resolution service.`,
      source: 'drain-submissions',
      autoResolveKey: 'drain-pending-persons',
      metadata: { jobId: job.id, personCount: persons.length, requestId: job.request_id },
    }).catch(() => {});
    await client.query(
      `UPDATE submission_jobs
          SET next_attempt_at = now() + INTERVAL '1 hour',
              locked_until = NULL,
              lease_token = NULL
        WHERE id = $1 AND lease_token = $2`,
      [job.id, job.lease_token],
    );
    return;
  }

  const patches = job.dynamics_patches ?? {};
  const writtenIds = new Set(Array.isArray(patches.budget_lines) ? patches.budget_lines : []);

  for (const row of budgetLines) {
    if (writtenIds.has(row.id)) continue;

    // Re-validate at drain-entry per drain plan §"Belt-and-suspenders".
    // Submit already validated, so any failure here means corruption /
    // hand-editing / regression — terminal_400 + alert (Codex round-7 §4 pattern).
    try {
      validateBudgetLineRow(row, budgetLines.indexOf(row));
    } catch (err) {
      await AlertService.createAlert({
        type: 'intake_drain_corruption',
        severity: 'error',
        title: `Drain: malformed budget_line in job ${job.id}`,
        message: err.message,
        source: 'drain-submissions',
        metadata: { jobId: job.id, requestId: job.request_id, rowId: row.id },
      }).catch(() => {});
      return await recordFailure(client, {
        jobId: job.id,
        leaseToken: job.lease_token,
        category: 'validation_400',
        errorMessage: `budget_line shape: ${err.message}`,
        terminal: true,
        retryable: false,
      });
    }

    await renewLease(client, job.id, job.lease_token);

    const body = buildBudgetLinePayload(row, job.request_id);
    try {
      await DynamicsService.createRecord('wmkf_proposalbudgetlines', body);
    } catch (err) {
      const cls = classify(err);
      if (cls.category === 'duplicate_pk') {
        // A prior tick already created this row — treat as success and
        // advance. We rely on the pre-gen GUID + Dataverse's PK violation;
        // no read-back needed because the row's data is fully reproducible
        // from the frozen payload.
        writtenIds.add(row.id);
        continue;
      }
      return await recordFailure(client, {
        jobId: job.id,
        leaseToken: job.lease_token,
        category: cls.category,
        errorMessage: `dynamics_patched budget_line POST (${row.id}): ${err.message ?? err}`,
        terminal: !cls.retryable,
        retryable: cls.retryable,
      });
    }
    writtenIds.add(row.id);
  }

  const updatedPatches = { ...patches, budget_lines: [...writtenIds] };

  return await advanceState(client, {
    jobId: job.id,
    leaseToken: job.lease_token,
    toStatus: 'dynamics_patched',
    action: 'drain.advance.dynamics_patched',
    payload: { budgetLineCount: budgetLines.length, personCount: persons.length },
    extra: { dynamics_patches: updatedPatches },
  });
}

/**
 * BUILD-PENDING handler — pushes next_attempt_at out by 1 hour to avoid
 * burning ticks while the next state's code is unimplemented. Leaves the
 * row at its current status. Alerts (deduped) so the parking is visible.
 */
async function parkBuildPending(client, job) {
  await AlertService.createAlert({
    type: 'intake_drain_build_pending',
    severity: 'warning',
    title: `Drain state ${job.status} unimplemented`,
    message: `Job ${job.id} parked — state ${job.status} not yet built`,
    source: 'drain-submissions',
    autoResolveKey: `drain-pending-${job.status}`,
    metadata: { jobId: job.id, state: job.status, requestId: job.request_id },
  }).catch(() => {});
  await client.query(
    `UPDATE submission_jobs
        SET next_attempt_at = now() + INTERVAL '1 hour',
            locked_until = NULL,
            lease_token = NULL
      WHERE id = $1 AND lease_token = $2`,
    [job.id, job.lease_token],
  );
}

// ---------- dispatcher ----------

const DISPATCH = {
  queued: handleQueued,
  scanning: handleScanning,
  request_created: handleRequestCreated,
  files_moved: handleFilesMoved,
  // BUILD-PENDING — dynamics_patched, status_flipped fall through to
  //                parkBuildPending fallback (dynamics_patched parks because
  //                persons + parent aggregates aren't built; status_flipped
  //                because it needs Connor Q1).
};

async function processJob(client, job) {
  if (BUILD_PENDING_STATES.has(job.status)) {
    return await parkBuildPending(client, job);
  }
  const handler = DISPATCH[job.status];
  if (!handler) {
    // Unknown status — leave lease in place to expire naturally; alert.
    await AlertService.createAlert({
      type: 'intake_drain_unknown_status',
      severity: 'error',
      title: `Drain: unknown status ${job.status}`,
      message: `Job ${job.id} in unrecognized status ${job.status}`,
      source: 'drain-submissions',
      metadata: { jobId: job.id, status: job.status },
    }).catch(() => {});
    return;
  }
  try {
    await handler(client, job);
  } catch (err) {
    // Last-resort safety net — any unhandled throw becomes a recorded failure.
    // The classifier sees the structured error and routes terminal/retry.
    const cls = classify(err);
    console.error('[drain] unhandled error in handler:', err);
    await recordFailure(client, {
      jobId: job.id,
      leaseToken: job.lease_token,
      category: cls.category,
      errorMessage: err.message,
      terminal: !cls.retryable,
      retryable: cls.retryable,
    }).catch((auditErr) => {
      console.error('[drain] recordFailure itself failed:', auditErr);
    });
  }
}

// ---------- handler ----------

/**
 * Strict CRON_SECRET check — no NODE_ENV=development bypass.
 *
 * Codex round-12 Q5: the shared `verifyCronSecret` bypasses auth entirely
 * in dev mode (cron-auth.js:24). For routes that just write monitoring
 * rows (health-check / spend-check / etc.) that's acceptable; this route
 * advances real state machine rows and will, in Phase B, write to
 * Dataverse + SharePoint. A developer pointing .env.local at prod-shaped
 * connection strings could mutate prod data with an unauthenticated GET.
 *
 * For dev testing of this route, set CRON_SECRET in .env.local and call
 * with the matching Bearer header — same shape as production.
 */
function verifyDrainCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[drain] CRON_SECRET not configured');
    res.status(500).json({ error: 'CRON_SECRET not configured' });
    return false;
  }
  const got = req.headers.authorization;
  if (got !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!verifyDrainCronSecret(req, res)) return;

  const pool = getPool();
  const client = await pool.connect();
  const stats = { claimed: 0, processed: 0, errors: 0 };
  const startedAt = Date.now();

  try {
    const claimed = await claimBatch(client, DRAIN_BATCH_SIZE);
    stats.claimed = claimed.length;

    for (const job of claimed) {
      try {
        await processJob(client, job);
        stats.processed += 1;
      } catch (err) {
        stats.errors += 1;
        console.error('[drain] processJob failed:', err);
      }
    }
  } catch (err) {
    console.error('[drain] fatal:', err);
    client.release();
    return res.status(500).json({ error: 'drain fatal', message: err.message });
  }

  client.release();
  const elapsedMs = Date.now() - startedAt;
  return res.status(200).json({ ok: true, ...stats, elapsedMs });
}

// Test hooks — exposed so unit tests can probe without going through the cron.
export const _testing = {
  validateAttachmentShape,
  validateAttachmentSet,
  classify,
  claimBatch,
  advanceState,
  recordFailure,
  handleQueued,
  handleScanning,
  handleRequestCreated,
  handleFilesMoved,
  recoverRequestCreated,
  parkBuildPending,
  isAlreadyWritten,
  requestFolderName,
  guessContentType,
  validateBudgetLineRow,
  buildBudgetLinePayload,
  ADVANCED_STATES,
  BUILD_PENDING_STATES,
};
