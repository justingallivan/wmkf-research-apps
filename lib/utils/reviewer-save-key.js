/**
 * Stable correlation key for one submitted reviewer candidate.
 *
 * This is NOT identity resolution and must never be used to merge person rows.
 * It only lets the save response identify which submitted row succeeded so a
 * partial batch does not graduate a failed same-name row in the client.
 * CommonJS keeps the exact implementation shared by the browser and service.
 */

const { normalizeReviewerName } = require('./reviewer-name-match');

const CLIENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function compact(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeOrcid(value) {
  const match = String(value || '').toUpperCase().match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/);
  return match ? match[0] : '';
}

function encode(value) {
  return encodeURIComponent(value || '-');
}

function reviewerSaveKey(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const explicit = typeof candidate.clientCandidateId === 'string'
    ? candidate.clientCandidateId.trim()
    : '';
  if (CLIENT_ID_RE.test(explicit)) return `client:${explicit}`;

  const name = normalizeReviewerName(candidate.name);
  if (!name) return null;
  const enrichment = candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  const email = compact(candidate.email || enrichment.email);
  const orcid = normalizeOrcid(candidate.orcid || enrichment.orcidId || enrichment.orcid);
  const affiliation = compact(candidate.affiliation || enrichment.affiliation);
  return `candidate:${encode(name)}|email:${encode(email)}|orcid:${encode(orcid)}|affiliation:${encode(affiliation)}`;
}

module.exports = { CLIENT_ID_RE, reviewerSaveKey };
