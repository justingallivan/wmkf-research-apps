/**
 * One-candidate, contact-only producer.
 *
 * It intentionally composes only contact tiers and pure contact projection.
 * In particular it never enters the composite enrichment finalizer, which is
 * where identity resolution, institution-domain discovery, bibliometrics,
 * eligibility evidence, and persistence live.
 */

import { createHash } from 'crypto';
import * as contactTiers from '../../contact-enrichment/tiers.js';
import * as contactAnchor from '../../contact-enrichment/identity-anchor.js';
import * as emailAdjudication from '../../contact-enrichment/email-adjudication.js';
import { claudeWebSearch } from '../../contact-enrichment/search-tiers.js';
import { projectReviewerContact } from '../../../utils/reviewer-vetted-email.js';
import { isGuid } from '../../../utils/guid.js';
import { abortError } from '../../contact-enrichment/abort.js';
import { isIdentityAuthoritySatisfied } from './identity.js';

const CONTRACT_VERSION = 1;
const MAX_SOURCE_VERSION_LENGTH = 160;
const MAX_DOMAINS = 4;
const MAX_EMAIL_LENGTH = 254;
const MAX_URL_LENGTH = 2000;
const MAX_LEADS = 12;
const MAX_TIER_NAMES = 8;

const CONTACT_TIER_API = Object.freeze({
  applyTier0: contactTiers.applyTier0,
  applyTier1: contactTiers.applyTier1,
  applyTier2: contactTiers.applyTier2,
  applyScholarlyTier: contactTiers.applyScholarlyTier,
  applyTier3: contactTiers.applyTier3,
  applyTier4: contactTiers.applyTier4,
  claudeWebSearch,
});

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

