/**
 * ContactEnrichmentService — persistence (DAL write) cluster.
 *
 * Stage 8 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: `saveToDatabase` and its `_fieldPersistAllowed` helper moved
 * verbatim out of contact-enrichment-service.js; the internal
 * `this._fieldPersistAllowed(...)` self-calls became direct sibling-function
 * calls. The facade keeps thin delegating wrappers for both (C2/C10).
 *
 * C5 (the defining DAL-boundary rule,
 * docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md ~211-223): this module
 * imports the `potentialReviewerAdapter`/`researcherAdapter` adapters but MUST
 * NOT re-export their identities (no re-export of the adapters themselves) —
 * that is what keeps `check:dataverse-access-layer` and
 * `check:route-service-boundary` green (both run with no allowlist/baseline).
 * The `return withDalContext(...)` wrapper stays around every adapter call.
 */

const { ContactParser } = require('../../utils/contact-parser');
const potentialReviewerAdapter = require('../../dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../dataverse/adapters/researcher');
const { withDalContext } = require('../../dataverse/core/context');
const { mayPersistIdentity } = require('../reviewer-identity-resolver');
const { EXPLICIT_EMAIL_PERSIST_SOURCES } = require('./constants');
const { syntheticReviewerIsolationEnabled } = require('../test-requests/isolation');

function fieldPersistAllowed(enrichment = {}, fieldName, sourceName = null) {
  if (enrichment.contactStatus === 'unresolved') return false;
  if (enrichment[fieldName] === false) return false;
  if (enrichment[fieldName] === true) return true;
  return !EXPLICIT_EMAIL_PERSIST_SOURCES.has(sourceName);
}

/**
 * Save enrichment results to Dataverse (only if a potentialreviewer
 * already exists for the enriched email).
 *
 * W5 caller migration: previously wrote to Postgres `researchers` via
 * `DatabaseService.createOrUpdateResearcher`. Now writes to Dataverse:
 *   1. `wmkf_potentialreviewer` (email-keyed canonical person record)
 *      — only if a row already exists for this email (mirrors prior
 *      "only update if researcher already exists" gating)
 *   2. bibliometric fields on `wmkf_potentialreviewer` (S213: formerly the
 *      `wmkf_appresearcher` 1:1 sidecar, now folded onto the person)
 *
 * The condition "researcher hasn't been saved by user yet — skip" maps
 * to "no `wmkf_potentialreviewer` row exists for this email yet — skip"
 * since save-candidates.js (the user-explicit-save path) is the only
 * code creating those rows.
 */
