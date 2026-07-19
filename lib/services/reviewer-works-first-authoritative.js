/**
 * Adapter from the combined W2 policy into the established
 * ReviewerIdentityEvidence result contract.
 *
 * This module is intentionally separate from the runtime mode switch. It lets
 * the authoritative result policy be tested while the legacy/shadow seam and
 * its logger are owned by a parallel agent. Only a works-first rescue creates a
 * new result; retained/consensus legacy binds preserve the legacy object.
 */

const { buildIdentityNote, forenamesContradict } = require('./reviewer-identity-evidence');
const { resolveIdentity } = require('./reviewer-identity-resolver');
const {
  normalizeOrcid,
  shortOpenAlexAuthorId,
} = require('./reviewer-works-first');

const WORKS_FIRST_RESOLVER_VERSION = '2.0.0-works-first';

function canonicalAnchor({
  type,
  canonicalKey,
  sourceUrl,
  weight = 'weak',
  parserOutput = {},
  now,
}) {
  return {
    type,
    canonicalKey,
    value: canonicalKey.split(':').slice(1).join(':') || null,
    weight,
    sourceUrl: sourceUrl || null,
    parserOutput,
    verifier: `reviewerWorksFirst@${WORKS_FIRST_RESOLVER_VERSION}`,
    verdict: 'pass',
    retrievedAt: now,
    fetchResult: 'ok',
  };
}

function anchorsFromEvidenceBundle(bundle = {}, now) {
  const orcids = Array.from(new Set((bundle.orcids || []).map(normalizeOrcid).filter(Boolean)));
  const authorIds = Array.from(new Set(
    (bundle.openAlexAuthorIds || []).map(shortOpenAlexAuthorId).filter(Boolean),
  ));
  const dois = Array.from(new Set(
    (bundle.anchorDois || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean),
  )).slice(0, 5);
  const rors = Array.from(new Set(
    (bundle.rors || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean),
  ));

  const anchors = [];
  for (const orcid of orcids) {
    anchors.push(canonicalAnchor({
      type: 'works_first_orcid',
      canonicalKey: `orcid:${orcid}`,
      sourceUrl: `https://orcid.org/${orcid}`,
      now,
    }));
  }
  authorIds.forEach((authorId, index) => {
    anchors.push(canonicalAnchor({
      type: index === 0 ? 'authorship_grounded' : 'works_first_openalex_fragment',
      canonicalKey: `openalex:${authorId}`,
      sourceUrl: `https://openalex.org/${authorId}`,
      weight: index === 0 ? 'strong' : 'weak',
      parserOutput: { anchorDois: dois },
      now,
    }));
  });
  for (const doi of dois) {
    anchors.push(canonicalAnchor({
      type: 'works_first_anchor_doi',
      canonicalKey: `doi:${doi}`,
      sourceUrl: `https://doi.org/${doi}`,
      now,
    }));
  }
  for (const ror of rors) {
    anchors.push(canonicalAnchor({
      type: 'works_first_institution_ror',
      canonicalKey: `ror:${ror.replace(/^https?:\/\/ror\.org\//i, '')}`,
      sourceUrl: ror,
      now,
    }));
  }
  return anchors;
}

