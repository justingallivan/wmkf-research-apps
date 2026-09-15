/**
 * Dormant server-owned `independent-identity/v1` evaluator.
 *
 * The public entry point accepts only a request binding, immutable roster key,
 * and a closed method. The injected server loader must authorize that method
 * and supply all candidate names, works, ORCID values, and lineage;
 * request/body copies are never read. Provider calls are made inside this
 * service and their failures are reflected in `providerState`. No runtime
 * caller or persistence authority is enabled by this module.
 */

const crypto = require('node:crypto');
const { canonicalJson } = require('../utils/canonical-json');
const { OpenAlexService } = require('./openalex-service');
const { ORCIDService } = require('./orcid-service');
const { PubMedService } = require('./pubmed-service');
const { buildAuthorQuery } = require('./discovery/pubmed-query');
const { nameMatchEvidence } = require('./discovery/name-matching');
const {
  forenameFullyAgrees,
  forenamesContradict,
} = require('./reviewer-identity-evidence');
const { normalizeOrcid } = require('./reviewer-work-author-resolver');

const VERSION = 'independent-identity/v1';
const RESOLVER_VERSION = 'independentReviewerIdentity@1.0.0';
const MAX_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PUBMED_RESULTS = 30;
const MAX_CLUSTER_WORKS = 10;
const MIN_CLUSTER_WORKS = 3;
const MAX_AUTHOR_POOL = 25;

const METHODS = Object.freeze({
  PUBMED_MULTI_WORK_AUTHOR: 'pubmed_multi_work_author',
  EXACT_WORK_UNIQUE_AUTHOR: 'exact_work_unique_author',
  FORENAME_WORK_GROUNDING: 'forename_work_grounding',
  HARD_ID_JOIN: 'hard_id_join',
});
const METHOD_VALUES = new Set(Object.values(METHODS));
const RESULTS = Object.freeze({
  SUFFICIENT: 'sufficient',
  INSUFFICIENT: 'insufficient',
  CONTRADICTED: 'contradicted',
  NOT_EVALUABLE: 'not_evaluable',
});

function boundedString(value, max = 240) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  return normalized ? normalized.slice(0, max) : null;
}

function normalizedDoi(value) {
  const normalized = boundedString(value, 300);
  return normalized
    ? normalized.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase()
    : null;
}

function normalizedPmid(value) {
  const normalized = boundedString(value, 80);
  return normalized ? normalized.replace(/^pmid:/i, '').toLowerCase() : null;
}

