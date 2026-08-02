/**
 * One-candidate reviewer-eligibility stage producer.
 *
 * The caller supplies the already-authoritative institution domains. This
 * module never derives them from a bare name, never touches contact
 * enrichment/persistence, and turns a provider outage into a non-current
 * outcome rather than a clean `unknown` result.
 */

const { createHash } = require('crypto');
const { ContactParser } = require('../../../utils/contact-parser');
const { safeFetchInstitutionPage } = require('../../../utils/safe-fetch');
const { SerpContactService } = require('../../serp-contact-service');
const { abortError } = require('../../contact-enrichment/abort');
const {
  buildEligibilityQuery,
  classifyEligibilitySearchLeads,
  classifyEligibilityPage,
  parsedName,
} = require('../../contact-enrichment/eligibility-evidence');

const CONTRACT_VERSION = 1;
const MAX_SOURCE_VERSION_LENGTH = 160;
const MAX_DOMAINS = 4;
const MAX_DOMAIN_LENGTH = 253;
const MAX_REASON_LENGTH = 500;
const MAX_URL_LENGTH = 2000;
const MAX_TITLE_LENGTH = 300;
const MAX_SENTENCE_LENGTH = 800;

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
  return {
    outcome,
    evidencePatch,
    receipt: {
      state: outcome,
      contractVersion: CONTRACT_VERSION,
      sourceVersion: boundedSourceVersion,
      resultVersion: resultVersion({ outcome, evidencePatch, reasonCode, failureCode }),
      completedAt: outcome === 'current' || outcome === 'not_applicable' ? canonicalNow(now) : null,
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

function normalizedDomain(value) {
  if (typeof value !== 'string' || value.length > MAX_DOMAIN_LENGTH) return null;
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname
      .replace(/^www\./i, '')
      .toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
      ? host
      : null;
  } catch {
    return null;
  }
}

function normalizeTrustedDomains(value) {
  const out = [];
  const seen = new Set();
  for (const domain of (Array.isArray(value) ? value : [])) {
    const normalized = normalizedDomain(domain);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}

function firstPartyResult(item, domains) {
  const host = normalizedDomain(item?.link);
  return !!host && domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function boundedString(value, length) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, length) : null;
}

function boundedEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  const url = boundedString(value.url, MAX_URL_LENGTH);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    status: ['deceased', 'emeritus'].includes(value.status) ? value.status : 'unknown',
    url,
    title: boundedString(value.title, MAX_TITLE_LENGTH),
    snippet: boundedString(value.snippet, MAX_SENTENCE_LENGTH),
    sourceDomain: normalizedDomain(value.sourceDomain || url),
    checkedAt: typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt))
      ? new Date(value.checkedAt).toISOString()
      : null,
  };
}

function evidencePatch({ status, reason = null, evidence = null, checkStatus = 'complete' } = {}) {
  return {
    eligibilityStatus: ['deceased', 'emeritus', 'unknown'].includes(status) ? status : 'unknown',
    eligibilityCheckStatus: checkStatus,
    eligibilityReason: boundedString(reason, MAX_REASON_LENGTH),
    eligibilityEvidence: boundedEvidence(evidence),
  };
}

/**
 * Pure cold adapter for an eligibility conclusion that contact enrichment
 * already obtained. It deliberately does not repeat the Serp/page work merely
 * to stamp a receipt. The caller must pass the server-returned enrichment row,
 * never a browser candidate DTO.
 */
function projectColdEligibilityEvidence({
  candidate = {},
  sourceVersion,
  expectedSourceVersion = null,
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const enrichment = candidate?.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  const checkStatus = candidate?.eligibilityCheckStatus || enrichment.eligibilityCheckStatus;
  const status = candidate?.eligibilityStatus || enrichment.eligibilityStatus;
  const reason = candidate?.eligibilityReason || enrichment.eligibilityReason;
  const evidence = candidate?.eligibilityEvidence || enrichment.eligibilityEvidence;
  if (checkStatus === 'not_applicable') {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'no_trusted_domains',
      evidencePatch: evidencePatch({ status: 'unknown', reason, evidence, checkStatus }),
      now,
    });
  }
  if (checkStatus !== 'complete') {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }
  if (!['deceased', 'emeritus', 'unknown'].includes(status)) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }
  return stageEnvelope({
    outcome: 'current',
    sourceVersion: authoritativeSource,
    evidencePatch: evidencePatch({ status, reason, evidence, checkStatus }),
    now,
  });
}