async function saveToDatabase(candidate, enrichment) {
  // This email-keyed side path has no Request/person pairing proof. During a
  // reviewer-isolation outage it must not turn an unmarked lookup into an
  // ordinary-person identity write.
  if (!syntheticReviewerIsolationEnabled()) return;
  if (!enrichment?.email) return;
  const emailAllowed = fieldPersistAllowed(enrichment, 'emailPersistAllowed', enrichment.emailSource);
  const websiteAllowed = fieldPersistAllowed(enrichment, 'websitePersistAllowed', enrichment.websiteSource);
  const affiliationAllowed = enrichment.affiliationPersistAllowed !== false && enrichment.contactStatus !== 'unresolved';
  if (!emailAllowed) return;

  // Establish a Dynamics context for this save (Codex W5-step-1 Q7).
  // DynamicsService.queryRecords fails closed without an ALS/bypass
  // context; some callers of contact-enrichment establish one upstream
  // (e.g. save-candidates.js), but enrichment runs from multiple paths
  // — wrap defensively so a missing-context environment doesn't
  // silently swallow the failure through the catch below.
  return withDalContext('contact-enrichment-save', async () => {
    let prUpdated = false;
    // Persist the effective (post-override) affiliation evidence when the
    // identity-gated pin fired — falls back to the original discovery
    // affiliation otherwise (S224 #15). upsertByEmail is fill-only, so this
    // only fills an empty field; it never clobbers a staff edit.
    const effectiveAffiliation = affiliationAllowed ? (enrichment.affiliation || candidate.affiliation) : null;
    const website = websiteAllowed ? enrichment.website : null;
    const rawFacultyPageUrl = websiteAllowed ? enrichment.facultyPageUrl : null;
    const facultyPageUrl = rawFacultyPageUrl && !ContactParser.isDocumentUrl(rawFacultyPageUrl) ? rawFacultyPageUrl : null;
    try {
      const existing = await potentialReviewerAdapter.getByEmail(enrichment.email);
      if (!existing) {
        // Person not yet saved by user — skip. Mirrors prior PG behavior.
        return;
      }
      if (!syntheticReviewerIsolationEnabled()
        || (existing.wmkf_issyntheticreviewer !== false && existing.wmkf_issyntheticreviewer !== null)) return;

      // 1. Confirm this is still the owner of the email. Automated reuse
      //    does not prefill shared fields; the researcher adapter below
      //    owns the guarded update.
      const potentialReviewerWrite = await potentialReviewerAdapter.upsertByEmail({
        name: candidate.name,
        email: enrichment.email,
        // S387: the address travels with its provenance. This path re-asserts an address
        // that already exists on the row (the `getByEmail` above returned early otherwise),
        // so nothing new is introduced — but passing the source keeps the pairing invariant
        // true at every call site instead of relying on each caller's context, and lets the
        // adapter's precedence rule see this evidence rather than only the researcher write
        // below.
        emailSource: enrichment.emailSource || undefined,
        affiliation: effectiveAffiliation,
      }, { existing, readOnlyReuse: true });
      prUpdated = potentialReviewerWrite?.reusedWithoutWrite !== true;

      // 2. Update the person row with the bibliometric/contact
      //    enrichment payload. potentialReviewerId is the existing row's
      //    PK (note: `wmkf_potentialreviewersid` plural-with-s, see W4
      //    backfill notes). A failure here is logged separately from a clean
      //    skip so the partial-failure state remains visible.
      // Identity gate (Phase 2) — this email-keyed side path (enrich-contacts
      // with persist:true) must honor the resolver verdict too, or merely
      // enriching can persist an unresolved/wrong ORCID/Scholar onto a person.
      // Fail-open like the id-keyed paths: act only on an actual <probable
      // verdict (don't wipe data on a resolver error or an un-enriched re-save).
      const identity = enrichment.identity || null;
      const blockByIdentity = !!identity && !mayPersistIdentity(identity.status);
      // Phase-1 fallback (no resolver verdict): the OpenAlex author was skipped
      // (no anchor / unresolved / identity gate failed). Slice 1b renamed this
      // tierResult from `scholar_profile` to `openalex_author`.
      const blockScholar = !!enrichment.tierResults?.openalex_author?.skipped || blockByIdentity;
      const personId = existing.wmkf_potentialreviewersid;
      try {
        await researcherAdapter.upsertByPotentialReviewer(
          personId,
          {
            name: candidate.name,
            email: enrichment.email,
            emailSource: enrichment.emailSource,
            orcid: blockByIdentity ? null : enrichment.orcidId,
            orcidUrl: blockByIdentity ? null : enrichment.orcidUrl,
            googleScholarUrl: blockScholar ? null : enrichment.googleScholarUrl,
            affiliation: effectiveAffiliation,
            facultyPageUrl,
            website,
          },
          {
            automatedIdentityDecision: { decision: identity, persistDecision: !!identity },
            expectedStoredEmail: existing.wmkf_emailaddress ?? null,
          },
        );
      } catch (sidecarErr) {
        console.error(
          `Dataverse enrichment partial-failure: person ${existing.wmkf_potentialreviewersid} was checked, ` +
            `but guarded researcher upsert failed: ${sidecarErr.message}`,
        );
        throw sidecarErr;
      }
    } catch (error) {
      if (prUpdated) {
        // Already logged the partial-failure context above; the outer
        // catch is just to keep the original "log + return" contract.
        return;
      }
      console.error('Dataverse enrichment save error:', error.message);
    }
  });
}

module.exports = {
  fieldPersistAllowed,
  saveToDatabase,
};
