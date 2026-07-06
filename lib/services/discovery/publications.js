/**
 * DiscoveryService publications cluster — Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Preprint detection, title-dedup of publication lists (preferring the published version over
 * a preprint), the OpenAlex works backfill for identity-resolved candidates with an empty pub
 * list, and the recent-publication count. Extracted VERBATIM from discovery-service.js as a
 * behavior-freeze — internal `this.X` self-calls became direct function calls; the static
 * constants (`VERIFICATION_STATUSES`, `YEARS_LOOKBACK`, `OPENALEX_PUB_BACKFILL_*`) now come from
 * ./constants (read-only, not mutated). The DiscoveryService facade delegates each method here.
 *
 * Depends on ./constants, ../openalex-service, ../../utils/chunk.
 * Characterization net: tests/unit/discovery-openalex-publications.test.js.
 */

const {
  VERIFICATION_STATUSES,
  YEARS_LOOKBACK,
  OPENALEX_PUB_BACKFILL_LIMIT,
  OPENALEX_PUB_BACKFILL_CONCURRENCY,
} = require('./constants');
const { OpenAlexService } = require('../openalex-service');
const { chunk: chunked } = require('../../utils/chunk.js');

// A publication looks like a preprint (so it loses to a published version of the same paper
// in dedup): a preprint-server journal name (PubMed indexes some preprints, e.g. journal
// "bioRxiv"), or a preprint DOI/host in the URL (10.1101 bioRxiv, 10.48550 arXiv).
function _isPreprintPublication(pub) {
  const journal = String(pub?.journal || '').toLowerCase();
  const url = String(pub?.url || '').toLowerCase();
  return /biorxiv|medrxiv|chemrxiv|arxiv|research\s*square|ssrn|preprint/.test(journal)
    || /10\.1101\/|10\.48550\/|biorxiv\.org|medrxiv\.org|arxiv\.org/.test(url);
}

/**
 * Collapse duplicate publications by normalized title, preserving first-seen order. The
 * same paper often appears twice — a bioRxiv/arXiv preprint AND the published version (from
 * PubMed, or from OpenAlex's preprint+published records) — which would show as two
 * near-identical rows. When titles collide, prefer the PUBLISHED version over a preprint.
 * Shared by the PubMed verify path and the OpenAlex backfill. Optional `limit` caps the result.
 */
function dedupePublicationsByTitle(publications, { limit } = {}) {
  const chosen = new Map(); // normalized title -> pub
  const order = [];
  for (const pub of (Array.isArray(publications) ? publications : [])) {
    const title = pub?.title;
    if (!title) continue;
    const key = String(title).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) continue;
    if (!chosen.has(key)) {
      chosen.set(key, pub);
      order.push(key);
    } else if (_isPreprintPublication(chosen.get(key)) && !_isPreprintPublication(pub)) {
      chosen.set(key, pub); // swap the preprint for the published version (keep original order)
    }
  }
  const out = order.map((k) => chosen.get(k));
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

/**
 * Fetch the most-recent OpenAlex works for trusted candidates that have a resolved OpenAlex
 * author id but an EMPTY publication list (the spine/Track-B identity paths attach identity
 * + metrics but no works), and attach them as `publications` ({title, year, url}) so the card
 * shows papers and `publicationCount5yr` ranks correctly. Mutates candidate objects in place.
 *
 * Safety: trusted (confirmed/probable/verified) only; empty-pubs only (never clobbers an
 * existing PubMed list); bounded concurrency; aborts with the discovery deadline signal;
 * any non-abort OpenAlex error leaves the candidate unchanged (degrade, never fail the run).
 */
async function backfillOpenAlexPublications(candidates, { signal } = {}) {
  const isTrusted = (c) => c?.verified === true
    || c?.identityStatus === 'confirmed' || c?.identityStatus === 'probable'
    || c?.verificationStatus === VERIFICATION_STATUSES.VERIFIED
    || c?.verificationStatus === VERIFICATION_STATUSES.PROBABLE;

  const targets = (Array.isArray(candidates) ? candidates : []).filter((c) =>
    isTrusted(c)
    && (c.openAlexId || c.openAlexAuthorId)
    && (!Array.isArray(c.publications) || c.publications.length === 0)
  );
  if (targets.length === 0) return;

  const limit = OPENALEX_PUB_BACKFILL_LIMIT;
  const concurrency = OPENALEX_PUB_BACKFILL_CONCURRENCY;
  for (const batch of chunked(targets, concurrency)) {
    if (signal?.aborted) return; // deadline hit — leave the remaining candidates as-is
    await Promise.all(batch.map(async (c) => {
      if (signal?.aborted) return;
      try {
        const authorId = c.openAlexId || c.openAlexAuthorId;
        // Fetch a small buffer over the display limit so dedup doesn't shrink the list:
        // OpenAlex often carries duplicate records for one paper (e.g. an arXiv preprint +
        // the published version), which would otherwise show as two near-identical rows.
        const { records } = await OpenAlexService.getWorksByAuthor(authorId, { signal, limit: limit + 3 });
        const mapped = (Array.isArray(records) ? records : [])
          .map((w) => ({ title: w.title || null, year: w.year ?? null, url: w.url || null }))
          .filter((p) => p.title);
        const pubs = dedupePublicationsByTitle(mapped, { limit });
        if (pubs.length > 0) {
          c.publications = pubs;
          if (!Number.isFinite(c.publicationCount5yr)) {
            c.publicationCount5yr = countRecentPublications(pubs);
          }
        }
      } catch (err) {
        if (!signal?.aborted) {
          console.warn(`[Discovery] OpenAlex publications backfill failed for ${c?.name}: ${err.message}`);
        }
      }
    }));
  }
}

/** Count publications in the last N (YEARS_LOOKBACK) years. */
function countRecentPublications(articles) {
  const cutoffYear = new Date().getFullYear() - YEARS_LOOKBACK;
  return articles.filter(a => (a.year || 0) >= cutoffYear).length;
}

module.exports = {
  _isPreprintPublication,
  dedupePublicationsByTitle,
  backfillOpenAlexPublications,
  countRecentPublications,
};