/**
 * Run the bounded first-party eligibility evidence path for one candidate.
 * Callers must pass the server-owned `trustedDomains` receipt output.
 */
async function produceEligibilityEvidence({
  candidate,
  trustedDomains,
  sourceVersion,
  expectedSourceVersion = null,
  credentials = {},
  signal,
  deadlineAt,
  searchOrganicResults = (...args) => SerpContactService.searchOrganicResults(...args),
  fetchInstitutionPage = (...args) => safeFetchInstitutionPage(...args),
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
  if (!parsedName(name)) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const domains = normalizeTrustedDomains(trustedDomains);
  if (!domains.length) {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'no_trusted_domains',
      evidencePatch: evidencePatch({ status: 'unknown', checkStatus: 'not_applicable' }),
      now,
    });
  }
  const serpApiKey = typeof credentials?.serpApiKey === 'string' ? credentials.serpApiKey.trim() : '';
  if (!serpApiKey) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }

  throwIfAborted(signal, deadlineAt);
  let results;
  try {
    results = await searchOrganicResults(buildEligibilityQuery(name, domains), serpApiKey, { signal, limit: 10 });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'reviewer_time_budget_exceeded') throw error;
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }
  throwIfAborted(signal, deadlineAt);
  if (!Array.isArray(results)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }

  const leads = results
    .filter((item) => firstPartyResult(item, domains))
    .filter((item) => classifyEligibilitySearchLeads(name, [item], domains, canonicalNow(now)).status !== 'unknown')
    .slice(0, 10);
  if (!leads.length) {
    return stageEnvelope({
      outcome: 'current',
      sourceVersion: authoritativeSource,
      evidencePatch: evidencePatch({ status: 'unknown' }),
      now,
    });
  }

  let readablePageCount = 0;
  for (const lead of leads) {
    throwIfAborted(signal, deadlineAt);
    const allowedDomain = domains.find((domain) => firstPartyResult(lead, [domain]));
    if (!allowedDomain) continue;
    const remainingMs = Number.isFinite(deadlineAt) ? Math.max(1, deadlineAt - Date.now()) : 8000;
    try {
      const response = await fetchInstitutionPage(lead.link, {
        allowedDomain,
        signal,
        timeoutMs: Math.min(8000, remainingMs),
      });
      throwIfAborted(signal, deadlineAt);
      if (!response?.ok || !response.text) continue;
      readablePageCount += 1;
      const page = ContactParser.extractEmailsFromHtml(response.text);
      const classification = classifyEligibilityPage(
        name,
        page,
        response.finalUrl || lead.link,
        canonicalNow(now),
      );
      if (classification.status !== 'unknown') {
        return stageEnvelope({
          outcome: 'current',
          sourceVersion: authoritativeSource,
          evidencePatch: evidencePatch(classification),
          now,
        });
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'reviewer_time_budget_exceeded') throw error;
      // Keep trying independent first-party leads. If none can be read, the
      // complement below records a non-current source failure rather than an
      // unsupported clean `unknown`.
    }
  }
  if (readablePageCount === 0) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }
  return stageEnvelope({
    outcome: 'current',
    sourceVersion: authoritativeSource,
    evidencePatch: evidencePatch({ status: 'unknown' }),
    now,
  });
}

module.exports = {
  ELIGIBILITY_EVIDENCE_PATCH_KEYS: Object.freeze([
    'eligibilityStatus', 'eligibilityCheckStatus', 'eligibilityReason', 'eligibilityEvidence',
  ]),
  produceEligibilityEvidence,
  projectColdEligibilityEvidence,
};
