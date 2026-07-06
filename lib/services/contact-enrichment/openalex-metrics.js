/**
 * ContactEnrichmentService — openalex-metrics cluster.
 *
 * Stage 4 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: `_attachOpenAlexMetrics` + `_buildOpenAlexAuthorDto` moved verbatim
 * out of contact-enrichment-service.js; the internal `this._buildOpenAlexAuthorDto`
 * self-calls became direct sibling-function calls. The facade keeps a thin
 * delegating wrapper for each. DAG leaf — depends on OpenAlexService,
 * isOpenAlexAuthorAccepted, and normalizeOrcid (all stateless).
 */

const { OpenAlexService } = require('../openalex-service');
const { isOpenAlexAuthorAccepted } = require('../reviewer-identity-resolver');
const { normalizeOrcid } = require('../reviewer-work-author-resolver');

/**
 * Attach real bibliometrics (h-index / i10 / citations) + a current-affiliation
 * candidate + the verified institutional domain from OpenAlex (Slice 1b — replaces
 * the retired SerpAPI google_scholar_author calls). FREE, so it runs regardless of
 * the paid SerpAPI toggle — gated only on a trusted identity anchor. Best-effort: a
 * null/failed lookup leaves the metrics unset and never breaks enrichment. Mutates
 * `result.contactEnrichment` in place. Honors the abort `signal` (reviewer-search
 * deadline). The accepted author rides on `tierResults.openalex_author` (the 1a DTO);
 * the resolver re-proves acceptance — this method gates with the SAME allowlist
 * (`isOpenAlexAuthorAccepted`) so metrics/domain attach ONLY for an accepted author.
 *
 * Two accept paths (1a contract):
 *   - ORCID (hard key): getAuthorByOrcid(orcid) → DTO carries the record's orcid +
 *     the looked-up `claimedOrcid` (the resolver re-proves they match).
 *   - Spine: the discovery spine already resolved an OpenAlex author for this
 *     candidate (`candidate.openAlexId` + `candidate.identityStatus`); reuse that
 *     verdict (sourced, not asserted) and fetch metrics via getAuthorById — the spine
 *     is NOT re-run in the hot path. `identityStatus` already incorporated the forename
 *     gate, so `forenameContradicts` is omitted (undefined → resolver forename check passes).
 * No anchor, or no accepted author → ABSTAIN (no metrics/domain; leave the free Scholar
 * search link), mirroring the old Scholar-mismatch skip.
 */
