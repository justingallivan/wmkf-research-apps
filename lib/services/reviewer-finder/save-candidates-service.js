/**
 * Reviewer Finder — save-candidates service
 * (Route→Service Consolidation Plan, Stage 3 wave).
 *
 * Holds ALL business logic for POST /api/reviewer-finder/save-candidates;
 * the route is a thin shell (method dispatch, auth, input validation, DAL
 * context, HTTP mapping). Saves selected candidates to Dataverse for a
 * proposal: three adapters (potential reviewer → researcher overlay →
 * reviewer suggestion), keyed by email and request GUID.
 *
 * PARTIAL-SUCCESS SEMANTICS ARE THE CONTRACT (clients depend on the exact
 * shapes — plan wave-table warning):
 *   - per-candidate try/catch: one row's failure never aborts the batch;
 *   - identity-unresolved and institution-COI rows are REJECTED pre-write
 *     and accumulate rejectedUnresolved / rejectedInstitutionCOI + errors;
 *   - ALL rejected (rejections == batch size) → SaveCandidatesError 422
 *     with the full explicit body (incl. BOTH rejected counts, always);
 *   - nothing saved for other reasons → SaveCandidatesError 500 with the
 *     historical body (rejected* keys present only when non-zero);
 *   - otherwise the 200 payload, rejected-count and errors keys present ONLY when
 *     non-zero (undefined-valued keys are dropped by res.json, matching
 *     the historical serialization byte-for-byte).
 *
 * Contract (plan Decision 3): plain args, never req/res; throws
 * SaveCandidatesError (extends ServiceHttpError) with explicit `body` for
 * the non-`{ error }` 422/500 envelopes; unexpected failures propagate
 * untyped for the shell's timestamped 500; ASSUMES a trusted DAL context.
 */

import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../dataverse/adapters/researcher';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } from '../reviewer-identity-resolver';
import { lookupReviewerIdentity } from '../reviewer-identity-lookup';
import NotificationService from '../notification-service';
import { saveSourceListForCandidate, withReviewerProvenance, buildReviewerProvenance, isIdentityReviewExemptProvenance } from '../../utils/reviewer-provenance';
import { ContactParser } from '../../utils/contact-parser';
import { stampSuggestionAnchor } from '../reviewer-roster-store';
import { isAntiScrapeMunge } from '../../utils/reviewer-vetted-email';
import { ServiceHttpError } from '../service-http-error';

/**
 * Domain error carrying the exact non-`{ error }` JSON body the shell must
 * send (plan Decision 3, `body` set explicitly).
 */
export class SaveCandidatesError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'SaveCandidatesError';
  }
}

function fieldPersistFlag(candidate, enrichment, flagName) {
  if (candidate?.[flagName] === false || enrichment?.[flagName] === false) return false;
  if (candidate?.[flagName] === true || enrichment?.[flagName] === true) return true;
  return undefined;
}

function paidSearchSource(source) {
  return source === 'claude_search' || source === 'serp_search' || source === 'search_contested';
}

function contactFieldAllowed(candidate, enrichment, flagName, source) {
  if (candidate?.contactStatus === 'unresolved' || enrichment?.contactStatus === 'unresolved') return false;
  const flag = fieldPersistFlag(candidate, enrichment, flagName);
  if (flag === false) return false;
  if (flag === true) return true;
  return !paidSearchSource(source);
}

