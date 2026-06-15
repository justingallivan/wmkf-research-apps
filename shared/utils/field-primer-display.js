/**
 * Field Primer — expert display helpers (profile links + bibliometrics).
 *
 * Shared by BOTH render surfaces so they can never drift:
 *   - renderPrimerMarkdown (lib/services/field-primer-service.js, server)
 *   - ProposalTab PrimerView (shared/components/workbench/ProposalTab.js, client)
 *
 * SCOPE: orientation only. The primer is staff-facing field orientation and is
 * NEVER a reviewer-candidate or CONTACT source (see field-primer-service.js /
 * shared/config/prompts/field-primer.js). So this module surfaces only PUBLIC
 * PROFILE links (ORCID / OpenAlex / Wikipedia) and the already-resolved
 * bibliometrics — never email or any contact channel.
 *
 * Dependency-free (safe in the client bundle). All links are built from the
 * grounded identity that `groundPrimerExperts` resolved against OpenAlex; URLs
 * are constructed from validated id tokens (we own the host) rather than trusting
 * a stored URL, and the one stored URL we pass through (Wikipedia) is scheme/host
 * validated. Only `confirmed` / `corrected` experts carry a resolved identity, so
 * `unverified` experts get no links (nothing was resolved to link to).
 */

// Bare-or-hyphenated ORCID, checksum char may be X. We build the orcid.org URL.
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i;
// OpenAlex author id token (`A` + digits), anywhere in the stored id/URL.
const OPENALEX_ID_RE = /A\d+/i;

function openAlexUrl(openAlexId) {
  const m = String(openAlexId || '').match(OPENALEX_ID_RE);
  return m ? `https://openalex.org/${m[0].toUpperCase()}` : null;
}

function orcidUrl(orcid) {
  const v = String(orcid || '').trim();
  return ORCID_RE.test(v) ? `https://orcid.org/${v.toUpperCase()}` : null;
}

// Wikipedia is a stored URL from OpenAlex's `ids.wikipedia`; pass it through only
// when it is an https Wikipedia article URL (defense-in-depth against a bad value).
function wikipediaUrl(wikipedia) {
  const v = String(wikipedia || '').trim();
  return /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\/.+/i.test(v) ? v : null;
}

/**
 * Public profile links for a grounded expert. Returns `[]` for ungrounded or
 * `unverified` experts (no identity was resolved).
 *
 * @param {Object} grounding - expert.grounding from groundPrimerExperts
 * @returns {Array<{ label: string, href: string }>}
 */
export function expertProfileLinks(grounding) {
  if (!grounding || (grounding.status !== 'confirmed' && grounding.status !== 'corrected')) return [];
  const links = [];
  const orcid = orcidUrl(grounding.orcid);
  if (orcid) links.push({ label: 'ORCID', href: orcid });
  const oa = openAlexUrl(grounding.openAlexId);
  if (oa) links.push({ label: 'OpenAlex', href: oa });
  const wiki = wikipediaUrl(grounding.wikipedia);
  if (wiki) links.push({ label: 'Wikipedia', href: wiki });
  return links;
}

/**
 * Bibliometric chips for a grounded expert (h-index, citation count). Returns
 * `null` when neither metric is present. Numbers only — orienting context, not a
 * ranking signal.
 *
 * @param {Object} grounding - expert.grounding from groundPrimerExperts
 * @returns {string[]|null}
 */
export function expertMetrics(grounding) {
  if (!grounding) return null;
  const parts = [];
  if (Number.isFinite(grounding.hIndex)) parts.push(`h-index ${grounding.hIndex}`);
  if (Number.isFinite(grounding.citedByCount)) {
    parts.push(`${grounding.citedByCount.toLocaleString('en-US')} citations`);
  }
  return parts.length ? parts : null;
}
