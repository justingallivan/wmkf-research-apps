/**
 * reviewer-email-reconciler (Fix A, S317) — the backstop that recovers reviewer
 * emails which enrichment discovered (persisted to the roster with
 * `emailPersistAllowed=true`) but which never reached Dataverse via either save
 * path (Find `save-candidates` saved before a later run found the email; applicant
 * `promote` pre-B1). Path-agnostic: it works off the roster blob + the linked
 * suggestion, id-anchored on `candidate.suggestionId` (NEVER a normalized name).
 *
 * Per candidate:
 *   - resolve the suggestion (must belong to the request AND be selected),
 *   - idempotency: skip if the person already has an email,
 *   - by the vetted email's Dataverse ownership:
 *       none               → WRITE the email onto the suggestion's person,
 *       one ACTIVE sibling  → REPOINT the suggestion to that keeper, unless the
 *                             keeper already has ANY suggestion on the request
 *                             (`(person,request)` alt-key would collide) → ALERT,
 *       ambiguous/inactive  → ALERT for manual merge.
 *
 * RETRACTION (S414): any row that reaches a non-alert outcome also auto-resolves
 * its own prior needs-merge alert. `autoResolveKey` alone only DEDUPES new
 * alerts, so before this an alert outlived its condition indefinitely — and
 * because dedup suppressed the re-raise, a silent night looked identical to a
 * resolved one. Retraction fires on: email landed, suggestion gone, suggestion
 * excluded/deselected, write, repoint. It deliberately does NOT fire on a still-selected
 * row's ambiguous skips (no vetted email, missing personId, contradictory
 * same-person owner) or on a stale-roster request mismatch — those leave the
 * duplicate intact, and retracting there would destroy the only standing signal
 * that it exists. Deleted/deselected lifecycle evidence is checked before
 * contact authority because those states conclusively remove the human work item.
 * Unvetted rows without an open keyed alert skip the Dataverse lifecycle read;
 * the open-key query is one Postgres read per run and fails safe to checking all.
 *
 * The write/repoint mirror the S317 manual session recovery scripts (now under
 * `_archived/scripts/`, owner decision D5 2026-09-06). Live Dataverse reads gate every mutation, so a
 * stale roster blob never drives a wrong write. Best-effort per row; a row error is
 * recorded, never fatal. `dryRun` reports intended actions without mutating.
 */

import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../dataverse/adapters/researcher';
import NotificationService from './notification-service';
import AlertService from './alert-service';
import { pickVettedEmail } from '../utils/reviewer-vetted-email';
import { findReconcilableCandidates } from './reviewer-roster-store';

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

const ALERT_TYPE = 'reviewer_email_reconcile_needs_merge';
const alertKeyFor = (suggestionId) => `reviewer-email-reconcile:${suggestionId}`;

/**
 * Retract a previously-raised needs-merge alert once this row reaches a
 * non-alert outcome. `autoResolveKey` only DEDUPES new alerts
 * (alert-service.js `createAlert`), so without this an alert outlived its
 * condition and — because dedup suppresses the re-raise — a silent night was
 * indistinguishable from a resolved one.
 *
 * Only called from outcomes that mean "this row no longer needs a human":
 * the email landed, the suggestion is gone/excluded/deselected, or we just
 * wrote/repointed. In dry-run mode the intended retraction is reported without
 * calling AlertService. NEVER from a still-selected row's ambiguous skips (no vetted
 * email, missing personId, contradictory same-person owner) — those leave the
 * duplicate intact, and retracting there would destroy the only standing signal.
 * Best-effort: a retraction failure must not fail the run.
 */
async function retractNeedsMerge(suggestionId, reason, result, dryRun, openAlertKeys) {
  if (dryRun) {
    // Preview effective retractions, not calls that would merely no-op. When the
    // key scan failed, retractionPreviewComplete=false makes the missing preview
    // explicit rather than presenting guesses as confirmed alert rows.
    if (openAlertKeys?.has(alertKeyFor(suggestionId))) {
      result.wouldRetract.push({ suggestionId, reason });
    }
    return 0;
  }
  try {
    const count = await AlertService.autoResolve(alertKeyFor(suggestionId));
    if (count > 0) result.retracted.push({ suggestionId, reason, count });
    return count;
  } catch (err) {
    console.warn('[reviewer-email-reconciler] retract failed (non-fatal):', err?.message || err);
    return 0;
  }
}

async function alertNeedsMerge(kind, { requestId, suggestionId, personId, email, detail }) {
  try {
    await NotificationService.notify({
      type: ALERT_TYPE,
      severity: 'warning',
      title: 'Reviewer email needs manual merge',
      message: `A vetted reviewer email (${email}) could not be auto-recovered for request ${requestId} (${kind}). Resolve on the Invite Reviewers tab.`,
      metadata: { requestId, suggestionId, personId: personId || null, email, kind, detail: detail || null },
      source: 'reviewer-email-reconciler',
      category: 'reviewers',
      // MUST stay `alertKeyFor` — retraction matches on this exact key, so a
      // second inline copy of the template would let the two drift and silently
      // stop retracting (fail-open). One definition, both directions.
      autoResolveKey: alertKeyFor(suggestionId),
    });
  } catch (err) {
    console.warn('[reviewer-email-reconciler] alert failed (non-fatal):', err?.message || err);
  }
}