// Slice E (server hard-reject): a candidate the system EXPLICITLY could not
// identity-resolve must NOT be persisted as a vetted reviewer (anchor-or-abstain at the
// persistence boundary). The clients hide these rows, but the standalone Reviewer Finder
// and any bypassed/direct caller can still POST them, so the field-level gate alone is
// insufficient — the server rejects the whole row (write neither person nor suggestion).
//
// Keyed on the EXPLICIT unresolved markers, NOT the broader
// `provenanceGroupOf === 'needs_identity_review'`. provenanceGroupOf also routes a
// BARRED/unknown-kind row with no positive identity to needs_identity_review, but such
// rows are LEGITIMATELY saved here from other paths (e.g. a contact-enriched person with
// a resolver verdict but no top-level identityStatus — see reviewer-route-identity-gate
// tests) with field-level gating, so gating on provenanceGroupOf would wrongly reject
// them. The client (FIND/Workbench select list) is intentionally stricter than this save
// gate: it hides ungrounded rows from selection; the save route accepts an
// explicitly-resolved-or-field-gated row.
function isUnresolvedIdentity(candidate) {
  // Exemption (S235): a cited-in-proposal / PI-named candidate (human/document-grounded — the
  // proposal author named this specific person) is NOT hard-rejected even when unresolved. It
  // saves as a name/identity-review row, but with ALL contact + identity-derived fields
  // force-nulled (see contactBlockedForUnresolvedExempt) so anchor-or-abstain still holds — a
  // selectable-but-unverified row cannot carry a wrong-person email/ORCID. Only SYSTEM-discovered
  // unresolved rows are rejected.
  if (isIdentityReviewExemptProvenance(buildReviewerProvenance(candidate).kind)) return false;
  return candidate?.needsIdentification === true
    || candidate?.identityStatus === 'unresolved'
    || candidate?.verificationStatus === 'unresolved';
}

function hasResolvedIdentity(candidate, enrichment) {
  const status = enrichment?.identity?.status || null;
  return status === 'confirmed' || status === 'probable';
}

// Codex HIGH (S235): when a cited/PI-named candidate is allowed through save WITHOUT a resolved
// identity (the exemption above), NO contact or identity-derived field may persist — it could be
// a namesake of the named person. Force email/website/faculty-page/affiliation/ORCID/Scholar/
// bibliometrics to null until identity is confirmed/probable. This turns "no silent wrong email"
// from an assumption into an enforced invariant at the persistence boundary.
function contactBlockedForUnresolvedExempt(candidate, enrichment) {
  return isIdentityReviewExemptProvenance(buildReviewerProvenance(candidate).kind)
    && !hasResolvedIdentity(candidate, enrichment);
}