function cleanString(value, max = 1000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizedEmail(value) {
  const email = cleanString(value, MAX_EMAIL_LENGTH)?.toLowerCase() || null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizedDomain(value) {
  const text = cleanString(value, 253);
  if (!text) return null;
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function boundedDomains(value) {
  const out = [];
  const seen = new Set();
  for (const entry of (Array.isArray(value) ? value : [])) {
    const domain = normalizedDomain(entry);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}

function trustedIdentityStatus(candidate) {
  const persisted = candidate?.identityEvidence && typeof candidate.identityEvidence === 'object'
    ? candidate.identityEvidence
    : {};
  // A current identity receipt is the authority. Retain legacy status fields
  // only while older roster projections are still being refreshed.
  const decision = persisted.decision
    || persisted.status
    || candidate?.identityDecision
    || candidate?.contactEnrichment?.identity?.status
    || candidate?.identityStatus
    || null;
  const identityEvidence = {
    decision,
    status: decision,
    staffConfirmation: persisted.staffConfirmation || candidate?.staffIdentityConfirmation || null,
  };
  if (!isIdentityAuthoritySatisfied({ candidate, identityEvidence })) return null;
  return String(decision).toLowerCase() === 'probable' ? 'probable' : 'confirmed';
}

function initialEnrichment(candidate, identityStatus, domains) {
  const previous = candidate?.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  return {
    email: null,
    emailSource: null,
    emailEvidence: null,
    emailAction: 'missing',
    emailActionReason: 'No email address found',
    emailYear: null,
    emailIsRecent: false,
    website: null,
    websiteSource: null,
    facultyPageUrl: null,
    affiliation: cleanString(candidate?.affiliation) || null,
    affiliationSource: cleanString(candidate?.affiliation) ? 'server_candidate' : null,
    orcidId: cleanString(candidate?.orcidId || candidate?.orcid, 64),
    orcidUrl: null,
    orcidAffiliation: null,
    openAlexAffiliation: null,
    verifiedInstitutionDomain: domains[0] || null,
    anchoredInstitutionDomains: domains,
    plausibleInstitutionDomains: domains,
    identity: { status: identityStatus },
    contactStatus: null,
    contactStatusReason: null,
    emailPersistAllowed: false,
    websitePersistAllowed: false,
    affiliationPersistAllowed: !!cleanString(candidate?.affiliation),
    tiersUsed: [],
    tierResults: {},
    contactLeads: [],
    // Keep only inputs that are useful to the contact tiers. Stale results and
    // source claims are deliberately not copied into the fresh projection.
    previousContactSource: cleanString(previous.emailSource, 64),
  };
}

function boundedEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    sourceKind: cleanString(value.sourceKind, 80),
    sourceUrl: cleanString(value.sourceUrl, MAX_URL_LENGTH),
    sourceTitle: cleanString(value.sourceTitle, 300),
    citedText: cleanString(value.citedText, 800),
    observedAt: cleanString(value.observedAt, 40),
    ownership: cleanString(value.ownership, 80),
    publicationCount: Number.isInteger(value.publicationCount) && value.publicationCount >= 0
      ? Math.min(value.publicationCount, 1000)
      : null,
  };
}

function boundedLeads(value) {
  const allowedTypes = new Set(['email', 'website', 'faculty_page', 'profile']);
  const allowedConfidence = new Set(['high', 'medium', 'low', 'rejected']);
  const out = [];
  for (const lead of (Array.isArray(value) ? value : [])) {
    if (!allowedTypes.has(lead?.type)) continue;
    const valueText = cleanString(lead.value, MAX_URL_LENGTH);
    if (!valueText) continue;
    out.push({
      type: lead.type,
      value: valueText,
      sourceUrl: cleanString(lead.sourceUrl, MAX_URL_LENGTH),
      source: cleanString(lead.source, 80),
      confidence: allowedConfidence.has(lead.confidence) ? lead.confidence : 'low',
      persistable: false,
      rejectedReason: cleanString(lead.rejectedReason, 120),
    });
    if (out.length >= MAX_LEADS) break;
  }
  return out;
}

function tierSummary(enrichment) {
  return {
    tiersUsed: (Array.isArray(enrichment?.tiersUsed) ? enrichment.tiersUsed : [])
      .filter((tier) => typeof tier === 'string' && tier.length <= 80)
      .slice(0, MAX_TIER_NAMES),
    providerError: Object.values(enrichment?.tierResults || {}).some((value) => (
      value && typeof value === 'object' && (value.error || value.status === 'provider_error')
    )),
  };
}

function canonicalServerPerson(value) {
  if (!value || typeof value !== 'object' || value.authority !== 'server_loaded') return null;
  const canonicalPersonId = cleanString(value.canonicalPersonId, 80);
  const canonicalPersonEtag = cleanString(value.canonicalPersonEtag || value.personEtag, 240);
  if (!canonicalPersonId || !isGuid(canonicalPersonId) || !canonicalPersonEtag) return null;
  return {
    canonicalPersonId: canonicalPersonId.toLowerCase(),
    canonicalPersonEtag,
    personEtag: canonicalPersonEtag,
  };
}

function contactPatch(result, projection, canonicalPerson = null) {
  const ce = result.contactEnrichment;
  const email = normalizedEmail(projection?.email);
  return {
    email,
    emailSource: cleanString(projection?.emailSource, 80),
    emailPersistAllowed: projection?.emailPersistAllowed === true,
    emailEvidence: boundedEvidence(ce.emailEvidence),
    emailAction: projection?.decision || 'missing_email',
    emailActionReason: cleanString(projection?.reason, 240),
    website: cleanString(projection?.website, MAX_URL_LENGTH),
    websiteSource: cleanString(ce.websiteSource, 80),
    websitePersistAllowed: projection?.websitePersistAllowed === true,
    facultyPageUrl: cleanString(ce.facultyPageUrl, MAX_URL_LENGTH),
    affiliation: cleanString(projection?.affiliation, 1000),
    affiliationSource: cleanString(ce.affiliationSource, 80),
    affiliationPersistAllowed: projection?.affiliationPersistAllowed === true,
    contactStatus: cleanString(ce.contactStatus, 80),
    contactStatusReason: cleanString(ce.contactStatusReason, 160),
    contactLeads: boundedLeads(ce.contactLeads),
    contactTierSummary: tierSummary(ce),
    ...(canonicalServerPerson(canonicalPerson) || {}),
  };
}

/**
 * Project completed cold contact work without reopening any contact tier. The
 * `candidate` is the server-computed enrichment/reconciliation result merged
 * with the already-projected identity/domain receipts by the cold coordinator.
 */
export function projectColdReviewerContactEvidence({
  candidate = {},
  canonicalPerson = null,
  sourceVersion,
  expectedSourceVersion = null,
  complete = true,
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const identityStatus = trustedIdentityStatus(candidate);
  if (!identityStatus) {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'identity_not_authoritative',
      now,
    });
  }
  const enrichment = candidate?.contactEnrichment;
  if (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment)) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'partial_coverage', now });
  }
  const projection = projectReviewerContact({
    ...candidate,
    email: candidate.email || enrichment.email,
    emailSource: candidate.emailSource || enrichment.emailSource,
  });
  const patch = contactPatch({ ...candidate, contactEnrichment: enrichment }, projection, canonicalPerson);
  if (complete !== true || patch.contactTierSummary.providerError) {
    return stageEnvelope({
      outcome: 'incomplete',
      sourceVersion: authoritativeSource,
      evidencePatch: patch,
      failureCode: 'partial_coverage',
      now,
    });
  }
  if (enrichment.emailSource === 'search_contested' || projection?.decision === 'needs_identity_confirmation') {
    return stageEnvelope({
      outcome: 'incomplete',
      sourceVersion: authoritativeSource,
      evidencePatch: patch,
      failureCode: 'missing_required_input',
      now,
    });
  }
  if (projection?.decision === 'ready' || projection?.decision === 'missing_email') {
    return stageEnvelope({ outcome: 'current', sourceVersion: authoritativeSource, evidencePatch: patch, now });
  }
  return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, evidencePatch: patch, failureCode: 'partial_coverage', now });
}

