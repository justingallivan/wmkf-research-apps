/**
 * MaintenanceService - Database and blob cleanup operations
 *
 * Provides batch-delete for unbounded tables (api_usage_log, dynamics_query_log),
 * expired cache cleanup, orphaned blob cleanup, and audit trail for all runs.
 *
 * Retention periods are configurable via Dataverse `wmkf_appsystemsettings`
 * (read through the settings-service dispatcher).
 */

const { sql } = require('@vercel/postgres');
const { list, del } = require('@vercel/blob');
const { DatabaseService } = require('./database-service');
const { listSettings } = require('./settings-service');
const { DynamicsService } = require('./dynamics-service');
const { bypassDynamicsRestrictions } = require('./dynamics-context');
const grantRequestAdapter = require('../dataverse/adapters/grant-request');
const grantCycleAdapter = require('../dataverse/adapters/grant-cycle');
const IntakeDraftService = require('./intake-draft-service');
const IntakeAuditService = require('./intake-audit-service');
const { getIntakeBlobToken } = require('../utils/intake-blob');
const { isPrivateCycleMaterialPathname } = require('../utils/cycle-material-ref');

// Heuristic: Vercel Blob `del()` raises throws of an underspecified
// shape on non-2xx. Treat status===404 or message containing 'not found'
// or '404' as a missing-blob success (the bytes may have never been
// PUT in the first place). False negatives only cost a counted error
// + log line; no data corruption risk.
function isBlobNotFound(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('404');
}

class MaintenanceService {
  // ============================================
  // CLEANUP OPERATIONS
  // ============================================

