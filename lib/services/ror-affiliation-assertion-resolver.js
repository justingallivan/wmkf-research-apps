'use strict';

/**
 * Shadow-only provenance-preserving ROR resolver for AffiliationAssertion.
 *
 * Unlike the production identity wrapper, this keeps one result per explicit
 * organization segment and preserves both the source-matched and canonical ROR
 * ids. A failed segment remains unresolved without discarding successful peers.
 */

const { assertCandidateInput } = require('./ror-institution-candidate-contract');
const { decideSingle } = require('./ror-institution-decision');
const { parseOrganizationSpans } = require('./ror-institution-evidence');

const RESOLVER_VERSION = 'ror-affiliation-assertion-resolver/v1';

function selectedSourceId(decision) {
  const survivors = (decision?.evaluations || [])
    .filter((evaluation) => (evaluation.vetoes || []).length === 0)
    .sort((left, right) => right.score - left.score || left.ror_id.localeCompare(right.ror_id));
  return survivors[0]?.ror_id || decision?.selected_ror_ids?.[0] || null;
}

function canonicalizationFor(sourceRorId, canonicalRorId, candidateSet) {
  if (!sourceRorId || !canonicalRorId || sourceRorId === canonicalRorId) return null;
  const source = candidateSet.candidates.find((candidate) => candidate.ror_id === sourceRorId);
  const typed = (source?.relationships || []).find((relationship) => (
    relationship.ror_id === canonicalRorId
      && (relationship.type === 'successor' || relationship.type === 'predecessor')
  ));
  return {
    type: typed?.type || 'resolver_canonicalization',
    fromRorId: sourceRorId,
    toRorId: canonicalRorId,
  };
}

function resolvedSegment(rawText, decision, candidateSet) {
  if (decision.outcome !== 'resolved' || decision.selected_ror_ids.length !== 1) {
    return {
      rawText,
      role: 'primary_or_unknown',
      resolution: {
        status: 'unresolved',
        reason: decision.reasons[0] || decision.outcome,
        provider: candidateSet.provider,
        confidence: 'unresolved',
      },
      decision,
    };
  }
  const canonicalRorId = decision.selected_ror_ids[0];
  const sourceRorId = selectedSourceId(decision);
  const source = candidateSet.candidates.find((candidate) => candidate.ror_id === sourceRorId);
  const canonical = candidateSet.candidates.find((candidate) => candidate.ror_id === canonicalRorId);
  const relationships = [...new Map([
    ...(source?.relationships || []),
    ...(canonical?.relationships || []),
  ].map((relationship) => [
    `${relationship.type}:${relationship.ror_id}`,
    { type: relationship.type, rorId: relationship.ror_id },
  ])).values()];
  return {
    rawText,
    role: 'primary_or_unknown',
    resolution: {
      status: 'resolved',
      reason: decision.reasons[0],
      provider: candidateSet.provider,
      sourceRorId,
      canonicalRorId,
      canonicalization: canonicalizationFor(sourceRorId, canonicalRorId, candidateSet),
      relationships,
      confidence: 'resolver_threshold_passed',
      provenance: {
        resolverVersion: RESOLVER_VERSION,
        decision: decision.provenance,
        candidateSet: candidateSet.provenance,
      },
    },
    decision,
  };
}

function segmentTexts(assertion) {
  if (Array.isArray(assertion?.segments) && assertion.segments.length > 0) {
    const values = assertion.segments.map((segment) => String(segment?.rawText || '').trim());
    if (values.some((value) => !value)) throw new Error('explicit affiliation segments require rawText');
    return { spans: values, issue: null };
  }
  return parseOrganizationSpans(String(assertion?.rawText || ''));
}

function createRorAffiliationAssertionResolver({ candidateAdapter } = {}) {
  if (!candidateAdapter?.institutionCandidates) {
    throw new Error('candidateAdapter must export institutionCandidates(input)');
  }

  async function resolve(assertion = {}, { signal } = {}) {
    const parsed = segmentTexts(assertion);
    if (parsed.issue || !parsed.spans.length) {
      return {
        ...assertion,
        segments: [{
          rawText: String(assertion.rawText || '').trim(),
          role: 'primary_or_unknown',
          resolution: {
            status: 'unresolved',
            reason: parsed.issue || 'empty_affiliation',
            provider: null,
            confidence: 'unresolved',
          },
        }],
        resolutionSummary: {
          resolverVersion: RESOLVER_VERSION,
          resolvedSegments: 0,
          unresolvedSegments: 1,
        },
      };
    }

    const resolutionScope = typeof candidateAdapter.beginResolution === 'function'
      ? candidateAdapter.beginResolution({ signal })
      : null;
    const segments = [];
    for (const rawText of parsed.spans) {
      const input = { affiliation_string: rawText, signal };
      assertCandidateInput(input);
      try {
        const candidateSet = await candidateAdapter.institutionCandidates(
          input,
          resolutionScope ? { resolutionScope } : undefined,
        );
        const decision = decideSingle(input, candidateSet);
        segments.push(resolvedSegment(rawText, decision, candidateSet));
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        segments.push({
          rawText,
          role: 'primary_or_unknown',
          resolution: {
            status: 'unresolved',
            reason: 'provider_failure',
            operationalDetail: String(error?.message || 'provider failure').slice(0, 200),
            provider: 'ror-api-v2-union',
            confidence: 'unresolved',
          },
        });
      }
    }
    const resolvedSegments = segments.filter((segment) => segment.resolution.status === 'resolved').length;
    return {
      ...assertion,
      segments,
      resolutionSummary: {
        resolverVersion: RESOLVER_VERSION,
        resolvedSegments,
        unresolvedSegments: segments.length - resolvedSegments,
      },
    };
  }

  return Object.freeze({ resolve });
}

module.exports = {
  RESOLVER_VERSION,
  createRorAffiliationAssertionResolver,
  resolvedSegment,
  selectedSourceId,
};