function sameId(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

async function resolveValidatedReferredSeedAnchor(candidate, enrichment) {
  const provenance = buildReviewerProvenance(candidate);
  if (provenance.kind !== 'referred') return null;
  const potentialReviewerId = typeof candidate.seedResolvedPotentialReviewerId === 'string'
    ? candidate.seedResolvedPotentialReviewerId.trim()
    : '';
  if (!potentialReviewerId) return null;

  const email = candidate.email || enrichment?.email || null;
  const orcid = candidate.orcid || enrichment?.orcidId || enrichment?.orcid || null;
  if (!email && !orcid) return null;

  let current = null;
  try {
    current = await potentialReviewerAdapter.getById(potentialReviewerId);
  } catch {
    return null;
  }
  if (!current) return null;

  const lookup = await lookupReviewerIdentity({
    name: candidate.name,
    email,
    orcid,
  });
  if (
    lookup?.outcome === 'confident'
    && sameId(lookup.match?.reviewerId, potentialReviewerId)
    && (lookup.match?.matchKey === 'email' || lookup.match?.matchKey === 'orcid')
  ) {
    return {
      potentialReviewerId,
      contactId: lookup.match?.contactId || current._wmkf_contact_value || null,
      lookup,
    };
  }
  return null;
}

/**
 * Save a batch of selected reviewer candidates for a request.
 *
 * @param {Object} args - proposalTitle, programArea, requestId, grantCycleCode,
 *   candidates[], summaryBlobUrl (shell validated requestId + non-empty array),
 *   actingUserSystemId
 * @returns {Promise<Object>} the exact 200 payload (conditional rejected-count and errors keys)
 * @throws {SaveCandidatesError} 422 all-rejected / 500 nothing-saved, explicit bodies
 */
export async function saveCandidates({
  proposalTitle,
  programArea,
  requestId,
  grantCycleCode,
  candidates,
  summaryBlobUrl,
  actingUserSystemId,
}) {
  let savedCount = 0;
  let rejectedUnresolved = 0;
  let rejectedInstitutionCOI = 0;
  const errors = [];
  // The exact display names that saved successfully — the client flips ONLY
  // these to status='saved' in the Find-tab roster (S224), so a partial-failure
  // save never marks a failed row saved.
  const savedNames = [];

  for (const rawCandidate of candidates) {
    try {
      const candidate = withReviewerProvenance(rawCandidate);

      // PD identity override (set ONLY by the "✓ This is the right person" confirm
      // on a needs-identity-review card): an authenticated PD asserts the resolved
      // person is correct and supplies hand-typed contact. This skips the identity
      // hard-reject below AND the resolver-derived contact/bibliometric gates further
      // down — but ONLY persists the PD's manual email/website/affiliation; ORCID /
      // Scholar / metrics from the (unconfirmed) auto-resolver are force-nulled, never
      // blessed. Institution-COI is still enforced (identity confirmation ≠ COI waiver).
      // Read from rawCandidate so withReviewerProvenance can't drop the flag.
      const pdConfirmed = rawCandidate?.pdIdentityConfirmed === true;

      // Slice E hard-reject: never persist a candidate whose identity is unresolved.
      // Skip BEFORE any adapter write (neither person nor suggestion) and record it
      // so a partial batch (mixed resolved/unresolved) still saves the resolved rows.
      // The PD override (above) is the one sanctioned bypass of this gate.
      if (!pdConfirmed && isUnresolvedIdentity(candidate)) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          error: 'Candidate identity is unresolved (needs identity review); not saved.',
          code: 'identity_unresolved',
        });
        continue;
      }

      // S240: current same-institution is a HARD policy conflict at save. Discovery
      // hard-drops by default but Phase C can surface a contradicted low-trust match
      // as a read-only flag; post-enrichment can also promote a current affiliation
      // that matches a PI institution. Reject any hasInstitutionCOI row here — the
      // authoritative gate — so it can never be saved even if a stale client selected it.
      // (Applicant-RECOMMENDED reviewers save via the recommended junction, not this
      // route, so their flag-not-drop behavior is unaffected.)
      // Read BOTH the top-level flag AND the post-enrichment recompute, so the gate
      // holds even when the client didn't promote enrichment's COI onto the candidate
      // (e.g. the enrich-then-save path filters selection before merging). Authoritative.
      const enrichmentInstitutionCOI = candidate.contactEnrichment?.coiRecomputed
        && !!candidate.contactEnrichment?.hasInstitutionCOI;
      if (candidate.hasInstitutionCOI || enrichmentInstitutionCOI) {
        rejectedInstitutionCOI += 1;
        errors.push({
          name: candidate.name,
          error: 'Candidate is at the proposal PI’s institution (institution COI); not saved.',
          code: 'institution_coi',
        });
        continue;
      }

      const normalizedName = candidate.name
        .toLowerCase()
        .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const enrichment = candidate.contactEnrichment || {};
      let validatedSeedAnchor = null;
      if (!pdConfirmed) {
        try {
          validatedSeedAnchor = await resolveValidatedReferredSeedAnchor(candidate, enrichment);
        } catch (anchorErr) {
          console.warn('[save-candidates] referred seed anchor validation failed (non-fatal):', anchorErr?.message || anchorErr);
        }
      }
      // Codex HIGH: an unresolved cited/PI-named row saves as a name row only — force ALL
      // contact + identity-derived fields to null (it could be a namesake of the named person).
      const contactBlocked = !pdConfirmed && !validatedSeedAnchor && contactBlockedForUnresolvedExempt(candidate, enrichment);
      // PD-confirmed contact is hand-entered by definition — FORCE source 'manual'
      // server-side rather than trusting the client's `emailSource`. Otherwise a
      // forged/stale payload could send emailSource:'orcid' (or another high-confidence
      // source) and mark this email trusted, skipping confirm-before-invite at send.
      let candidateEmailSource = pdConfirmed ? 'manual' : (candidate.emailSource || enrichment.emailSource || null);
      const candidateWebsiteSource = pdConfirmed ? 'manual' : (candidate.websiteSource || enrichment.websiteSource || null);
      // PD-confirmed: persist the hand-typed contact directly (it's stamped 'manual'
      // client-side → confirm-before-invite still fires at send). Otherwise the normal
      // resolver-derived persist gates apply.
      const emailAllowed = pdConfirmed ? true : (!contactBlocked && contactFieldAllowed(candidate, enrichment, 'emailPersistAllowed', candidateEmailSource));
      const websiteAllowed = pdConfirmed ? true : (!contactBlocked && contactFieldAllowed(candidate, enrichment, 'websitePersistAllowed', candidateWebsiteSource));
      const affiliationAllowed = pdConfirmed ? true : (!contactBlocked && contactFieldAllowed(candidate, enrichment, 'affiliationPersistAllowed', null));
      // PD-confirmed rows source contact ONLY from the PD-typed candidate.* values —
      // NEVER the enrichment fallback. The enrichment email/website are the very values
      // the PD is overriding; if the PD blanks one, it must persist as null, not silently
      // fall back to the wrong auto-suggested value.
      let candidateEmail = emailAllowed ? (pdConfirmed ? (candidate.email || null) : (candidate.email || enrichment.email || null)) : null;
      const candidateAffiliation = affiliationAllowed ? (pdConfirmed ? (candidate.affiliation || null) : (candidate.affiliation || enrichment.affiliation || null)) : null;

      // Tier-0 affiliation-email rescue (S317). When contact enrichment ran but did NOT
      // capture an email (a partial / timed-out run — verified live for req 1003020:
      // `wmkf_lastchecked` set but `wmkf_metricsupdatedat`/`hIndex` empty), a PubMed-style
      // affiliation that embeds the reviewer's own corresponding address
      // ("… Boston Children's Hospital. christopher.walsh@childrens.harvard.edu.") would
      // otherwise be persisted with the email ORPHANED inside the affiliation string and
      // an empty email field ("no email — can't invite"). Mirror enrichment Tier 0
      // (contact-enrichment-service.js:439-450): extract the embedded email and persist it
      // as `affiliation`-sourced — a grounded, name-adjacent address that enrichment itself
      // trusts unconditionally (Tier 0 returns before domain validation, so it is immune to
      // the paid-search domain-contradiction drop). Same safety envelope as the normal email
      // persist: skipped for a contact-blocked (unresolved cited/PI-named) row and for
      // PD-confirmed rows (whose contact is PD-typed only), and only when the affiliation is
      // itself allowed to persist (candidateAffiliation non-null). Only fills a GAP — never
      // overrides an email the normal path already captured.
      if (!candidateEmail && !pdConfirmed && !contactBlocked && candidateAffiliation) {
        const affiliationEmail = ContactParser.extractPrimaryEmail(candidateAffiliation);
        if (affiliationEmail) {
          candidateEmail = affiliationEmail;
          candidateEmailSource = 'affiliation';
        }
      }
      // Reject anti-scrape MUNGED addresses (e.g. name@nospam.uni.edu) that paid
      // search can capture verbatim — undeliverable and not auto-de-mungeable. Mirrors
      // the shared `pickVettedEmail` gate the automated paths (A reconciler / B1 promote)
      // use, closing the same class on this interactive save path. Enrichment-/auto-sourced
      // only — a PD's hand-typed contact (pdConfirmed) is the human's call. Nulling the
      // email also nulls its persisted source (the researcher upsert gates source on email).
      if (candidateEmail && !pdConfirmed && isAntiScrapeMunge(candidateEmail)) {
        candidateEmail = null;
      }
      // Enrichment stores the ORCID iD as `orcidId` (not `orcid`); read that key
      // so a candidate carrying only contactEnrichment doesn't drop a real ORCID.
      const candidateOrcid = contactBlocked ? null : (candidate.orcid || enrichment.orcidId || null);
      const candidateGoogleScholarId = contactBlocked ? null : (candidate.googleScholarId || enrichment.googleScholarId || null);
      const rawCandidateWebsite = websiteAllowed ? (pdConfirmed ? (candidate.website || null) : (candidate.website || enrichment.website || null)) : null;
      const candidateWebsite = ContactParser.sanitizeWebsiteForCandidate(rawCandidateWebsite, candidate.name);
      const rawCandidateFacultyPageUrl = (websiteAllowed && !pdConfirmed) ? (candidate.facultyPageUrl || enrichment.facultyPageUrl || null) : null;
      const candidateFacultyPageUrl = rawCandidateFacultyPageUrl && !ContactParser.isDocumentUrl(rawCandidateFacultyPageUrl) ? rawCandidateFacultyPageUrl : null;

      const expertiseForDv = Array.isArray(candidate.expertiseAreas)
        ? candidate.expertiseAreas.filter(Boolean).join('; ')
        : (candidate.expertise || null);
      const gatedExpertiseForDv = contactBlocked ? null : expertiseForDv;

      const sources = saveSourceListForCandidate(candidate);
      if (sources.length === 0) sources.push('unknown');

      // Persist the recency-weighted relevance score (0–100), attached by
      // rankByRelevance at /discover + the Workbench re-rank. Prefer it over
      // the 0–1 verificationConfidence so `wmkf_relevancescore` reflects the
      // recency ranking for verified (Track A) candidates too — previously
      // Track A stored verificationConfidence (0–1) while Track B stored
      // relevanceScore (0–100), mixing scales in one field (S223). isFinite so
      // a legitimate 0 (dormant candidate) is kept; verificationConfidence is
      // the fallback only when no rank score is present.
      const relevanceScore = Number.isFinite(candidate.relevanceScore)
        ? candidate.relevanceScore
        : (candidate.verificationConfidence || 0.5);

      // Note: a same-institution row (hasInstitutionCOI) never reaches here — it is
      // hard-rejected above (S240). So no institution-COI annotation is appended.
      let matchReason = candidate.reasoning || candidate.generatedReasoning || '';
      if (pdConfirmed) {
        // Audit trail: this row entered the pool on a PD's explicit identity
        // confirmation, not the auto-resolver. Visible in the candidate's "Why".
        matchReason += ' [Identity confirmed by PD; contact entered manually]';
      }
      if (candidate.hasCoauthorCOI) {
        matchReason += candidate.coauthorCOIStrength === 'possible'
          ? ' [Possible coauthor overlap: shared paper(s) with proposal author(s) — may be incidental]'
          : ' [Coauthor COI: Has co-authored with proposal authors]';
      }

      // Identity gate (Phase 2 — REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
      // The resolver's verdict (attached to contactEnrichment.identity) is the
      // gate: bibliometrics/ORCID persist only when status ∈ {confirmed,probable}.
      //   - blockByIdentity: resolver verdict below probable → block ALL
      //     resolver-sourced fields (scholar id/url, metrics, ORCID id/url).
      //   - scholarSkipped: Phase-1 fallback when no resolver verdict is present
      //     (enrichment didn't run) — blocks the scholar id/url + metrics only.
      // Passing null is a safe no-op in the adapter (pruneEmpty drops it); a true
      // downgrade additionally CLEARS any stale value below via clearIdentityFields.
      const scholarSkipped = !!enrichment.tierResults?.openalex_author?.skipped;
      const identity = enrichment.identity || null;
      // A candidate loaded from the durable Find-tab roster has had its
      // identity/tierResults pruned away, but `pruneCandidateForRoster` left
      // safe boolean persist flags so the gate still holds after a reload
      // (Codex post-impl HIGH). `=== false` so they only ever TIGHTEN the gate,
      // never loosen it for fresh (full-object) candidates that lack the flags.
      // PD-confirmed rows force ALL resolver-sourced identity fields null: the PD
      // vouched for WHO the person is + supplied contact, but the auto-fetched ORCID/
      // Scholar/metrics were never identity-confirmed and may belong to a namesake.
      const blockByIdentity = pdConfirmed
        || (!!identity && !mayPersistIdentity(identity.status))
        || candidate.identityPersistAllowed === false
        || contactBlocked; // unresolved cited/PI-named exempt row → null ORCID/Scholar/metrics too
      const blockScholar = pdConfirmed || scholarSkipped || blockByIdentity
        || candidate.scholarPersistAllowed === false;
      const effectiveLookupOrcid = (pdConfirmed || blockByIdentity) ? null : candidateOrcid;

      let contactMatch = validatedSeedAnchor?.lookup || null;
      try {
        if (!contactMatch) {
          contactMatch = await lookupReviewerIdentity({
            name: candidate.name,
            email: candidateEmail || null,
            orcid: effectiveLookupOrcid || null,
          });
        }
      } catch (lookupErr) {
        console.warn('[save-candidates] reviewer identity lookup failed (non-fatal):', lookupErr?.message || lookupErr);
      }

      const potentialReviewerId = validatedSeedAnchor?.potentialReviewerId || (await potentialReviewerAdapter.upsertByEmail({
        name: candidate.name,
        email: candidateEmail,
        affiliation: candidateAffiliation,
        expertise: gatedExpertiseForDv,
        // Proposal-scoped reasoning is retained even when contact/profile fields are blocked.
        whyChosen: matchReason || null,
      }, { actingUserSystemId })).id;

      if (
        contactMatch?.outcome === 'confident'
        && contactMatch.match?.contactId
        && (contactMatch.match.matchKey === 'orcid' || contactMatch.match.matchKey === 'email')
      ) {
        try {
          await potentialReviewerAdapter.setContactLink(potentialReviewerId, contactMatch.match.contactId, { actingUserSystemId });
        } catch (linkErr) {
          if (linkErr?.code === 'reviewer_linked_elsewhere') {
            console.warn(
              `[save-candidates] potentialReviewer ${potentialReviewerId} already linked elsewhere; keeping live link authoritative.`
            );
          } else {
            console.warn('[save-candidates] setContactLink failed (non-fatal):', linkErr?.message || linkErr);
          }
        }
      } else if (contactMatch?.outcome === 'candidates' || contactMatch?.outcome === 'conflict') {
        try {
          await NotificationService.notify({
            type: 'reviewer_contact_match_needs_review',
            severity: 'warning',
            title: 'Reviewer saved without CRM contact link',
            message: `Reviewer candidate "${candidate.name}" was saved for request ${requestId}, but CRM contact matching returned ${contactMatch.outcome}${contactMatch.reason ? ` (${contactMatch.reason})` : ''}. The reviewer remains unlinked for staff review.`,
            metadata: {
              requestId,
              potentialReviewerId,
              candidateName: candidate.name || null,
              candidateEmail: candidateEmail || null,
              candidateOrcid: effectiveLookupOrcid || null,
              candidateAffiliation: candidateAffiliation || null,
              lookupOutcome: contactMatch.outcome,
              conflictReason: contactMatch.outcome === 'conflict' ? contactMatch.reason : null,
              conflictDetails: contactMatch.outcome === 'conflict' ? contactMatch.details : null,
              candidates: contactMatch.outcome === 'candidates' ? contactMatch.candidates : [],
              policyDecision: 'save_unlinked_staff_review',
            },
            source: 'reviewer-finder/save-candidates',
            category: 'reviewers',
            autoResolveKey: `reviewer-contact-match:${potentialReviewerId}:${requestId}`,
          });
        } catch (notifyErr) {
          console.warn('[save-candidates] contact match review alert failed (non-fatal):', notifyErr?.message || notifyErr);
        }
      }

      await researcherAdapter.upsertByPotentialReviewer(potentialReviewerId, {
        name: candidate.name,
        normalizedName,
        email: candidateEmail,
        emailSource: candidateEmail ? candidateEmailSource : null,
        orcid: blockByIdentity ? null : candidateOrcid,
        orcidUrl: blockByIdentity ? null : (candidate.orcidUrl || candidate.contactEnrichment?.orcidUrl || null),
        googleScholarId: blockScholar ? null : candidateGoogleScholarId,
        googleScholarUrl: blockScholar ? null : (candidate.googleScholarUrl || candidate.contactEnrichment?.googleScholarUrl || null),
        // Fall back to contactEnrichment like every other field above —
        // enrichment writes bibliometrics there, and not all callers promote
        // them to the candidate top-level (the standalone Reviewer Finder does
        // not), so reading candidate.* only would silently drop fetched metrics.
        hIndex: blockScholar ? null : (candidate.hIndex ?? enrichment.hIndex ?? null),
        i10Index: blockScholar ? null : (candidate.i10Index ?? enrichment.i10Index ?? null),
        totalCitations: blockScholar ? null : (candidate.totalCitations ?? enrichment.totalCitations ?? null),
        affiliation: candidateAffiliation,
        department: contactBlocked ? null : (candidate.department || enrichment.department || null),
        website: candidateWebsite,
        facultyPageUrl: candidateFacultyPageUrl,
        keywords: gatedExpertiseForDv,
      }, { actingUserSystemId });

      // Persist the resolver decision on the person; on a downgrade, also CLEAR
      // any stale resolver-sourced identity fields (upsert's null is a no-op, so
      // an explicit null-PATCH is required to remove a previously-wrong value).
      // Skip for PD-confirmed rows: the resolver verdict was NOT 'confirmed', and a
      // manual PD assertion shouldn't be written as a resolver decision. Leave
      // wmkf_identitystatus untouched (mirrors the manual-add path) while the
      // blockByIdentity gate above still keeps resolver-sourced fields out.
      if (!pdConfirmed && identity) {
        await researcherAdapter.writeIdentityDecision(potentialReviewerId, identity, { actingUserSystemId });
        if (blockByIdentity) {
          await researcherAdapter.clearIdentityFields(potentialReviewerId, RESOLVER_SOURCED_FIELDS, { actingUserSystemId });
        }
      }

      const suggestionResult = await reviewerSuggestionAdapter.upsert({
        potentialReviewerId,
        requestId,
        suggestionLabel: proposalTitle ? `${proposalTitle} — ${candidate.name}` : null,
        grantCycleCode: grantCycleCode || null,
        programArea: programArea || null,
        relevanceScore,
        matchReason,
        sources: sources.join(','),
        selected: true,
        summaryBlobUrl: summaryBlobUrl || null,
      }, { actingUserSystemId });

      try {
        await stampSuggestionAnchor(requestId, candidate.name, {
          suggestionId: suggestionResult?.id,
          potentialReviewerId,
        });
      } catch (stampErr) {
        console.warn('[save-candidates] roster suggestion anchor stamp failed (non-fatal):', stampErr?.message || stampErr);
      }

      savedCount++;
      savedNames.push(candidate.name);
    } catch (candidateError) {
      console.error(`Error saving candidate ${rawCandidate?.name}:`, candidateError.message);
      errors.push({ name: rawCandidate?.name, error: candidateError.message });
    }
  }

  // If nothing saved AND the only reason was unresolved-identity rejections, this is
  // a validation failure (422), not a generic empty/500 — gives the caller (esp. the
  // standalone Reviewer Finder, which has no client-side identity gate) a clear signal.
  if (savedCount === 0 && (rejectedUnresolved + rejectedInstitutionCOI) === candidates.length) {
    throw new SaveCandidatesError('all candidates rejected', 422, {
      error: 'Selected candidates were not saved — they need identity review or are at the PI’s institution.',
      success: false,
      savedCount: 0,
      savedNames,
      totalRequested: candidates.length,
      rejectedUnresolved,
      rejectedInstitutionCOI,
      errors,
    });
  }

  if (savedCount === 0) {
    throw new SaveCandidatesError('no candidates saved', 500, {
      error: 'No candidates were saved.',
      success: false,
      savedCount: 0,
      savedNames,
      totalRequested: candidates.length,
      rejectedUnresolved: rejectedUnresolved > 0 ? rejectedUnresolved : undefined,
      rejectedInstitutionCOI: rejectedInstitutionCOI > 0 ? rejectedInstitutionCOI : undefined,
      errors,
    });
  }

  return {
    success: true,
    savedCount,
    savedNames,
    totalRequested: candidates.length,
    rejectedUnresolved: rejectedUnresolved > 0 ? rejectedUnresolved : undefined,
    rejectedInstitutionCOI: rejectedInstitutionCOI > 0 ? rejectedInstitutionCOI : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}