  /**
   * Delete api_usage_log records older than retentionDays.
   * Uses batch delete to avoid long-running transactions.
   */
  static async cleanupUsageLog(retentionDays = 90) {
    try {
      const result = await sql`
        DELETE FROM api_usage_log
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupUsageLog error:', error.message);
      throw error;
    }
  }

  /**
   * Delete dynamics_query_log records older than retentionDays
   */
  static async cleanupQueryLog(retentionDays = 365) {
    try {
      const result = await sql`
        DELETE FROM dynamics_query_log
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupQueryLog error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up expired search cache entries
   */
  static async cleanupExpiredCache() {
    try {
      return await DatabaseService.cleanupExpiredCache();
    } catch (error) {
      console.error('MaintenanceService.cleanupExpiredCache error:', error.message);
      throw error;
    }
  }

  /**
   * Delete intake_audit records older than retentionDays (S187 #11).
   *
   * Default 730d (2y) — forensic-grade trail for applicant-facing data
   * across multi-year grant lifecycles. Payloads are sha256-hashed (no PII
   * content), so storage cost is bounded; the long retention is for
   * dispute/forensic posture, not legal compliance (pilot scope is internal
   * U.S.-only, no HIPAA/GDPR/FERPA). Configurable via
   * wmkf_appsystemsettings.retention:intake_audit_days.
   */
  static async cleanupIntakeAudit(retentionDays = 730) {
    try {
      const result = await sql`
        DELETE FROM intake_audit
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupIntakeAudit error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up BILL.com webhook dedup rows beyond the TTL.
   *
   * Default 7d (comfortably exceeds any plausible BILL retry horizon — BILL
   * documents exponential backoff before auto-disabling a subscription, but
   * not a concrete max retry window). The dedup table is small (~hundreds of
   * rows/cycle); the cleanup mainly keeps the index lean. See
   * `lib/db/migrations/015_bill_webhook_events.sql`.
   */
  static async cleanupBillWebhookEvents(retentionDays = 7) {
    try {
      const result = await sql`
        DELETE FROM bill_webhook_events
        WHERE received_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupBillWebhookEvents error:', error.message);
      throw error;
    }
  }

  /**
   * Resume torn BILL honorarium onboardings (chunk-4 hardening, Fix #3).
   *
   * The onboarding orchestrator marks a `bill_onboarding_state` row
   * `dynamics_pending = true` when the BILL side succeeded but the final
   * `akoya_request` writeback PATCH failed (after its inline retries). This
   * sweep retries that PATCH idempotently:
   *   pending_match = true  → write PNI + wmkf_exisitngbillcomaccount "Yes"
   *   pending_match = false → write "No"
   *   pending_match IS NULL → FAIL CLOSED (a malformed marker must never
   *                           default to "No"; bump + alert for manual repair)
   *
   * On success the marker is cleared; on failure attempts/last_error are bumped
   * and, past `alertAfterAttempts`, an escalation alert fires so a permanently
   * stuck torn row surfaces (the original onboarding-time `partial` alert fired
   * only once). See docs/BILL_CHUNK_4_DESIGN.md "Thread 3".
   */
  static async sweepBillOnboarding({ limit = 100, alertAfterAttempts = 5, stuckThresholdHours = 24 } = {}) {
    const onboardingState = require('../bill/onboarding-state');
    const { BILLCOM_ACCOUNT_YES, BILLCOM_ACCOUNT_NO, assertOptionSetValuesConfigured } = require('../bill/option-set-values');

    // Reconcile: surface rows stranded in a non-terminal, non-resumable state
    // (reserved-but-incomplete / vendor-created-but-marker-never-written). These
    // may hold an orphaned BILL vendor; ops must reconcile by hand. Best-effort,
    // never blocks the resume pass below.
    let stuck = 0;
    try {
      const stuckRows = await onboardingState.listStuck({ thresholdHours: stuckThresholdHours, limit });
      stuck = stuckRows.length;
      if (stuckRows.length) {
        await MaintenanceService._safeBillAlert({
          type: 'bill_onboarding_stuck',
          severity: 'warning',
          emailAdmins: true,
          title: `${stuckRows.length} BILL onboarding row(s) stuck > ${stuckThresholdHours}h — manual reconcile`,
          message: 'Reserved/partial onboardings never reached a terminal status; some may have an orphaned BILL vendor that ops must link or void.',
          metadata: {
            count: stuckRows.length,
            samples: stuckRows.slice(0, 10).map((r) => ({
              honorariumRequestId: r.honorarium_request_id,
              billStatus: r.bill_status,
              hasVendorId: !!r.vendor_id,
            })),
          },
        });
      }
    } catch (err) {
      console.error('MaintenanceService.sweepBillOnboarding stuck-reconcile failed:', err.message);
    }

    const pending = await onboardingState.listPending(limit);
    let resumed = 0;
    let errors = 0;
    let failedClosed = 0;
    if (pending.length === 0) {
      return { resumed, scanned: 0, errors, failedClosed, stuck };
    }

    // Resuming writes the BILL account-status option-set; if those env values
    // aren't configured we cannot safely write — skip the whole sweep rather
    // than stamp nulls. (Pending rows only exist when BILL_ENABLED was true,
    // which already requires these, so this is a defensive guard.)
    try {
      assertOptionSetValuesConfigured();
    } catch (err) {
      console.error('MaintenanceService.sweepBillOnboarding: option-set values unset, skipping:', err.message);
      await MaintenanceService._safeBillAlert({
        type: 'bill_resume_misconfigured',
        severity: 'error',
        emailAdmins: true,
        title: 'BILL onboarding resume sweep skipped — option-set values unset',
        message: err.message,
        metadata: { pendingCount: pending.length },
      });
      return { resumed, scanned: pending.length, errors: pending.length, failedClosed, stuck };
    }

    for (const row of pending) {
      const id = row.honorarium_request_id;

      if (row.pending_match === null || row.pending_match === undefined) {
        failedClosed += 1;
        await onboardingState.bumpAttempt(id, 'pending_match IS NULL — cannot resolve writeback; manual repair needed');
        await MaintenanceService._safeBillAlert({
          type: 'bill_resume_unresolvable',
          severity: 'warning',
          emailAdmins: true,
          title: 'BILL onboarding resume: malformed torn-state marker (manual repair)',
          message: 'A bill_onboarding_state row is dynamics_pending with pending_match NULL; the sweep fails closed rather than defaulting to "No".',
          metadata: { honorariumRequestId: id },
        });
        continue;
      }

      const body = row.pending_match
        ? { wmkf_paymentnetworkidpni: row.pending_pni, wmkf_exisitngbillcomaccount: BILLCOM_ACCOUNT_YES }
        : { wmkf_exisitngbillcomaccount: BILLCOM_ACCOUNT_NO };

      try {
        await bypassDynamicsRestrictions('bill-onboarding-resume', () =>
          grantRequestAdapter.updateById(id, body),
        );
        await onboardingState.clearDynamicsPending(id, row.pending_match ? 'onboarded' : 'no_match');
        resumed += 1;
      } catch (err) {
        errors += 1;
        const attempts = await onboardingState.bumpAttempt(id, err?.message || String(err));
        if (attempts != null && attempts >= alertAfterAttempts) {
          await MaintenanceService._safeBillAlert({
            type: 'bill_resume_stuck',
            severity: 'error',
            emailAdmins: true,
            title: `BILL onboarding resume stuck after ${attempts} attempts`,
            message: err?.message || String(err),
            metadata: { honorariumRequestId: id, attempts },
          });
        }
      }
    }

    return { resumed, scanned: pending.length, errors, failedClosed, stuck };
  }

  /** TTL prune of completed (non-pending) bill_onboarding_state rows. */
  static async cleanupBillOnboardingState(retentionDays = 30) {
    try {
      const onboardingState = require('../bill/onboarding-state');
      return await onboardingState.cleanupCompleted(retentionDays);
    } catch (error) {
      console.error('MaintenanceService.cleanupBillOnboardingState error:', error.message);
      throw error;
    }
  }

  /** Best-effort alert; a notification-system fault must not crash the sweep. */
  static async _safeBillAlert(args) {
    try {
      const NotificationService = require('./notification-service');
      const notify = NotificationService.notify || NotificationService.default?.notify;
      if (typeof notify === 'function') {
        await notify.call(NotificationService.default || NotificationService, {
          source: 'bill/onboarding-resume',
          category: 'spend',
          ...args,
        });
      }
    } catch (err) {
      console.error('MaintenanceService._safeBillAlert failed:', err?.message || err);
    }
  }

  /**
   * Clean up old maintenance_runs audit rows.
   *
   * The drain-submissions cron (every 2 min) and the daily maintenance run
   * both write rows here; without a sweep the table grows unbounded. Prunes
   * by started_at. The in-flight row for the current daily-maintenance run is
   * never affected (started_at = now, far newer than the cutoff), so this is
   * safe to run as a step inside that very run.
   */
  static async cleanupMaintenanceRuns(retentionDays = 90) {
    try {
      const result = await sql`
        DELETE FROM maintenance_runs
        WHERE started_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupMaintenanceRuns error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up old health check history records
   */
  static async cleanupHealthHistory(retentionDays = 30) {
    try {
      const result = await sql`
        DELETE FROM health_check_history
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupHealthHistory error:', error.message);
      throw error;
    }
  }

  /**
   * Delete orphaned Vercel Blob files not referenced by any active record.
   *
   * Collects all blob URLs referenced in Dataverse (post-W5 cutover):
   *   - `wmkf_appgrantcycle.wmkf_reviewtemplateurl` (cycle-level template)
   *   - `wmkf_appreviewersuggestion.wmkf_summarybloburl` (per-candidate summary)
   *   - `wmkf_appreviewersuggestion.wmkf_reviewbloburl` (legacy; retained
   *      for historical rows — Vercel Blob retired for review uploads
   *      2026-05-03 in favor of SharePoint, but historical URLs still
   *      live in this column and must not be reaped)
   *
   * Postgres `proposal_searches.full_proposal_blob_url` is intentionally
   * omitted — the table is empty (0 rows, dead writer) and is being
   * dropped during Wave 2 cleanup.
   *
   * @param {number} retentionDays - Only consider blobs older than this for deletion
   * @param {boolean} dryRun - If true, list what would be deleted without deleting
   * @returns {{ deleted: number, skipped: number, errors: number, details: string[] }}
   */
  static async cleanupBlobs(retentionDays = 90, dryRun = false) {
    const stats = { deleted: 0, skipped: 0, errors: 0, details: [] };

    try {
      // 1. Collect all blob URLs still referenced in Dataverse.
      // Read-only system maintenance — wrap in bypass so the restriction
      // context (which can be absent for cron-initiated calls) is satisfied.
      // Fail-closed on `capped` (queryAllRecords' 5000-row safety limit):
      // an undercount of active URLs becomes false-positive deletions,
      // which here is permanent data loss of summary PDFs / review files.
      const dvUrls = await bypassDynamicsRestrictions('maintenance-blob-scan', async () => {
        const [cycles, suggestions] = await Promise.all([
          grantCycleAdapter.queryAllCycles({
            select: 'wmkf_reviewtemplateurl,wmkf_additionalattachments',
            filter: 'wmkf_reviewtemplateurl ne null or wmkf_additionalattachments ne null',
          }),
          // Not converted: no existing wmkf_appreviewersuggestions adapter method
          // covers this arbitrary blob-URL business filter, and reviewer-suggestion.js
          // is not owned by this conversion wave — left raw per the recipe's explicit
          // per-call skip provision.
          DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
            select: 'wmkf_summarybloburl,wmkf_reviewbloburl',
            filter: 'wmkf_summarybloburl ne null or wmkf_reviewbloburl ne null',
          }),
        ]);

        if (cycles.capped || suggestions.capped) {
          throw new Error(
            `blob-scan refused: Dataverse query hit the 5000-row export cap ` +
            `(cycles.capped=${!!cycles.capped}, suggestions.capped=${!!suggestions.capped}). ` +
            `Continuing would silently undercount active URLs and risk reaping ` +
            `live files. Raise the cap or scope the scan before retrying.`
          );
        }

        const urls = new Set();
        // This scanner lists + deletes the PUBLIC blob store only (default
        // @vercel/blob token). Add only PUBLIC blob URLs to the keep-set; private
        // cycle-material pathnames (cycle-materials/ prefix, dedicated private
        // store) are intentionally NOT scanned here — orphaned private blobs are a
        // (minor) leak, never deletion candidates — and must never enter the
        // public-store deletion logic. (Codex SLICE2-5: the scan previously read
        // only wmkf_reviewtemplateurl and ignored wmkf_additionalattachments, so a
        // cycle's public attachment blobs could be reaped as orphans after
        // retention.)
        for (const row of cycles.records) {
          const tmpl = row.wmkf_reviewtemplateurl;
          if (tmpl && !isPrivateCycleMaterialPathname(tmpl)) urls.add(tmpl);
          let atts = null;
          try {
            atts = row.wmkf_additionalattachments ? JSON.parse(row.wmkf_additionalattachments) : null;
          } catch {
            atts = null;
          }
          if (Array.isArray(atts)) {
            for (const a of atts) {
              const u = a && (a.blobUrl || a.url);
              if (u && !isPrivateCycleMaterialPathname(u)) urls.add(u);
            }
          }
        }
        for (const row of suggestions.records) {
          if (row.wmkf_summarybloburl) urls.add(row.wmkf_summarybloburl);
          if (row.wmkf_reviewbloburl) urls.add(row.wmkf_reviewbloburl);
        }
        return urls;
      });

      // Intake-portal drafts (still Postgres — `intake_drafts.attachments` is
      // JSONB of `{filename, blob_url, ...}`). The original Postgres scanner
      // never read this table; the new scanner closes that pre-existing gap
      // so cron can't reap an applicant's in-flight upload.
      const intakeRows = await sql`
        SELECT jsonb_array_elements(attachments)->>'blob_url' AS blob_url
        FROM intake_drafts
        WHERE attachments IS NOT NULL AND jsonb_array_length(attachments) > 0
      `;

      const activeUrls = new Set(dvUrls);
      for (const row of intakeRows.rows) {
        if (row.blob_url) activeUrls.add(row.blob_url);
      }

      stats.details.push(
        `Found ${activeUrls.size} active blob URLs ` +
        `(Dataverse: ${dvUrls.size}, intake_drafts: ${intakeRows.rows.length})`
      );

      // 2. List all blobs in storage
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      let cursor;
      let totalBlobs = 0;

      do {
        const listing = await list({ cursor, limit: 100 });
        cursor = listing.cursor;
        totalBlobs += listing.blobs.length;

        for (const blob of listing.blobs) {
          // Skip blobs newer than retention cutoff
          if (new Date(blob.uploadedAt) > cutoff) {
            stats.skipped++;
            continue;
          }

          // Skip blobs that are still referenced
          if (activeUrls.has(blob.url)) {
            stats.skipped++;
            continue;
          }

          // Delete orphaned blob
          if (dryRun) {
            stats.details.push(`Would delete: ${blob.pathname} (${blob.size} bytes, uploaded ${blob.uploadedAt})`);
            stats.deleted++;
          } else {
            try {
              await del(blob.url);
              stats.deleted++;
            } catch (delError) {
              stats.errors++;
              stats.details.push(`Delete failed: ${blob.pathname}: ${delError.message}`);
            }
          }
        }
      } while (cursor);

      stats.details.unshift(`Scanned ${totalBlobs} total blobs in storage`);
      if (dryRun) {
        stats.details.unshift('DRY RUN — no blobs were actually deleted');
      }

      return stats;
    } catch (error) {
      console.error('MaintenanceService.cleanupBlobs error:', error.message);
      stats.errors++;
      stats.details.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * Sweep orphan bytes in the PRIVATE intake Blob store
   * (`intake-applicant-private`, INTAKE_BLOB_RW_TOKEN).
   *
   * Closes S186 #7 gap: `cleanupBlobs` only scans the shared store, and the
   * drain's `handleFilesMoved` doesn't delete source bytes after the
   * SharePoint upload. Without this sweep, every successful submission
   * leaves a byte stranded in the private store.
   *
   * Active-pathname sources (union; reaping only if NOT in any):
   *   1. intake_drafts.attachments[].pathname WHERE request_id IS NULL
   *      (pre-submit drafts only — post-submit drafts retain `attachments[]`
   *      but the corresponding bytes are either covered by the non-terminal
   *      submission_jobs source below, or have been moved to SharePoint and
   *      are now reapable. Codex S187 pre-impl Q2.)
   *   2. intake_drafts.pending_attachments[].pathname
   *      (belt-and-suspenders for race windows where sweepIntakePending
   *      hasn't yet run on a new pending entry)
   *   3. submission_jobs.payload->'attachments'->>'pathname'
   *      WHERE status NOT IN ('completed','failed','cancelled')
   *      AND jsonb_typeof(payload->'attachments') = 'array'
   *      (in-flight drain jobs that still need the bytes)
   *
   * Race safety: pathname is `drafts/{draftId}/{attachmentId}` with
   * crypto.randomUUID + `addRandomSuffix:false, allowOverwrite:false` at
   * /upload-token, so a new upload cannot reuse an old pathname. A new
   * submit after our active-set snapshot cannot reference a byte we're
   * about to reap. (Codex S187 pre-impl Q4.)
   *
   * Retention default: 72 hours — gives operators a triage window on
   * terminal failed jobs and absorbs any drain-retry tail well beyond
   * the per-category cap timeline.
   *
   * @param {object} opts
   * @param {number} [opts.retentionHours=72] only consider blobs older than this
   * @param {boolean} [opts.dryRun=false]      if true, list without deleting
   * @returns {Promise<{deleted, skipped, errors, details}>}
   */
  static async cleanupIntakePrivateBlobs({ retentionHours = 72, dryRun = false } = {}) {
    const stats = { deleted: 0, skipped: 0, errors: 0, details: [] };

    let blobToken;
    try {
      blobToken = getIntakeBlobToken();
    } catch (err) {
      stats.errors += 1;
      stats.details.push(`INTAKE_BLOB_RW_TOKEN missing: ${err.message}`);
      return stats;
    }

    try {
      // 1) Active-set query — three sources via UNION ALL + JS-side Set
      //    dedup (cheaper than DB-side DISTINCT on JSON-extracted strings).
      const rows = await sql`
        SELECT (jsonb_array_elements(attachments)->>'pathname') AS pathname
          FROM intake_drafts
         WHERE request_id IS NULL
           AND attachments IS NOT NULL
           AND jsonb_array_length(attachments) > 0
        UNION ALL
        SELECT (jsonb_array_elements(pending_attachments)->>'pathname') AS pathname
          FROM intake_drafts
         WHERE pending_attachments IS NOT NULL
           AND jsonb_array_length(pending_attachments) > 0
        UNION ALL
        SELECT (jsonb_array_elements(payload->'attachments')->>'pathname') AS pathname
          FROM submission_jobs
         WHERE status NOT IN ('completed', 'failed', 'cancelled')
           AND jsonb_typeof(payload->'attachments') = 'array'
      `;
      const activePathnames = new Set();
      for (const r of rows.rows) {
        if (r.pathname) activePathnames.add(r.pathname);
      }
      stats.details.push(`Active pathname references: ${activePathnames.size}`);

      // 2) List private-store blobs (paged) and reap orphans.
      const cutoff = new Date(Date.now() - retentionHours * 3600 * 1000);
      let cursor;
      let totalBlobs = 0;

      do {
        // `prefix: 'drafts/'` scopes the listing to the only path shape the
        // /upload-token endpoint mints (drafts/{draftId}/{attachmentId}). A
        // no-op today since the private store has no other content, but
        // defensive future hardening if other shapes land here later.
        const listing = await list({ cursor, limit: 100, token: blobToken, prefix: 'drafts/' });
        cursor = listing.cursor;
        totalBlobs += listing.blobs.length;

        for (const blob of listing.blobs) {
          // Defensive: skip rows with missing/invalid uploadedAt rather
          // than crashing the sweep. A malformed listing entry shouldn't
          // poison the whole pass.
          const uploadedAt = blob.uploadedAt ? new Date(blob.uploadedAt) : null;
          if (!uploadedAt || Number.isNaN(uploadedAt.getTime())) {
            stats.skipped++;
            continue;
          }
          if (uploadedAt > cutoff) { stats.skipped++; continue; }
          if (activePathnames.has(blob.pathname)) { stats.skipped++; continue; }

          if (dryRun) {
            stats.details.push(`Would delete: ${blob.pathname} (${blob.size} bytes, uploaded ${blob.uploadedAt})`);
            stats.deleted++;
            continue;
          }
          try {
            await del(blob.pathname, { token: blobToken });
            stats.deleted++;
          } catch (err) {
            if (isBlobNotFound(err)) { stats.skipped++; continue; }
            stats.errors++;
            stats.details.push(`Delete failed: ${blob.pathname}: ${err.message}`);
          }
        }
      } while (cursor);

      stats.details.unshift(`Scanned ${totalBlobs} private-store blobs`);
      if (dryRun) stats.details.unshift('DRY RUN — no blobs were actually deleted');
      return stats;
    } catch (err) {
      console.error('MaintenanceService.cleanupIntakePrivateBlobs error:', err.message);
      stats.errors += 1;
      stats.details.push(`Fatal error: ${err.message}`);
      return stats;
    }
  }

  /**
   * Sweep stale entries from intake_drafts.pending_attachments (S184
   * chunk 6). Designed to be called from the daily maintenance cron.
   * Default cutoff is 2h — 1h Blob token expiry + 1h safety margin so
   * a slow legitimate /attach retry isn't prematurely 404'd by the sweep
   * (per S184 A6).
   *
   * Order of operations is removePending FIRST, then del() (Codex
   * chunk-6 pre-impl Q3+Q7 catch): pending and clean attachments
   * share the same opaque pathname (A5), so a concurrent /attach that
   * promotes between our list-stale read and our action could be
   * silently corrupted if we del-first. Atomic JSONB removePending
   * gives us a concurrency gate — {removed:true} means we won the
   * race and the bytes are safe to delete.
   *
   * @param {object} opts
   * @param {number} opts.cutoffHours  default 2; entries with createdAt < now - cutoffHours are swept
   * @returns {Promise<{deleted, scanned, errors, blobDelErrors, removePendingErrors}>}
   *   `errors` is the total of the two granular counts (cron summary
   *   formatter expects {deleted, errors}; granular counts are kept
   *   for forensics).
   */
  static async sweepIntakePending({ cutoffHours = 2 } = {}) {
    const cutoffIso = new Date(Date.now() - cutoffHours * 3600_000).toISOString();
    const stale = await IntakeDraftService.listPendingOlderThan(cutoffIso);

    let deleted = 0;
    let blobDelErrors = 0;
    let removePendingErrors = 0;
    let blobToken = null;
    try {
      blobToken = getIntakeBlobToken();
    } catch (err) {
      // No token = skip Blob deletions but still process JSONB so the
      // column doesn't grow unbounded. An orphan Blob is recoverable;
      // an unbounded JSONB is not.
      console.warn('[sweepIntakePending] INTAKE_BLOB_RW_TOKEN unset; skipping Blob deletions:', err?.message ?? err);
    }

    for (const { draftId, entry } of stale) {
      // 1. Atomic JSONB remove — concurrency gate.
      let removed = false;
      try {
        const r = await IntakeDraftService.removePending(draftId, entry.attachmentId);
        removed = r?.removed === true;
      } catch (err) {
        removePendingErrors += 1;
        console.warn('[sweepIntakePending] removePending failed for', draftId, entry.attachmentId, err?.message ?? err);
        continue;
      }

      if (!removed) {
        // Concurrent /attach won the race. Bytes are now (or were
        // briefly) part of attachments[]; do NOT touch them.
        continue;
      }
      deleted += 1;

      // 2. Now-safe: pending entry was definitely there at removal
      //    time. Best-effort Blob delete.
      if (blobToken && entry.pathname) {
        try {
          await del(entry.pathname, { token: blobToken });
        } catch (err) {
          if (!isBlobNotFound(err)) {
            blobDelErrors += 1;
            console.warn('[sweepIntakePending] del failed for', entry.pathname, err?.message ?? err);
          }
        }
      }

      // 3. Audit (one row per actually-removed entry — S184 scoping Q5).
      IntakeAuditService.log({
        actorOid: null,
        actorType: 'system',
        action: 'draft.attach_orphan_swept',
        targetEntity: 'intake_drafts',
        targetId: draftId,
        payload: { filename: entry.filename },
        metadata: {
          draftId,
          attachmentId: entry.attachmentId,
          fieldKey: entry.fieldKey,
          pathname: entry.pathname,
          createdAt: entry.createdAt,
          validUntil: entry.validUntil,
          cutoffIso,
        },
      }).catch(() => {});
    }

    const errors = blobDelErrors + removePendingErrors;
    return { deleted, scanned: stale.length, errors, blobDelErrors, removePendingErrors };
  }

  // ============================================
  // AUDIT TRAIL
  // ============================================

  /**
   * Record the start of a maintenance job
   * @returns {number} The run ID
   */
  static async startRun(jobName) {
    try {
      const result = await sql`
        INSERT INTO maintenance_runs (job_name, status)
        VALUES (${jobName}, 'running')
        RETURNING id
      `;
      return result.rows[0].id;
    } catch (error) {
      console.error('MaintenanceService.startRun error:', error.message);
      return null;
    }
  }

  /**
   * Complete a maintenance run with results
   */
  static async completeRun(runId, { status = 'completed', recordsProcessed = 0, recordsDeleted = 0, details, errorMessage } = {}) {
    if (!runId) return;
    try {
      await sql`
        UPDATE maintenance_runs
        SET status = ${status},
            records_processed = ${recordsProcessed},
            records_deleted = ${recordsDeleted},
            details = ${details ? JSON.stringify(details) : null},
            error_message = ${errorMessage || null},
            completed_at = CURRENT_TIMESTAMP,
            duration_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::int * 1000
        WHERE id = ${runId}
      `;
    } catch (error) {
      console.error('MaintenanceService.completeRun error:', error.message);
    }
  }

  /**
   * Get the last run for each job
   */
  static async getLastRuns() {
    try {
      const result = await sql`
        SELECT DISTINCT ON (job_name)
          id, job_name, status, records_processed, records_deleted,
          details, error_message, started_at, completed_at, duration_ms
        FROM maintenance_runs
        ORDER BY job_name, started_at DESC
      `;
      return result.rows;
    } catch (error) {
      console.error('MaintenanceService.getLastRuns error:', error.message);
      return [];
    }
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  /**
   * Read configurable retention periods from Dataverse `wmkf_appsystemsettings`
   * via the settings-service dispatcher. Falls back to defaults if not configured.
   */
  static async getRetentionConfig() {
    const defaults = {
      usage_log_days: 90,
      query_log_days: 365,
      blob_days: 90,
      health_history_days: 30,
      alert_days: 90,
      intake_audit_days: 730,
      bill_webhook_events_days: 7,
      maintenance_runs_days: 90,
      bill_onboarding_state_days: 30,
    };

    try {
      const rows = await listSettings('retention:');
      for (const [settingKey, settingValue] of Object.entries(rows)) {
        const key = settingKey.replace('retention:', '');
        const value = parseInt(settingValue, 10);
        // Defensive: reject `0`, negatives, and NaN. A misconfigured
        // Dataverse setting like `retention:intake_audit_days = 0` would
        // otherwise translate to "delete everything older than 0 days"
        // (= the whole table immediately). Preserve the default on bad
        // input. Codex S187 post-impl hardening — applies to ALL retention
        // keys in `defaults` (currently seven: usage_log, query_log, blob,
        // health_history, alert, intake_audit, bill_webhook_events). The
        // hasOwnProperty check below is the canonical key gate, so the rule
        // applies to every key in `defaults` (no hardcoded enumeration here —
        // it drifts; the gate is the source of truth).
        if (Number.isFinite(value) && value > 0 && defaults.hasOwnProperty(key)) {
          defaults[key] = value;
        }
      }
    } catch (error) {
      console.error('MaintenanceService.getRetentionConfig error:', error.message);
    }

    return defaults;
  }
}

module.exports = MaintenanceService;
