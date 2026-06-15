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
 * PROFILE links (ORCID / OpenAlex) and the already-resolved bibliometrics —
 * never email or any contact channel.
 *
 * Dependency-free except for the canonical ORCID checksum normalizer (a pure,
 * importless helper — safe in the client bundle). Links + metrics are gated to
 * `confirmed` / `corrected` experts (the only statuses `groundPrimerExperts`
 * resolves an identity for). Each href is built from a STRICTLY ANCHORED id
 * token (we own the host), so the produced URLs contain no Markdown
 * metacharacters and are safe to emit into a `[label](href)` link.
 *
 * NOTE on Wikipedia: an earlier draft surfaced a Wikipedia link from OpenAlex's
 * `ids.wikipedia`, but the live OpenAlex Author endpoint does not return that
 * field (verified 2026-06-15 against api.openalex.org for Wikipedia-notable
 * authors — `ids` carries only `openalex` + `orcid`), so the link was always
 * null. Dropped rather than shipped dead. Revisit via a Wikidata hop if wanted.
 */

import { normalizeOrcid } from '../../lib/utils/orcid-normalize';

function isGroundedIdentity(grounding) {
  return !!grounding && (grounding.status === 'confirmed' || grounding.status === 'corrected');
}

// Accept only a bare `A<digits>` token or the canonical OpenAlex author URL,
// ANCHORED end-to-end — `evil-A123` / `https://not-openalex.example/A123` /
// `fooA123bar` must NOT produce a (falsely trusted) link.
function openAlexUrl(openAlexId) {
  const m = String(openAlexId || '').trim().match(/^(?:https:\/\/openalex\.org\/)?(A\d+)$/i);
  return m ? `https://openalex.org/${m[1].toUpperCase()}` : null;
}

// Checksum-validate via the shared normalizer (not a shape-only regex), so a
// visually-valid but ISO-7064-invalid iD does not render a dead link.
function orcidUrl(orcid) {
  const norm = normalizeOrcid(orcid);
  return norm.state === 'valid' ? `https://orcid.org/${norm.id}` : null;
}

/**
 * Public profile links for a grounded expert. Returns `[]` for ungrounded or
 * `unverified` experts (no identity was resolved).
 *
 * @param {Object} grounding - expert.grounding from groundPrimerExperts
 * @returns {Array<{ label: string, href: string }>}
 */
export function expertProfileLinks(grounding) {
  if (!isGroundedIdentity(grounding)) return [];
  const links = [];
  const orcid = orcidUrl(grounding.orcid);
  if (orcid) links.push({ label: 'ORCID', href: orcid });
  const oa = openAlexUrl(grounding.openAlexId);
  if (oa) links.push({ label: 'OpenAlex', href: oa });
  return links;
}

/**
 * Bibliometric chips for a grounded expert (h-index, citation count). Returns
 * `null` for ungrounded / `unverified` experts (metrics must not lend
 * credibility to an unverified name) or when neither metric is present. Numbers
 * only — orienting context, not a ranking signal.
 *
 * @param {Object} grounding - expert.grounding from groundPrimerExperts
 * @returns {string[]|null}
 */
export function expertMetrics(grounding) {
  if (!isGroundedIdentity(grounding)) return null;
  const parts = [];
  if (Number.isFinite(grounding.hIndex)) parts.push(`h-index ${grounding.hIndex}`);
  if (Number.isFinite(grounding.citedByCount)) {
    parts.push(`${grounding.citedByCount.toLocaleString('en-US')} citations`);
  }
  return parts.length ? parts : null;
}
