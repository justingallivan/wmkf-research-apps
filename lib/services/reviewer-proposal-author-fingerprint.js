/**
 * Canonical proposal-author fingerprint shared by Reviewer Find cold paths.
 *
 * This helper is pure and server-safe.  The fingerprint is intentionally
 * bound to both the exact Graph proposal content version and the normalized
 * author set so two proposal versions cannot share coauthor authority.
 */

const { createHash } = require('crypto');

const MAX_AUTHORS = 48;
const MAX_AUTHOR_NAME_LENGTH = 240;
const CONTENT_VERSION_RE = /^[a-f0-9]{64}$/i;

function normalizeProposalAuthor(value) {
  const author = typeof value === 'string'
    ? value.replace(/^(?:Dr\.?|Prof\.?|Professor)\s+/i, '').replace(/\s+/g, ' ').trim()
    : '';
  if (!author || author.length > MAX_AUTHOR_NAME_LENGTH || author.toLowerCase() === 'not specified') {
    return null;
  }
  return author;
}

function normalizeProposalAuthors(value) {
  const authors = [];
  const seen = new Set();
  for (const raw of (Array.isArray(value) ? value : [])) {
    const author = normalizeProposalAuthor(raw);
    if (!author) continue;
    const key = author.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    authors.push(author);
    if (authors.length >= MAX_AUTHORS) break;
  }
  return authors;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proposalAuthorFingerprint(proposalContentVersion, proposalAuthors) {
  const version = typeof proposalContentVersion === 'string'
    ? proposalContentVersion.trim().toLowerCase()
    : '';
  if (!CONTENT_VERSION_RE.test(version) || !Array.isArray(proposalAuthors)) return null;
  const authors = normalizeProposalAuthors(proposalAuthors);
  return createHash('sha256')
    .update(`reviewer-stage-proposal-authors:v1\n${stableStringify({
      proposalContentVersion: version,
      authors,
    })}`)
    .digest('hex');
}

module.exports = {
  normalizeProposalAuthor,
  normalizeProposalAuthors,
  proposalAuthorFingerprint,
};