function normalizedOpenAlexId(value, prefix) {
  const match = boundedString(value, 100)?.match(new RegExp(`${prefix}\\d+$`, 'i'));
  return match ? match[0].toUpperCase() : null;
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function titleDigest(title) {
  const normalized = normalizeTitle(title);
  return normalized ? digest(normalized) : null;
}

function normalizeWorkReference(work = {}) {
  const pmid = normalizedPmid(work.pmid);
  const urlDoi = /^https?:\/\/(dx\.)?doi\.org\//i.test(String(work.url || ''))
    ? work.url
    : null;
  const doi = normalizedDoi(work.doi || urlDoi);
  const arxivId = boundedString(work.arxivId, 120);
  const openAlexWorkId = normalizedOpenAlexId(work.openAlexId, 'W');
  const normalizedTitle = normalizeTitle(work.title);
  if (!pmid && !doi && !arxivId && !openAlexWorkId && !normalizedTitle) return null;
  return {
    pmid,
    doi,
    arxivId,
    openAlexWorkId,
    title: normalizedTitle || null,
  };
}

function workKey(work = {}) {
  const reference = normalizeWorkReference(work);
  if (!reference) return null;
  if (reference.pmid) return `pmid:${reference.pmid}`;
  if (reference.doi) return `doi:${reference.doi}`;
  if (reference.arxivId) return `arxiv:${reference.arxivId.toLowerCase()}`;
  if (reference.openAlexWorkId) return `openalex:${reference.openAlexWorkId}`;
  return `title:${digest(reference.title)}`;
}

function sameWork(left, right) {
  const a = normalizeWorkReference(left);
  const b = normalizeWorkReference(right);
  if (!a || !b) return false;
  const comparisons = [
    a.pmid && b.pmid ? a.pmid === b.pmid : null,
    a.doi && b.doi ? a.doi === b.doi : null,
    a.arxivId && b.arxivId ? a.arxivId.toLowerCase() === b.arxivId.toLowerCase() : null,
    a.openAlexWorkId && b.openAlexWorkId ? a.openAlexWorkId === b.openAlexWorkId : null,
  ].filter((value) => value !== null);
  if (comparisons.includes(false)) return false;
  if (comparisons.includes(true)) return true;
  const aHasIdentifier = Boolean(a.pmid || a.doi || a.arxivId || a.openAlexWorkId);
  const bHasIdentifier = Boolean(b.pmid || b.doi || b.arxivId || b.openAlexWorkId);
  if (aHasIdentifier && bHasIdentifier) return false;
  return Boolean(a.title && b.title && a.title === b.title);
}

function strictNameMatch(candidateName, bylineName) {
  const evidence = nameMatchEvidence(candidateName, bylineName);
  return evidence.matches === true
    && evidence.fullForenameMatch === true
    && evidence.initialOnly !== true
    && forenameFullyAgrees(candidateName, bylineName);
}

function surnameToken(value) {
  const tokens = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens[tokens.length - 1] || null;
}

function hasFullForenameContradiction(candidateName, authorships = []) {
  const candidateSurname = surnameToken(candidateName);
  if (!candidateSurname) return false;
  return authorships.some((authorship) => {
    const displayName = authorship?.displayName || authorship?.name;
    const match = nameMatchEvidence(candidateName, displayName);
    return surnameToken(displayName) === candidateSurname
      && match.matches !== true
      && forenamesContradict(candidateName, displayName);
  });
}

function strictAuthorships(candidateName, work = {}) {
  return (Array.isArray(work.authorships) ? work.authorships : [])
    .map((authorship, index) => ({ authorship, index }))
    .filter(({ authorship }) => strictNameMatch(candidateName, authorship?.displayName));
}

function ambiguousSameSurnameAuthorships(candidateName, work = {}) {
  const candidateSurname = surnameToken(candidateName);
  if (!candidateSurname) return [];
  return (Array.isArray(work.authorships) ? work.authorships : [])
    .map((authorship, index) => ({ authorship, index }))
    .filter(({ authorship }) => {
      const displayName = authorship?.displayName || authorship?.name;
      if (surnameToken(displayName) !== candidateSurname) return false;
      const evidence = nameMatchEvidence(candidateName, displayName);
      return evidence.matches === true && !strictNameMatch(candidateName, displayName);
    });
}

function authorCluster(authorship = {}) {
  const authorId = normalizedOpenAlexId(authorship.openAlexAuthorId, 'A');
  const orcid = normalizeOrcid(authorship.orcid);
  if (authorId) return { key: `openalex:${authorId}`, openAlexAuthorId: authorId, orcid };
  if (orcid) return { key: `orcid:${orcid}`, openAlexAuthorId: null, orcid };
  return null;
}

function providerTracker() {
  const attempts = [];
  return {
    record(provider, operation, ok) {
      attempts.push({ provider, operation, ok: ok === true });
    },
    async call(provider, operation, fn) {
      try {
        const value = await fn();
        attempts.push({ provider, operation, ok: true });
        return { ok: true, value };
      } catch (error) {
        attempts.push({ provider, operation, ok: false });
        return { ok: false, error };
      }
    },
    state() {
      const failures = attempts.filter((attempt) => !attempt.ok).length;
      if (failures === 0) return 'complete';
      return failures === attempts.length ? 'failed' : 'partial';
    },
    summary() {
      return attempts.map(({ provider, operation, ok }) => ({ provider, operation, ok }));
    },
  };
}

function completeProviderCount(value, records) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 && count >= records.length
    ? count
    : null;
}

