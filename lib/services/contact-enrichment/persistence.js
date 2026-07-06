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
const { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } = require('../reviewer-identity-resolver');
const { EXPLICIT_EMAIL_PERSIST_SOURCES } = require('./constants');

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
    // Persist the effective (post-override) current affiliation when the
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

      // 1. Update potentialreviewer with newly enriched fields. The
      //    adapter's upsertByEmail is "fill-only" — it preserves staff
      //    edits and only fills empty fields, which is exactly the
      //    behavior we want here.
      await potentialReviewerAdapter.upsertByEmail({
        name: candidate.name,
        email: enrichment.email,
        affiliation: effectiveAffiliation,
      });
      prUpdated = true;

      // 2. Update sidecar researcher row with the bibliometric/contact
      //    enrichment payload. potentialReviewerId is the existing row's
      //    PK (note: `wmkf_potentialreviewersid` plural-with-s, see W4
      //    backfill notes). A failure here AFTER step 1 succeeded
      //    leaves the system mid-update (potentialreviewer has fresh
      //    data, sidecar doesn't) — log distinguishably so the partial-
      //    failure state is visible vs. a clean skip (Codex W5-step-1
      //    Q3).
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
        );
        // Record the verdict; clear stale resolver-sourced fields on downgrade.
        if (identity) {
          await researcherAdapter.writeIdentityDecision(personId, identity);
          if (blockByIdentity) await researcherAdapter.clearIdentityFields(personId, RESOLVER_SOURCED_FIELDS);
        }
      } catch (sidecarErr) {
        console.error(
          `Dataverse enrichment partial-failure: potentialreviewer ${existing.wmkf_potentialreviewersid} updated, ` +
            `but sidecar researcher upsert failed: ${sidecarErr.message}`,
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