export async function reconcileReviewerEmails({ maxBatch = 200, dryRun = false, actingUserSystemId = null } = {}) {
  const rows = await findReconcilableCandidates(maxBatch);
  const result = {
    scanned: rows.length,
    written: [],
    repointed: [],
    alerted: [],
    retracted: [],
    wouldRetract: [],
    retractionPreviewComplete: dryRun ? true : null,
    skipped: 0,
    errors: [],
  };

  // Only unvetted rows with a standing work item need a lifecycle read. If the
  // key query fails, null means "unknown" and every unvetted row is checked —
  // slower but fail-safe for stale-alert retraction.
  let openAlertKeys = null;
  try {
    openAlertKeys = new Set(await AlertService.getOpenAutoResolveKeysByType(ALERT_TYPE));
  } catch (err) {
    if (dryRun) result.retractionPreviewComplete = false;
    console.warn('[reviewer-email-reconciler] open-alert key scan failed; checking all candidate lifecycles:', err?.message || err);
  }

  for (const { requestId, candidate } of rows) {
    const suggestionId = candidate && candidate.suggestionId;
    try {
      if (!suggestionId) { result.skipped++; continue; }

      const vetted = pickVettedEmail(candidate);
      if (!vetted && openAlertKeys && !openAlertKeys.has(alertKeyFor(suggestionId))) {
        result.skipped++;
        continue;
      }

      // The suggestion must exist, belong to THIS request, and be selected (only
      // selected rows surface on the Invite tab). Id-anchored — no name match.
      // Split from one condition so RETRACTION is precise: a gone/deselected row
      // has no work item left, but a request MISMATCH means the roster row is
      // stale, which says nothing about the alert — do not retract there.
      const sug = await suggestionAdapter.getForEmailReconcile(suggestionId);
      if (!sug) {
        await retractNeedsMerge(suggestionId, 'suggestion_gone', result, dryRun, openAlertKeys);
        result.skipped++; continue;
      }
      if (!eq(sug._wmkf_request_value, requestId)) { result.skipped++; continue; }
      if (suggestionAdapter.isExcluded(sug)) {
        await retractNeedsMerge(suggestionId, 'applicant_excluded', result, dryRun, openAlertKeys);
        result.skipped++; continue;
      }
      if (!sug.wmkf_selected) {
        await retractNeedsMerge(suggestionId, 'deselected', result, dryRun, openAlertKeys);
        result.skipped++; continue;
      }
      const personId = sug._wmkf_potentialreviewer_value;
      if (!personId) { result.skipped++; continue; }

      // Lifecycle retraction must run before the current roster email is vetted.
      // An alert can outlive the candidate's contact authority (for example, the
      // exact production alert-383 row became unvetted after it was deselected).
      // The deleted/deselected live suggestion is still conclusive evidence that
      // no human work item remains. A selected row without a currently vetted
      // address remains unresolved and must keep its standing alert.
      if (!vetted) { result.skipped++; continue; }

      // Idempotency: live Dataverse read — never trust the roster as the target.
      const person = await potentialReviewerAdapter.getForEmailReconcile(personId);
      if (!person) { result.skipped++; continue; }
      if (person.wmkf_emailaddress) {
        await retractNeedsMerge(suggestionId, 'email_present', result, dryRun, openAlertKeys);
        result.skipped++; continue;
      }

      const owner = await potentialReviewerAdapter.findByEmailCandidates(vetted.email);

      if (owner.none) {
        if (!dryRun) {
          // Address + provenance in ONE patch (S387): as two calls, a landed address whose
          // source write failed left the row describing the new address under the old
          // source, which the invite gate could read as a stronger tier than the evidence.
          await potentialReviewerAdapter.update(
            personId,
            vetted.source ? { email: vetted.email, emailSource: vetted.source } : { email: vetted.email },
            { actingUserSystemId },
          );
        }
        await retractNeedsMerge(suggestionId, 'written', result, dryRun, openAlertKeys);
        result.written.push({ requestId, suggestionId, personId, email: vetted.email });
        continue;
      }

      if (owner.one && eq(owner.id, personId)) {
        // The suggestion's own person already owns the email but reads empty above —
        // contradictory (should not happen); skip rather than write blindly.
        result.skipped++;
        continue;
      }

      if (owner.one && typeof owner.row?.statecode === 'number' && owner.row.statecode === 0) {
        // Single ACTIVE keeper → repoint, unless it already has a suggestion on this
        // request (selected OR not — the (person,request) alt key would 412).
        const keeperId = owner.id;
        const keeperSug = await suggestionAdapter.findByPotentialReviewerAndRequest(keeperId, requestId);
        if (keeperSug) {
          if (!dryRun) await alertNeedsMerge('keeper_has_suggestion', { requestId, suggestionId, personId, email: vetted.email, detail: { keeperId } });
          result.alerted.push({ requestId, suggestionId, email: vetted.email, reason: 'keeper_has_suggestion', keeperId });
          continue;
        }
        if (!dryRun) {
          await suggestionAdapter.repointToPotentialReviewer(suggestionId, keeperId, { actingUserSystemId });
        }
        await retractNeedsMerge(suggestionId, 'repointed', result, dryRun, openAlertKeys);
        result.repointed.push({ requestId, suggestionId, from: personId, to: keeperId, email: vetted.email });
        continue;
      }

      // Ambiguous (>1 owner) or an inactive single owner → never auto-resolve.
      if (!dryRun) await alertNeedsMerge(owner.ambiguous ? 'ambiguous_owner' : 'inactive_owner', { requestId, suggestionId, personId, email: vetted.email });
      result.alerted.push({ requestId, suggestionId, email: vetted.email, reason: owner.ambiguous ? 'ambiguous_owner' : 'inactive_owner' });
    } catch (err) {
      console.error(`[reviewer-email-reconciler] row error (suggestion ${suggestionId}):`, err?.message || err);
      result.errors.push({ requestId, suggestionId: suggestionId || null, error: err?.message || String(err) });
    }
  }

  return result;
}