function resultEnvelope({
  requestBinding,
  candidateKey,
  method,
  result,
  reason,
  providerState,
  providerObservedAt,
  evaluatedAt,
  digestInput,
  evidence = {},
}) {
  const observedMs = Date.parse(providerObservedAt || '');
  const evaluatedMs = Date.parse(evaluatedAt || '');
  const hasObservation = Number.isFinite(observedMs) && observedMs <= evaluatedMs + 5 * 60 * 1000;
  const expiresAt = hasObservation
    ? new Date(observedMs + MAX_TTL_MS).toISOString()
    : null;
  const stale = hasObservation && Date.parse(expiresAt) <= evaluatedMs;
  const complete = providerState === 'complete';
  const authoritativeResult = !complete || stale || !hasObservation
    ? RESULTS.NOT_EVALUABLE
    : result;
  const authoritativeReason = authoritativeResult !== result
    ? (!complete ? 'provider_incomplete' : (stale ? 'evidence_expired' : 'missing_provider_observation'))
    : reason;
  return {
    version: VERSION,
    result: authoritativeResult,
    reason: authoritativeReason,
    excludesAffiliation: true,
    method: METHOD_VALUES.has(method) ? method : null,
    resolverVersion: RESOLVER_VERSION,
    requestBinding: boundedString(requestBinding, 160),
    candidateKey: boundedString(candidateKey, 200),
    identityInputDigest: digest(digestInput),
    evaluatedAt,
    providerObservedAt: hasObservation ? new Date(observedMs).toISOString() : null,
    expiresAt,
    providerState,
    evidence,
  };
}

function baseDigestInput(binding, method, serverInputs, methodEvidence) {
  return {
    version: VERSION,
    resolverVersion: RESOLVER_VERSION,
    requestBinding: boundedString(binding.requestBinding, 160),
    candidateKey: boundedString(binding.candidateKey, 200),
    method,
    candidateName: boundedString(serverInputs?.candidateName, 240),
    sourceWork: normalizeWorkReference(serverInputs?.sourceWork),
    sourceOrcid: normalizeOrcid(serverInputs?.sourceOrcid),
    sourceOrcidLineage: boundedString(serverInputs?.sourceOrcidLineage, 80),
    crmOrcid: normalizeOrcid(serverInputs?.crmOrcid),
    crmOrcidLineage: boundedString(serverInputs?.crmOrcidLineage, 80),
    methodEvidence,
  };
}

async function resolveExactWork(reference, tracker, providers, signal) {
  const normalized = normalizeWorkReference(reference);
  if (!normalized) return { work: null, reason: 'missing_source_work' };

  const lookups = [
    normalized.pmid ? ['pmid', normalized.pmid] : null,
    normalized.doi ? ['doi', normalized.doi] : null,
    normalized.arxivId ? ['arxiv', normalized.arxivId] : null,
  ].filter(Boolean);

  for (const [kind, value] of lookups) {
    const response = await tracker.call('openalex', `work_by_${kind}`, () =>
      providers.getWorkByExternalId(kind, value, { signal }));
    if (!response.ok) return { work: null, reason: 'provider_failure' };
    const records = Array.isArray(response.value?.records) ? response.value.records : [];
    const totalCount = completeProviderCount(response.value?.totalCount, records);
    if (totalCount === null) return { work: null, reason: `${kind}_provider_contract_invalid` };
    if (totalCount > records.length) return { work: null, reason: `${kind}_pool_incomplete` };
    if (records.length === 1) return { work: records[0], reason: null };
    if (records.length > 1) return { work: null, reason: `${kind}_collision` };
  }

  if (!normalized.title) return { work: null, reason: 'missing_source_work_identifier' };
  const response = await tracker.call('openalex', 'work_by_title', () =>
    providers.getWorkByTitle(normalized.title, { signal, limit: 10 }));
  if (!response.ok) return { work: null, reason: 'provider_failure' };
  const records = Array.isArray(response.value?.records) ? response.value.records : [];
  const totalCount = completeProviderCount(response.value?.totalCount, records);
  if (totalCount === null) return { work: null, reason: 'title_provider_contract_invalid' };
  if (totalCount > records.length) return { work: null, reason: 'title_pool_incomplete' };
  const exact = records.filter((work) => normalizeTitle(work?.title) === normalized.title);
  if (exact.length === 1) return { work: exact[0], reason: null };
  return { work: null, reason: exact.length > 1 ? 'title_collision' : 'work_not_found' };
}