/**
 * Executes only server-policy-enabled contact tiers for one already-identified
 * candidate. `tierApi` exists for provider spying and does not widen the
 * client contract: the server controls both it and `policy`.
 */
export async function produceReviewerContactEvidence({
  candidate,
  canonicalPerson = null,
  institutionDomains,
  sourceVersion,
  expectedSourceVersion = null,
  credentials = {},
  policy = {},
  signal,
  deadlineAt,
  tierApi = CONTACT_TIER_API,
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const identityStatus = trustedIdentityStatus(candidate);
  if (!identityStatus) {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'identity_not_authoritative',
      now,
    });
  }
  const domains = boundedDomains(institutionDomains);
  if (!cleanString(candidate?.name, 240)) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }

  throwIfAborted(signal, deadlineAt);
  const enrichment = initialEnrichment(candidate, identityStatus, domains);
  const result = { ...candidate, contactEnrichment: enrichment };
  const progress = () => {};
  const usePubmed = policy?.usePubmed === true;
  const useOrcid = policy?.useOrcid === true;
  const useClaudeSearch = policy?.useClaudeSearch === true;
  const useSerpSearch = policy?.useSerpSearch === true;
  // The legacy Tier 4 helper fans out through non-abortable fallback requests.
  // Do not reach it from the one-candidate manual stage: a configured request
  // is a bounded incomplete result until a signal-aware single-candidate Serp
  // seam exists. Cold emission can still project evidence it already has.
  if (useSerpSearch) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  const identityAnchor = contactAnchor.identityAnchorForCandidate(candidate);
  const effectiveInstitution = contactAnchor.effectiveInstitution(candidate, enrichment);
  const searchCandidate = contactAnchor.searchCandidateWithInstitution(candidate, effectiveInstitution);
  const effectiveAnchor = contactAnchor.anchorWithInstitution(identityAnchor, effectiveInstitution);
  const hasIdentityAnchor = !!effectiveInstitution || contactAnchor.hasOrcidAnchor(candidate, enrichment);

  try {
    if (tierApi.applyTier0(candidate, result, { onProgress: progress }) !== 'finalize') {
      tierApi.applyTier1(candidate, result, { usePubmed, onProgress: progress });
      throwIfAborted(signal, deadlineAt);
      await tierApi.applyTier2(candidate, result, {
        useOrcid,
        credentials,
        identityAnchor,
        signal,
        onProgress: progress,
      });
      throwIfAborted(signal, deadlineAt);
      await tierApi.applyScholarlyTier(searchCandidate, result, {
        usePubmed,
        hasIdentityAnchor,
        signal,
        onProgress: progress,
      });
      const emailAlreadyFound = !!(enrichment.email && enrichment.emailIsRecent);
      await tierApi.applyTier3(candidate, result, {
        emailAlreadyFound,
        hasIdentityAnchor,
        effectiveAnchor,
        searchCandidate,
        useClaudeSearch,
        credentials,
        onProgress: progress,
        signal,
        deadlineAt,
        service: { claudeWebSearch: tierApi.claudeWebSearch },
      });
      throwIfAborted(signal, deadlineAt);
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'reviewer_time_budget_exceeded') throw error;
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
  }
  throwIfAborted(signal, deadlineAt);

  emailAdjudication.validateEmailAgainstVerifiedDomain(enrichment);
  emailAdjudication.readjudicateNameMismatchRejectedEmail(enrichment);
  emailAdjudication.collectContactLeads(enrichment);
  const projection = projectReviewerContact({
    ...result,
    email: enrichment.email,
    emailSource: enrichment.emailSource,
  });
  const patch = contactPatch(result, projection, canonicalPerson);
  if (patch.contactTierSummary.providerError) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, evidencePatch: patch, failureCode: 'provider_unavailable', now });
  }
  if (enrichment.emailSource === 'search_contested' || projection?.decision === 'needs_identity_confirmation') {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, evidencePatch: patch, failureCode: 'missing_required_input', now });
  }
  if (projection?.decision === 'missing_email') {
    return stageEnvelope({ outcome: 'current', sourceVersion: authoritativeSource, evidencePatch: patch, now });
  }
  if (projection?.decision === 'ready') {
    return stageEnvelope({ outcome: 'current', sourceVersion: authoritativeSource, evidencePatch: patch, now });
  }
  return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'provider_unavailable', now });
}

export const CONTACT_EVIDENCE_PATCH_KEYS = Object.freeze([
  'email', 'emailSource', 'emailPersistAllowed', 'emailEvidence', 'emailAction',
  'emailActionReason', 'website', 'websiteSource', 'websitePersistAllowed',
  'facultyPageUrl', 'affiliation', 'affiliationSource', 'affiliationPersistAllowed',
  'contactStatus', 'contactStatusReason', 'contactLeads', 'contactTierSummary',
  'canonicalPersonId', 'canonicalPersonEtag', 'personEtag',
]);