async function attachOpenAlexMetrics(candidate, result, { signal, onProgress = () => {} } = {}) {
  const ce = result.contactEnrichment;
  const orcid = normalizeOrcid(candidate.orcid || candidate.orcidId || ce.orcidId);
  // Discovery attaches a resolved OpenAlex author id under TWO field names: the
  // OpenAlex/ORCID spine uses `openAlexId` (mapSpineVerificationResult), Track-B
  // work-grounding uses `openAlexAuthorId` (mapTrackBIdentityResult). Both pair with a
  // resolver-vocabulary `identityStatus` (confirmed/probable when trusted, else unresolved).
  const carriedAuthorId = candidate.openAlexId || candidate.openAlexAuthorId || null;
  const carriedStatus = candidate.identityStatus || null;

  if (!orcid && !(carriedAuthorId && carriedStatus)) {
    ce.scholarPersistAllowed = false;
    ce.tierResults.openalex_author = { skipped: 'identity_anchor_required' };
    onProgress({ tier: 4, status: 'skipped', message: `Bibliometrics skipped — no identity anchor for ${candidate.name}` });
    return;
  }

  try {
    let author = null;
    let dto = null;

    if (orcid) {
      // Richest entity for the ORCID, not OpenAlex's canonical pick: an ORCID can be
      // split across multiple author entities (a full record + a sparse stub), and the
      // canonical lookup can land the stub → "1 publication, h-index 0". Same ORCID =
      // same person, so the richest is the correct metrics source. (Falls back to the
      // canonical single internally if the list form is empty.)
      author = await OpenAlexService.getRichestAuthorByOrcid(orcid, { signal });
      if (author) {
        // 1b producer constraints: `orcid` = the record's returned ORCID, `claimedOrcid`
        // = the ORCID we looked up (already checksum-validated by getRichestAuthorByOrcid);
        // `openAlexId` = the canonical mapAuthorRecord id (never an assembled URL).
        dto = buildOpenAlexAuthorDto(author, {
          acceptPath: 'orcid',
          orcid: author.orcid,
          claimedOrcid: orcid,
        });
      }
    }
    if (!author && carriedAuthorId && carriedStatus) {
      author = await OpenAlexService.getAuthorById(carriedAuthorId, { signal });
      if (author) {
        dto = buildOpenAlexAuthorDto(author, {
          acceptPath: 'spine',
          identityStatus: carriedStatus,
        });
      }
    }

    if (!author || !dto) {
      ce.scholarPersistAllowed = false;
      ce.tierResults.openalex_author = { skipped: 'openalex_author_unresolved' };
      onProgress({ tier: 4, status: 'not_found', message: `No OpenAlex author resolved for ${candidate.name}` });
      return;
    }

    // Re-prove acceptance with the SAME allowlist the resolver uses (one gate, no drift).
    // A non-accepted author (e.g. the ORCID record's id differs from the looked-up ORCID)
    // contributes NO metrics/affiliation/domain — mirrors the old Scholar name/institution-
    // mismatch abstain. The DTO is still recorded (with a skip reason) for transparency;
    // the resolver re-evaluates it into a rejected anchor.
    if (!isOpenAlexAuthorAccepted(dto)) {
      ce.scholarPersistAllowed = false;
      ce.tierResults.openalex_author = { ...dto, skipped: 'identity_gate_failed' };
      onProgress({ tier: 4, status: 'skipped', message: `Bibliometrics skipped — OpenAlex identity gate failed for ${candidate.name}` });
      return;
    }

    ce.tierResults.openalex_author = dto;
    ce.scholarPersistAllowed = true;
    ce.hIndex = author.hIndex;
    ce.i10Index = author.i10Index;
    ce.totalCitations = author.citedByCount;
    // #2 dropped (open decision): OpenAlex exposes no Google Scholar `user=` id, so new
    // candidates keep the free buildGoogleScholarUrl search link. googleScholarId = null.
    ce.googleScholarId = null;

    // Current-affiliation override CANDIDATE (authority 2, below ORCID) — replaces the
    // retired Scholar `scholarAffiliations`. Collected here; the override is applied in
    // _finalize gated on the resolver verdict.
    if (typeof author.lastKnownInstitution === 'string' && author.lastKnownInstitution.trim()) {
      ce.openAlexAffiliation = author.lastKnownInstitution.trim();
    }
    ce.openAlexInstitutionId = author.lastKnownInstitutionId || null;
    ce.openAlexInstitutionRor = author.lastKnownInstitutionRor || null;

    // Verified-domain guard re-sourced from the author's institution homepage. Best-effort:
    // a failed institution lookup just leaves the guard unsourced (keeps the email untouched).
    const instRef = author.lastKnownInstitutionId || author.lastKnownInstitutionRor;
    if (instRef) {
      try {
        const inst = await OpenAlexService.getInstitution(instRef, { signal });
        if (inst?.domain) ce.verifiedInstitutionDomain = inst.domain;
      } catch (instErr) {
        if (signal?.aborted) throw instErr;
        console.error('OpenAlex institution lookup error:', instErr.message);
      }
    }

    onProgress({
      tier: 4,
      status: 'found',
      message: `Found citation metrics${author.citedByCount != null ? ` (${author.citedByCount} citations, h-index ${author.hIndex ?? '—'})` : ''}`,
    });
  } catch (err) {
    // A deadline/cancel abort must propagate so enrichCandidates() stops; other errors
    // are best-effort (metrics are optional). Record a distinguishable skip marker so
    // an OpenAlex OUTAGE is not silently indistinguishable from "no anchor / not run"
    // (Codex S251 LOW), and so the persistence/UI fallbacks fail closed on it.
    if (signal?.aborted) throw err;
    console.error('OpenAlex metrics error:', err.message);
    ce.scholarPersistAllowed = false;
    ce.tierResults.openalex_author = { skipped: 'openalex_error', error: err.message };
  }
}

/**
 * Build the `tierResults.openalex_author` evidence DTO (Slice 1a contract shape). Only
 * the canonical `mapAuthorRecord.openAlexId` is passed (1b constraint #2); metrics ride
 * along for this method's own use. `identity` carries the path-specific proof fields.
 */
function buildOpenAlexAuthorDto(author, identity) {
  return {
    openAlexId: author.openAlexId,
    displayName: author.displayName,
    lastKnownInstitution: author.lastKnownInstitution,
    ror: author.lastKnownInstitutionRor || null,
    ...identity,
    hIndex: author.hIndex,
    i10Index: author.i10Index,
    citedByCount: author.citedByCount,
  };
}

module.exports = { attachOpenAlexMetrics, buildOpenAlexAuthorDto };