function classifyWorkAuthorship(candidateName, resolved) {
  if (!resolved.work) {
    const unevaluable = resolved.reason === 'provider_failure'
      || resolved.reason?.endsWith('_pool_incomplete')
      || resolved.reason?.endsWith('_provider_contract_invalid');
    return {
      result: unevaluable ? RESULTS.NOT_EVALUABLE : RESULTS.INSUFFICIENT,
      reason: resolved.reason,
      match: null,
    };
  }
  const matches = strictAuthorships(candidateName, resolved.work);
  if (matches.length === 1) {
    if (ambiguousSameSurnameAuthorships(candidateName, resolved.work).length > 0) {
      return { result: RESULTS.INSUFFICIENT, reason: 'ambiguous_author_match', match: null };
    }
    const cluster = authorCluster(matches[0].authorship);
    if (!cluster) return { result: RESULTS.INSUFFICIENT, reason: 'author_cluster_missing', match: null };
    return { result: RESULTS.SUFFICIENT, reason: 'exact_work_unique_author', match: { ...matches[0], cluster } };
  }
  if (matches.length > 1) {
    return { result: RESULTS.INSUFFICIENT, reason: 'ambiguous_author_match', match: null };
  }
  if (hasFullForenameContradiction(candidateName, resolved.work.authorships)) {
    return { result: RESULTS.CONTRADICTED, reason: 'full_forename_contradiction', match: null };
  }
  return { result: RESULTS.INSUFFICIENT, reason: 'no_full_forename_author_match', match: null };
}

function workEvidence(work, match) {
  return {
    workId: normalizedOpenAlexId(work?.openAlexId, 'W'),
    pmid: normalizedPmid(work?.pmid),
    doi: normalizedDoi(work?.doi),
    titleDigest: titleDigest(work?.title),
    authorshipIndex: match?.index ?? null,
    openAlexAuthorId: match?.cluster?.openAlexAuthorId || null,
    orcid: match?.cluster?.orcid || null,
  };
}

function workReferenceEvidence(work) {
  const reference = normalizeWorkReference(work);
  return {
    pmid: reference?.pmid || null,
    doi: reference?.doi || null,
    arxivId: reference?.arxivId || null,
    openAlexWorkId: reference?.openAlexWorkId || null,
    titleDigest: reference?.title ? digest(reference.title) : null,
  };
}

async function evaluateExactWork(serverInputs, context) {
  const resolved = await resolveExactWork(
    serverInputs.sourceWork,
    context.tracker,
    context.providers,
    context.signal,
  );
  const classified = classifyWorkAuthorship(serverInputs.candidateName, resolved);
  return {
    result: classified.result,
    reason: classified.reason,
    methodEvidence: resolved.work ? workEvidence(resolved.work, classified.match) : {},
  };
}

