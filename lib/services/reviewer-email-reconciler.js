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
 * The write/repoint mirror the manual session recovery (fix-roster-email-recovery.mjs /
 * fix-walsh-repoint-1003020.mjs). Live Dataverse reads gate every mutation, so a
 * stale roster blob never drives a wrong write. Best-effort per row; a row error is
 * recorded, never fatal. `dryRun` reports intended actions without mutating.
 */

import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../dataverse/adapters/researcher';
import NotificationService from './notification-service';
import { pickVettedEmail } from '../utils/reviewer-vetted-email';
import { findReconcilableCandidates } from './reviewer-roster-store';

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

async function alertNeedsMerge(kind, { requestId, suggestionId, personId, email, detail }) {
  try {
    await NotificationService.notify({
      type: 'reviewer_email_reconcile_needs_merge',
      severity: 'warning',
      title: 'Reviewer email needs manual merge',
      message: `A vetted reviewer email (${email}) could not be auto-recovered for request ${requestId} (${kind}). Resolve on the Invite Reviewers tab.`,
      metadata: { requestId, suggestionId, personId: personId || null, email, kind, detail: detail || null },
      source: 'reviewer-email-reconciler',
      category: 'reviewers',
      autoResolveKey: `reviewer-email-reconcile:${suggestionId}`,
    });
  } catch (err) {
    console.warn('[reviewer-email-reconciler] alert failed (non-fatal):', err?.message || err);
  }
}

export async function reconcileReviewerEmails({ maxBatch = 200, dryRun = false, actingUserSystemId = null } = {}) {
  const rows = await findReconcilableCandidates(maxBatch);
  const result = { scanned: rows.length, written: [], repointed: [], alerted: [], skipped: 0, errors: [] };

  for (const { requestId, candidate } of rows) {
    const suggestionId = candidate && candidate.suggestionId;
    try {
      const vetted = pickVettedEmail(candidate);
      if (!suggestionId || !vetted) { result.skipped++; continue; }

      // The suggestion must exist, belong to THIS request, and be selected (only
      // selected rows surface on the Invite tab). Id-anchored — no name match.
      const sug = await suggestionAdapter.findById(suggestionId);
      if (!sug || !eq(sug._wmkf_request_value, requestId) || !sug.wmkf_selected) { result.skipped++; continue; }
      const personId = sug._wmkf_potentialreviewer_value;
      if (!personId) { result.skipped++; continue; }

      // Idempotency: live Dataverse read — never trust the roster as the target.
      const person = await potentialReviewerAdapter.getById(personId);
      if (person && person.wmkf_emailaddress) { result.skipped++; continue; }

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
