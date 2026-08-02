/**
 * One-candidate coauthor-COI stage producer.
 *
 * This adapter deliberately calls only `checkCoauthorHistory`; it never uses
 * the batch discovery helper.  It projects the bounded result into the common
 * warm-stage envelope but performs no persistence or freshness/CAS decision.
 */

const { createHash } = require('crypto');
const {
  checkCoauthorHistory,
  gradeCoauthorCOI,
} = require('../../discovery/coauthor-coi');
const { abortError } = require('../../contact-enrichment/abort');
const {
  normalizeProposalAuthor,
  normalizeProposalAuthors,
} = require('../../reviewer-proposal-author-fingerprint');

const CONTRACT_VERSION = 1;
const MAX_COAUTHOR_ROWS = 16;
const MAX_PAPERS_PER_AUTHOR = 3;
const MAX_TITLE_LENGTH = 600;
const MAX_FAILURES = 16;
const MAX_SOURCE_VERSION_LENGTH = 160;

const FAILURE_REASONS = new Set(['rate_limited', 'unavailable']);

function canonicalNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString();
}

function validSourceVersion(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SOURCE_VERSION_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function authoritativeSourceVersion(expectedSourceVersion) {
  return typeof expectedSourceVersion === 'string' && /^[a-f0-9]{64}$/i.test(expectedSourceVersion)
    ? expectedSourceVersion.toLowerCase()
    : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function resultVersion(value) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function stageEnvelope({
  outcome,
  evidencePatch = {},
  sourceVersion,
  reasonCode = null,
  failureCode = null,
  now,
}) {
  const boundedSourceVersion = validSourceVersion(sourceVersion) ? sourceVersion : 'source_version_missing';
  const completedAt = outcome === 'current' || outcome === 'not_applicable'
    ? canonicalNow(now)
    : null;
  return {
    outcome,
    evidencePatch,
    receipt: {
      state: outcome,
      contractVersion: CONTRACT_VERSION,
      sourceVersion: boundedSourceVersion,
      resultVersion: resultVersion({ outcome, evidencePatch, reasonCode, failureCode }),
      completedAt,
      reasonCode,
      failureCode,
    },
  };
}

function throwIfAborted(signal, deadlineAt) {
  if (signal?.aborted) throw abortError(signal);
  if (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt) {
    const error = new Error('reviewer_time_budget_exceeded');
    error.code = 'reviewer_time_budget_exceeded';
    throw error;
  }
}

function safeInt(value, fallback = 0, max = 10000) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function boundedCoauthorships(value, proposalAuthors) {
  const allowedAuthors = new Set(proposalAuthors.map((author) => author.toLocaleLowerCase('en-US')));
  const out = [];
  for (const entry of (Array.isArray(value) ? value : [])) {
    const proposalAuthor = normalizeProposalAuthor(entry?.proposalAuthor);
    if (!proposalAuthor || !allowedAuthors.has(proposalAuthor.toLocaleLowerCase('en-US'))) continue;
    const papers = [];
    for (const paper of (Array.isArray(entry?.recentPapers) ? entry.recentPapers : []).slice(0, MAX_PAPERS_PER_AUTHOR)) {
      const title = typeof paper?.title === 'string' ? paper.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
      const year = Number.isInteger(paper?.year) && paper.year >= 1800 && paper.year <= 3000 ? paper.year : null;
      const pmid = typeof paper?.pmid === 'string' && /^\d{1,16}$/.test(paper.pmid) ? paper.pmid : null;
      if (!title && !pmid) continue;
      papers.push({ title: title || null, year, pmid, url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}` : null });
    }
    const paperCount = safeInt(entry?.paperCount, papers.length);
    if (paperCount === 0 && papers.length === 0) continue;
    out.push({ proposalAuthor, paperCount, recentPapers: papers });
    if (out.length >= MAX_COAUTHOR_ROWS) break;
  }
  return out;
}

function boundedFailures(value, proposalAuthors) {
  const allowedAuthors = new Set(proposalAuthors.map((author) => author.toLocaleLowerCase('en-US')));
  const out = [];
  const seen = new Set();
  for (const entry of (Array.isArray(value) ? value : [])) {
    const proposalAuthor = normalizeProposalAuthor(entry?.proposalAuthor);
    if (!proposalAuthor || !allowedAuthors.has(proposalAuthor.toLocaleLowerCase('en-US'))) continue;
    const key = proposalAuthor.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      proposalAuthor,
      status: Number.isInteger(entry?.status) && entry.status >= 100 && entry.status <= 599 ? entry.status : null,
      reason: FAILURE_REASONS.has(entry?.reason) ? entry.reason : 'unavailable',
    });
    if (out.length >= MAX_FAILURES) break;
  }
  return out;
}

function boundedAuthorResults(proposalAuthors, coauthorships, failures) {
  if (proposalAuthors.length > MAX_COAUTHOR_ROWS) return null;
  const coauthorshipByAuthor = new Map(coauthorships.map((entry) => [
    entry.proposalAuthor.toLocaleLowerCase('en-US'),
    entry,
  ]));
  const failureByAuthor = new Map(failures.map((entry) => [
    entry.proposalAuthor.toLocaleLowerCase('en-US'),
    entry,
  ]));
  return proposalAuthors.map((author) => {
    const key = author.toLocaleLowerCase('en-US');
    const coauthorship = coauthorshipByAuthor.get(key);
    const failed = failureByAuthor.has(key);
    return {
      author,
      status: failed ? 'failed' : 'complete',
      sharedPaperCount: coauthorship?.paperCount || 0,
      papers: (coauthorship?.recentPapers || []).map((paper) => ({
        pmid: paper.pmid,
        title: paper.title,
        year: paper.year,
      })),
    };
  });
}

function boundedPriorAuthorResults(value, proposalAuthors) {
  if (!Array.isArray(value) || value.length !== proposalAuthors.length) return null;
  const allowedAuthors = new Set(proposalAuthors.map((author) => author.toLocaleLowerCase('en-US')));
  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    const author = normalizeProposalAuthor(entry?.author);
    const status = entry?.status;
    if (!author || !allowedAuthors.has(author.toLocaleLowerCase('en-US')) || seen.has(author.toLocaleLowerCase('en-US'))
      || !['complete', 'failed'].includes(status)) return null;
    const papers = boundedCoauthorships([{
      proposalAuthor: author,
      paperCount: entry?.sharedPaperCount,
      recentPapers: entry?.papers,
    }], [author]);
    const sharedPaperCount = safeInt(entry?.sharedPaperCount, -1);
    if (sharedPaperCount < 0 || (sharedPaperCount > 0 && papers.length !== 1)) return null;
    seen.add(author.toLocaleLowerCase('en-US'));
    normalized.push({
      author,
      status,
      sharedPaperCount,
      papers: papers[0]?.recentPapers || [],
    });
  }
  return normalized;
}

function normalizedRetryAuthors(value, priorResults) {
  const expected = priorResults
    .filter((entry) => entry.status === 'failed')
    .map((entry) => entry.author);
  const retry = normalizeProposalAuthors(value);
  if (!expected.length || retry.length !== expected.length) return null;
  const expectedSet = new Set(expected.map((author) => author.toLocaleLowerCase('en-US')));
  return retry.every((author) => expectedSet.has(author.toLocaleLowerCase('en-US')))
    ? retry
    : null;
}

function preservedCompleteCoauthorships(priorResults) {
  return priorResults
    .filter((entry) => entry.status === 'complete' && entry.sharedPaperCount > 0)
    .map((entry) => ({
      proposalAuthor: entry.author,
      paperCount: entry.sharedPaperCount,
      recentPapers: entry.papers,
    }));
}

function boundedProposalAuthorVersion(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * Project an already-completed cold coauthor check. This never calls PubMed:
 * the caller supplies only server-computed discover output plus the sealed
 * analysis author-set fingerprint. A coverage vector represents every bounded
 * author (including complete zero-paper checks), so a clean receipt cannot be
 * minted from positive-only evidence.
 */
function projectColdCoauthorCoiEvidence({
  candidate = {},
  proposalAuthors,
  proposalAuthorVersion,
  sourceVersion,
  expectedSourceVersion = null,
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const authors = normalizeProposalAuthors(proposalAuthors);
  const authorVersion = boundedProposalAuthorVersion(proposalAuthorVersion);
  if (!authorVersion) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  if (!authors.length) {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'no_proposal_authors',
      evidencePatch: {
        hasCoauthorCOI: false,
        coauthorships: [],
        coauthorSharedPaperTotal: 0,
        coauthorMaxWithOneAuthor: 0,
        coauthorCOIStrength: null,
        coauthorCheckStatus: 'not_applicable',
        coauthorCheckFailures: [],
        coauthorAuthorResults: [],
        proposalAuthorVersion: authorVersion,
      },
      now,
    });
  }

  const coauthorships = boundedCoauthorships(candidate.coauthorships, authors);
  const coauthorCheckFailures = boundedFailures(candidate.coauthorCheckFailures, authors);
  const coauthorAuthorResults = boundedAuthorResults(authors, coauthorships, coauthorCheckFailures);
  if (!coauthorAuthorResults) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }
  const hasCoauthorship = candidate.hasCoauthorCOI === true || coauthorships.length > 0;
  const coauthorSharedPaperTotal = safeInt(
    candidate.coauthorSharedPaperTotal,
    coauthorships.reduce((sum, item) => sum + item.paperCount, 0),
  );
  const coauthorMaxWithOneAuthor = safeInt(
    candidate.coauthorMaxWithOneAuthor,
    coauthorships.reduce((max, item) => Math.max(max, item.paperCount), 0),
  );
  const evidencePatch = {
    hasCoauthorCOI: hasCoauthorship,
    coauthorships,
    coauthorSharedPaperTotal,
    coauthorMaxWithOneAuthor,
    coauthorCOIStrength: gradeCoauthorCOI({ hasCoauthorship, maxSharedWithOneAuthor: coauthorMaxWithOneAuthor }),
    coauthorCheckStatus: 'complete',
    coauthorCheckFailures,
    coauthorAuthorResults,
    proposalAuthorVersion: authorVersion,
  };
  if (candidate.coauthorCheckStatus !== 'complete' || coauthorCheckFailures.length > 0) {
    return stageEnvelope({
      outcome: 'incomplete',
      sourceVersion: authoritativeSource,
      evidencePatch: { ...evidencePatch, coauthorCheckStatus: 'incomplete' },
      failureCode: 'partial_coverage',
      now,
    });
  }
  return stageEnvelope({ outcome: 'current', sourceVersion: authoritativeSource, evidencePatch, now });
}

/**
 * Runs the single-candidate PubMed COI seam and emits no raw provider data.
 * An aborted signal/deadline rejects so the caller owns lease failure state.
 */
async function produceCoauthorCoiEvidence({
  candidate,
  proposalAuthors,
  proposalAuthorVersion = null,
  sourceVersion,
  expectedSourceVersion = null,
  priorAuthorResults = null,
  retryAuthors = null,
  signal,
  deadlineAt,
  check = checkCoauthorHistory,
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const candidateName = normalizeProposalAuthor(candidate?.name);
  if (!candidateName) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const authorVersion = boundedProposalAuthorVersion(proposalAuthorVersion);
  if (!authorVersion) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const authors = normalizeProposalAuthors(proposalAuthors);
  if (!authors.length) {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'no_proposal_authors',
      evidencePatch: {
        hasCoauthorCOI: false,
        coauthorships: [],
        coauthorSharedPaperTotal: 0,
        coauthorMaxWithOneAuthor: 0,
        coauthorCOIStrength: null,
        coauthorCheckStatus: 'not_applicable',
        coauthorCheckFailures: [],
        coauthorAuthorResults: [],
        proposalAuthorVersion: authorVersion,
      },
      now,
    });
  }

  const priorCoverage = priorAuthorResults === null
    ? null
    : boundedPriorAuthorResults(priorAuthorResults, authors);
  if (priorAuthorResults !== null && !priorCoverage) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }
  const authorsToCheck = priorCoverage
    ? normalizedRetryAuthors(retryAuthors, priorCoverage)
    : authors;
  if (!authorsToCheck) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }

  throwIfAborted(signal, deadlineAt);
  let raw;
  try {
    raw = await check(candidateName, authorsToCheck, { signal });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'reviewer_time_budget_exceeded') throw error;
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }
  throwIfAborted(signal, deadlineAt);
  if (!raw || typeof raw !== 'object') {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }

  const coauthorships = boundedCoauthorships([
    ...(priorCoverage ? preservedCompleteCoauthorships(priorCoverage) : []),
    ...(Array.isArray(raw.coauthorships) ? raw.coauthorships : []),
  ], authors);
  const coauthorCheckFailures = boundedFailures(raw.coauthorCheckFailures, authorsToCheck);
  const coauthorAuthorResults = boundedAuthorResults(authors, coauthorships, coauthorCheckFailures);
  if (!coauthorAuthorResults) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }
  // A retry receives a provider summary for *only the failed author subset*.
  // Never let its 0 totals erase a previously complete positive conflict.
  // The bounded merged rows are the sole complete evidence set, so derive all
  // aggregate and strength values from them deterministically.
  const hasCoauthorship = coauthorships.length > 0;
  const sharedPaperTotal = coauthorships.reduce((sum, item) => sum + item.paperCount, 0);
  const maxSharedWithOneAuthor = coauthorships.reduce((max, item) => Math.max(max, item.paperCount), 0);
  const evidencePatch = {
    hasCoauthorCOI: hasCoauthorship,
    coauthorships,
    coauthorSharedPaperTotal: sharedPaperTotal,
    coauthorMaxWithOneAuthor: maxSharedWithOneAuthor,
    coauthorCOIStrength: gradeCoauthorCOI({ hasCoauthorship, maxSharedWithOneAuthor }),
    coauthorCheckStatus: coauthorCheckFailures.length > 0 || raw.coauthorCheckStatus === 'incomplete'
      ? 'incomplete'
      : 'complete',
    coauthorCheckFailures,
    coauthorAuthorResults,
    proposalAuthorVersion: authorVersion,
  };
  if (evidencePatch.coauthorCheckStatus === 'incomplete') {
    return stageEnvelope({
      outcome: 'incomplete',
      sourceVersion: authoritativeSource,
      evidencePatch,
      failureCode: 'partial_coverage',
      now,
    });
  }
  if (raw.coauthorCheckStatus && raw.coauthorCheckStatus !== 'complete') {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }
  return stageEnvelope({ outcome: 'current', sourceVersion: authoritativeSource, evidencePatch, now });
}

module.exports = {
  COAUTHOR_COI_EVIDENCE_PATCH_KEYS: Object.freeze([
    'hasCoauthorCOI', 'coauthorships', 'coauthorSharedPaperTotal',
    'coauthorMaxWithOneAuthor', 'coauthorCOIStrength', 'coauthorCheckStatus',
    'coauthorCheckFailures',
  ]),
  produceCoauthorCoiEvidence,
  projectColdCoauthorCoiEvidence,
};