async function evaluateForenameWorkGrounding(serverInputs, context) {
  const authorPoolResponse = await context.tracker.call('openalex', 'author_search', () =>
    context.providers.searchAuthors(serverInputs.candidateName, {
      signal: context.signal,
      limit: MAX_AUTHOR_POOL,
    }));
  if (!authorPoolResponse.ok) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'provider_failure', methodEvidence: {} };
  }
  const records = Array.isArray(authorPoolResponse.value?.records)
    ? authorPoolResponse.value.records
    : [];
  const totalCount = completeProviderCount(authorPoolResponse.value?.totalCount, records);
  if (totalCount === null) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'author_provider_contract_invalid', methodEvidence: {} };
  }
  const poolEvidence = { authorPoolSize: records.length, authorTotalCount: totalCount };
  if (totalCount > records.length) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'author_pool_incomplete', methodEvidence: poolEvidence };
  }

  const fullNameRecords = records.filter((record) =>
    strictNameMatch(serverInputs.candidateName, record?.displayName));
  const resolved = await resolveExactWork(
    serverInputs.sourceWork,
    context.tracker,
    context.providers,
    context.signal,
  );
  const classified = classifyWorkAuthorship(serverInputs.candidateName, resolved);
  if (classified.result !== RESULTS.SUFFICIENT) {
    return { ...classified, methodEvidence: { ...poolEvidence } };
  }
  const groundedId = classified.match.cluster.openAlexAuthorId;
  const matchingRecords = fullNameRecords.filter((record) =>
    normalizedOpenAlexId(record?.openAlexId, 'A') === groundedId);
  if (!groundedId || matchingRecords.length !== 1) {
    return {
      result: RESULTS.INSUFFICIENT,
      reason: matchingRecords.length > 1 ? 'grounded_author_collision' : 'grounded_author_not_in_complete_pool',
      methodEvidence: { ...poolEvidence, work: workEvidence(resolved.work, classified.match) },
    };
  }
  return {
    result: RESULTS.SUFFICIENT,
    reason: 'forename_work_grounded',
    methodEvidence: { ...poolEvidence, work: workEvidence(resolved.work, classified.match) },
  };
}

function pubmedArticleReference(article = {}) {
  return normalizeWorkReference({
    pmid: article.pmid,
    doi: article.doi,
    title: article.title,
  });
}

async function evaluatePubmedMultiWork(serverInputs, context) {
  const pubmedResponse = await context.tracker.call('pubmed', 'author_search', () =>
    context.providers.searchPubmed(
      buildAuthorQuery(serverInputs.candidateName),
      MAX_PUBMED_RESULTS,
      { signal: context.signal, throwOnError: true },
    ));
  if (!pubmedResponse.ok) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'provider_failure', methodEvidence: {} };
  }
  const articles = Array.isArray(pubmedResponse.value) ? pubmedResponse.value : [];
  const strictArticles = articles.filter((article) =>
    (Array.isArray(article?.authors) ? article.authors : [])
      .some((author) => strictNameMatch(serverInputs.candidateName, author?.name)));

  const references = [];
  const seen = new Set();
  for (const value of strictArticles.map(pubmedArticleReference)) {
    const reference = normalizeWorkReference(value);
    const key = workKey(reference);
    if (!reference || !key || seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
    if (references.length >= MAX_CLUSTER_WORKS) break;
  }
  if (references.length < MIN_CLUSTER_WORKS) {
    return {
      result: RESULTS.INSUFFICIENT,
      reason: 'too_few_full_forename_works',
      methodEvidence: { fullForenameWorkCount: references.length },
    };
  }

  const grounded = [];
  let groundingFailure = null;
  for (const reference of references) {
    const resolved = await resolveExactWork(
      reference,
      context.tracker,
      context.providers,
      context.signal,
    );
    const classified = classifyWorkAuthorship(serverInputs.candidateName, resolved);
    if (resolved.work && classified.match) {
      grounded.push({
        source: reference,
        work: resolved.work,
        match: classified.match,
      });
      continue;
    }
    if (classified.result === RESULTS.NOT_EVALUABLE) {
      return {
        result: RESULTS.NOT_EVALUABLE,
        reason: classified.reason,
        methodEvidence: { fullForenameWorkCount: references.length },
      };
    }
    if (sameWork(reference, serverInputs.sourceWork)
      && classified.result === RESULTS.CONTRADICTED) {
      return {
        result: RESULTS.CONTRADICTED,
        reason: classified.reason,
        methodEvidence: { sourceWork: workReferenceEvidence(serverInputs.sourceWork) },
      };
    }
    groundingFailure = classified.reason || 'pubmed_work_not_grounded';
  }

  const sourceGrounding = grounded.find((item) => sameWork(item.source, serverInputs.sourceWork));
  if (!sourceGrounding) {
    return {
      result: RESULTS.INSUFFICIENT,
      reason: 'source_work_not_grounded',
      methodEvidence: { groundedWorkCount: grounded.length },
    };
  }
  if (groundingFailure) {
    return {
      result: RESULTS.INSUFFICIENT,
      reason: 'pubmed_work_not_grounded',
      methodEvidence: {
        fullForenameWorkCount: references.length,
        groundedWorkCount: grounded.length,
      },
    };
  }
  const sourceCluster = sourceGrounding.match.cluster;
  const clustered = grounded.filter((item) => {
    const cluster = item.match.cluster;
    if (sourceCluster.openAlexAuthorId && cluster.openAlexAuthorId) {
      return sourceCluster.openAlexAuthorId === cluster.openAlexAuthorId;
    }
    return Boolean(sourceCluster.orcid && cluster.orcid && sourceCluster.orcid === cluster.orcid);
  });
  const methodEvidence = {
    fullForenameWorkCount: references.length,
    groundedWorkCount: grounded.length,
    clusterWorkCount: clustered.length,
    authorCluster: sourceCluster,
    works: clustered.map((item) => workEvidence(item.work, item.match)),
  };
  if (clustered.length < MIN_CLUSTER_WORKS || clustered.length !== references.length) {
    return { result: RESULTS.INSUFFICIENT, reason: 'multi_work_cluster_insufficient', methodEvidence };
  }
  return { result: RESULTS.SUFFICIENT, reason: 'pubmed_multi_work_author_bound', methodEvidence };
}