function extractEvidenceBundle(rawAnchors) {
  let anchors = rawAnchors;
  if (typeof rawAnchors === 'string') {
    try {
      anchors = JSON.parse(rawAnchors);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(anchors)) return null;
  const bundle = {
    orcids: [],
    anchorDois: [],
    rors: [],
    openAlexAuthorIds: [],
  };
  for (const anchor of anchors) {
    const key = typeof anchor?.canonicalKey === 'string' ? anchor.canonicalKey : '';
    if (key.startsWith('orcid:')) bundle.orcids.push(normalizeOrcid(key.slice(6)));
    else if (key.startsWith('openalex:')) bundle.openAlexAuthorIds.push(shortOpenAlexAuthorId(key.slice(9)));
    else if (key.startsWith('doi:')) bundle.anchorDois.push(key.slice(4).trim().toLowerCase() || null);
    else if (key.startsWith('ror:')) bundle.rors.push(`https://ror.org/${key.slice(4).trim().toLowerCase()}`);
  }
  for (const key of Object.keys(bundle)) {
    bundle[key] = Array.from(new Set(bundle[key].filter(Boolean))).sort();
  }
  return bundle;
}

function nonBindingResult(combinedResult, now) {
  const resolverStatus = combinedResult?.decision === 'review' ? 'ambiguous' : 'unresolved';
  const reason = combinedResult?.reason || 'combined_resolver_abstained';
  const identity = {
    status: resolverStatus,
    confidenceBand: null,
    anchors: [],
    rejectedAnchors: [],
    competitors: [],
    evidenceSummary: `${resolverStatus} — ${reason}`,
    resolverVersion: WORKS_FIRST_RESOLVER_VERSION,
    resolvedAt: now,
  };
  return {
    status: 'abstain',
    resolverStatus,
    orcid: null,
    selectedRecord: null,
    orcidAffiliations: [],
    anchors: [],
    sources: { openalex: 'ok', orcid: 'not_run' },
    reason,
    identityNote: buildIdentityNote(resolverStatus, [], null, null),
    identity,
  };
}

async function adaptCombinedIdentityResult({
  suggestion = {},
  legacyResult = {},
  worksResult = {},
  combinedResult = {},
} = {}, {
  getAuthorByOrcid,
  now = new Date().toISOString(),
} = {}) {
  if (combinedResult?.decision !== 'bind') {
    return nonBindingResult(combinedResult, now);
  }
  if (combinedResult.reason !== 'works_rescue') return legacyResult;
  if (typeof getAuthorByOrcid !== 'function') {
    return nonBindingResult({ decision: 'review', reason: 'works_rescue_profile_lookup_unavailable' }, now);
  }

  const selectedOrcid = String(combinedResult.anchor || '').startsWith('orcid:')
    ? normalizeOrcid(String(combinedResult.anchor).slice('orcid:'.length))
    : null;
  const bundle = worksResult?.evidenceBundle || {};
  const bundleOrcids = Array.from(new Set(
    (bundle.orcids || []).map(normalizeOrcid).filter(Boolean),
  ));
  if (!selectedOrcid || bundleOrcids.length !== 1 || bundleOrcids[0] !== selectedOrcid) {
    return nonBindingResult({ decision: 'review', reason: 'works_rescue_bundle_orcid_mismatch' }, now);
  }

  let selectedRecord;
  try {
    selectedRecord = await getAuthorByOrcid(selectedOrcid);
  } catch {
    return nonBindingResult({ decision: 'review', reason: 'works_rescue_profile_fetch_failed' }, now);
  }
  if (!selectedRecord
    || normalizeOrcid(selectedRecord.orcid) !== selectedOrcid
    || forenamesContradict(suggestion.name, selectedRecord.displayName)) {
    return nonBindingResult({ decision: 'review', reason: 'works_rescue_profile_contradiction' }, now);
  }

  const anchors = anchorsFromEvidenceBundle(bundle, now);
  if (!anchors.some((anchor) => anchor.type === 'authorship_grounded')) {
    return nonBindingResult({ decision: 'review', reason: 'works_rescue_missing_author_anchor' }, now);
  }
  const identity = resolveIdentity({
    name: suggestion.name,
    claimedInstitution: suggestion.suggestedInstitution || null,
  }, {
    identityAnchors: anchors,
    spine: {
      forenameContradicts: false,
    },
  }, { now });
  if (identity.status !== 'probable') {
    return nonBindingResult({ decision: 'review', reason: 'works_rescue_not_probable' }, now);
  }

  return {
    status: 'probable',
    resolverStatus: 'probable',
    orcid: selectedOrcid,
    selectedRecord,
    orcidAffiliations: [],
    anchors,
    sources: { openalex: 'ok', orcid: 'not_run' },
    reason: identity.evidenceSummary,
    identityNote: buildIdentityNote('probable', anchors, selectedRecord, selectedOrcid),
    identity: {
      ...identity,
      resolverVersion: WORKS_FIRST_RESOLVER_VERSION,
    },
  };
}

module.exports = {
  WORKS_FIRST_RESOLVER_VERSION,
  adaptCombinedIdentityResult,
  anchorsFromEvidenceBundle,
  extractEvidenceBundle,
};