function orcidReferenceMatchesWork(reference, sourceWork) {
  if (!reference || !sourceWork) return false;
  return sameWork(reference, sourceWork);
}

async function evaluateHardIdJoin(serverInputs, context) {
  const sourceOrcid = normalizeOrcid(serverInputs.sourceOrcid);
  const crmOrcid = normalizeOrcid(serverInputs.crmOrcid);
  const sourceLineage = boundedString(serverInputs.sourceOrcidLineage, 80);
  const crmLineage = boundedString(serverInputs.crmOrcidLineage, 80);
  const sourceLineageAccepted = sourceLineage === 'byline_asserted'
    || sourceLineage === 'orcid_works_exact_work';
  const crmLineageAccepted = crmLineage === 'staff_entered'
    || crmLineage === 'independent_receipt';
  if (!sourceOrcid || !crmOrcid || !sourceLineageAccepted || !crmLineageAccepted) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'hard_id_lineage_missing', methodEvidence: {} };
  }
  if (sourceLineage === 'byline_asserted') {
    if (sourceOrcid !== crmOrcid) {
      return {
        result: RESULTS.CONTRADICTED,
        reason: 'orcid_contradiction',
        methodEvidence: { sourceOrcid, crmOrcid, sourceLineage, crmLineage },
      };
    }
    return {
      result: RESULTS.SUFFICIENT,
      reason: 'hard_id_join',
      methodEvidence: { orcid: sourceOrcid, sourceLineage, crmLineage },
    };
  }
  if (!serverInputs.sourceWork) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'hard_id_source_lineage_missing', methodEvidence: {} };
  }

  const clientId = context.orcidCredentials?.clientId || process.env.ORCID_CLIENT_ID;
  const clientSecret = context.orcidCredentials?.clientSecret || process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    context.tracker.record('orcid', 'credentials', false);
    return { result: RESULTS.NOT_EVALUABLE, reason: 'orcid_credentials_unavailable', methodEvidence: {} };
  }
  const worksResponse = await context.tracker.call('orcid', 'work_references', () =>
    context.providers.getOrcidWorkReferences(sourceOrcid, clientId, clientSecret, {
      signal: context.signal,
      limit: 50,
    }));
  if (!worksResponse.ok) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'provider_failure', methodEvidence: {} };
  }
  const references = Array.isArray(worksResponse.value?.records) ? worksResponse.value.records : [];
  const totalCount = Number(worksResponse.value?.totalCount);
  const examinedCount = Number(worksResponse.value?.examinedCount);
  const completeWorkPool = Number.isSafeInteger(totalCount)
    && Number.isSafeInteger(examinedCount)
    && totalCount >= 0
    && examinedCount >= 0
    && examinedCount <= totalCount;
  if (!completeWorkPool) {
    return { result: RESULTS.NOT_EVALUABLE, reason: 'orcid_provider_contract_invalid', methodEvidence: {} };
  }
  if (totalCount > examinedCount) {
    return {
      result: RESULTS.NOT_EVALUABLE,
      reason: 'orcid_work_pool_incomplete',
      methodEvidence: { workTotalCount: totalCount, workPoolSize: examinedCount },
    };
  }
  const exactWorkFound = references.some((reference) =>
    orcidReferenceMatchesWork(reference, serverInputs.sourceWork));
  if (!exactWorkFound) {
    return {
      result: RESULTS.INSUFFICIENT,
      reason: 'orcid_exact_work_not_found',
      methodEvidence: { orcid: sourceOrcid, sourceLineage, crmLineage },
    };
  }
  return sourceOrcid === crmOrcid
    ? {
      result: RESULTS.SUFFICIENT,
      reason: 'hard_id_join',
      methodEvidence: {
        orcid: sourceOrcid,
        sourceLineage,
        crmLineage,
        sourceWork: workReferenceEvidence(serverInputs.sourceWork),
      },
    }
    : {
      result: RESULTS.CONTRADICTED,
      reason: 'orcid_contradiction',
      methodEvidence: {
        sourceOrcid,
        crmOrcid,
        sourceLineage,
        crmLineage,
        sourceWork: workReferenceEvidence(serverInputs.sourceWork),
      },
    };
}

async function evaluateIndependentReviewerIdentity(binding = {}, dependencies = {}) {
  const requestBinding = boundedString(binding.requestBinding, 160);
  const candidateKey = boundedString(binding.candidateKey, 200);
  const method = boundedString(binding.method, 80);
  let suppliedNow;
  try {
    suppliedNow = typeof dependencies.now === 'function' ? dependencies.now() : Date.now();
  } catch {
    suppliedNow = Date.now();
  }
  const suppliedNowMs = new Date(suppliedNow).getTime();
  const evaluatedAt = new Date(Number.isFinite(suppliedNowMs) ? suppliedNowMs : Date.now()).toISOString();
  const tracker = providerTracker();
  const invalidBinding = !requestBinding || !candidateKey || !METHOD_VALUES.has(method);
  if (invalidBinding || typeof dependencies.loadServerInputs !== 'function') {
    return resultEnvelope({
      requestBinding,
      candidateKey,
      method,
      result: RESULTS.NOT_EVALUABLE,
      reason: invalidBinding ? 'invalid_binding' : 'server_loader_required',
      providerState: 'failed',
      providerObservedAt: null,
      evaluatedAt,
      digestInput: { requestBinding, candidateKey, method },
    });
  }

  let serverInputs;
  try {
    serverInputs = await dependencies.loadServerInputs({
      requestBinding,
      candidateKey,
      signal: dependencies.signal,
    });
  } catch {
    return resultEnvelope({
      requestBinding,
      candidateKey,
      method,
      result: RESULTS.NOT_EVALUABLE,
      reason: 'server_input_unavailable',
      providerState: 'failed',
      providerObservedAt: null,
      evaluatedAt,
      digestInput: { requestBinding, candidateKey, method },
    });
  }

  const candidateName = boundedString(serverInputs?.candidateName, 240);
  const loadedBindingMatches = serverInputs?.requestBinding === requestBinding
    && serverInputs?.candidateKey === candidateKey;
  if (!loadedBindingMatches) {
    return resultEnvelope({
      requestBinding,
      candidateKey,
      method,
      result: RESULTS.NOT_EVALUABLE,
      reason: 'server_input_binding_mismatch',
      providerState: 'failed',
      providerObservedAt: null,
      evaluatedAt,
      digestInput: baseDigestInput(binding, method, serverInputs, {}),
    });
  }
  const serverAllowedMethods = Array.isArray(serverInputs.allowedMethods)
    ? serverInputs.allowedMethods.filter((value) => METHOD_VALUES.has(value))
    : [];
  if (!serverAllowedMethods.includes(method)) {
    return resultEnvelope({
      requestBinding,
      candidateKey,
      method,
      result: RESULTS.NOT_EVALUABLE,
      reason: 'method_not_server_authorized',
      providerState: 'failed',
      providerObservedAt: null,
      evaluatedAt,
      digestInput: baseDigestInput(binding, method, serverInputs, {}),
    });
  }
  if (!candidateName) {
    return resultEnvelope({
      requestBinding,
      candidateKey,
      method,
      result: RESULTS.NOT_EVALUABLE,
      reason: 'candidate_name_missing',
      providerState: 'complete',
      providerObservedAt: boundedString(serverInputs?.providerObservedAt, 80),
      evaluatedAt,
      digestInput: baseDigestInput(binding, method, serverInputs, {}),
    });
  }
  if (serverInputs.staffIdentityConfirmed === true) {
    return resultEnvelope({
      requestBinding,
      candidateKey,
      method,
      result: RESULTS.NOT_EVALUABLE,
      reason: 'staff_confirmation_not_independent',
      providerState: 'complete',
      providerObservedAt: boundedString(serverInputs?.providerObservedAt, 80),
      evaluatedAt,
      digestInput: baseDigestInput(binding, method, serverInputs, {}),
    });
  }

  const providers = {
    searchPubmed: (...args) => PubMedService.search(...args),
    searchAuthors: (...args) => OpenAlexService.searchAuthors(...args),
    getWorkByExternalId: (...args) => OpenAlexService.getWorkByExternalId(...args),
    getWorkByTitle: (...args) => OpenAlexService.getWorkByTitle(...args),
    getOrcidWorkReferences: (...args) => ORCIDService.getWorkReferences(...args),
    ...(dependencies.providers || {}),
  };
  const context = {
    tracker,
    providers,
    signal: dependencies.signal,
    orcidCredentials: dependencies.orcidCredentials,
  };
  let evaluation;
  if (method === METHODS.PUBMED_MULTI_WORK_AUTHOR) {
    evaluation = await evaluatePubmedMultiWork(serverInputs, context);
  } else if (method === METHODS.EXACT_WORK_UNIQUE_AUTHOR) {
    evaluation = await evaluateExactWork(serverInputs, context);
  } else if (method === METHODS.FORENAME_WORK_GROUNDING) {
    evaluation = await evaluateForenameWorkGrounding(serverInputs, context);
  } else {
    evaluation = await evaluateHardIdJoin(serverInputs, context);
  }

  const providerAttempts = tracker.summary();
  const providerState = providerAttempts.length > 0
    ? tracker.state()
    : (serverInputs.providerState === 'complete'
      ? 'complete'
      : (serverInputs.providerState === 'partial' ? 'partial' : 'failed'));
  const providerObservedAt = providerAttempts.length > 0
    ? evaluatedAt
    : boundedString(serverInputs.providerObservedAt, 80);
  return resultEnvelope({
    requestBinding,
    candidateKey,
    method,
    result: evaluation.result,
    reason: evaluation.reason,
    providerState,
    providerObservedAt,
    evaluatedAt,
    digestInput: baseDigestInput(binding, method, serverInputs, evaluation.methodEvidence),
    evidence: evaluation.methodEvidence,
  });
}

module.exports = {
  MAX_TTL_MS,
  METHODS,
  RESOLVER_VERSION,
  RESULTS,
  VERSION,
  evaluateIndependentReviewerIdentity,
  normalizeWorkReference,
  sameWork,
  strictNameMatch,
};
