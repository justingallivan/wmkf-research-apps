/**
 * Re-discovery reconciliation: match freshly-surfaced Find candidates against
 * the request's saved candidate pool by identity anchors, so a person who has
 * already entered the engagement lifecycle (invited/declined/…) collapses into
 * the "Already handled" section instead of rendering as a fully invitable card
 * (S401, Kwong confusion 2026-08-04).
 *
 * Why merge-time matching exists at all: the search exclusion union
 * (`effectiveExcluded` → discovery's exact normalized-name hard filter) already
 * drops exact name matches, so anything that reaches this matcher slipped past
 * on a name variant. Anchors (person GUID, ORCID, Scholar id, OpenAlex id)
 * catch variants the name filter cannot; the normalized-name key is the
 * fallback for anchor-less fresh rows.
 *
 * This is correlation for DISPLAY COLLAPSE, not identity resolution — a
 * name-key match can collapse a genuine namesake. That trade is deliberate:
 * the collapsed entry stays visible with its stage and a navigation action,
 * and a true namesake can still be added via the manual-add card.
 */
import { reviewerEngagementProjection } from './reviewer-engagement';
import { normalizeReviewerName } from '../../lib/utils/reviewer-name-match';

// Stages that mean "this person has already entered the engagement lifecycle
// beyond merely being saved". A merely-'selected' saved row deliberately does
// NOT collapse its re-discovered twin: it is not yet engaged, and the search
// exclusion union already handles the common exact-name case.
const ENGAGED_STAGES = new Set([
  'invited',
  'responded',
  'accepted',
  'declined',
  'review_received',
  'completed',
]);

export const REDISCOVERED_STAGE_LABELS = {
  invited: 'already invited (pending)',
  responded: 'already responded',
  accepted: 'already accepted',
  declined: 'already declined',
  review_received: 'review received',
  completed: 'review completed',
};

function normalizeOrcid(value) {
  const match = String(value || '').toUpperCase().match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/);
  return match ? match[0] : '';
}

const ANCHOR_TYPES = ['person', 'orcid', 'scholar', 'openalex'];

function reviewerIdentityAnchors(row = {}) {
  const enr = row.contactEnrichment && typeof row.contactEnrichment === 'object'
    ? row.contactEnrichment
    : {};
  const person = row.potentialReviewerId || row.seedResolvedPotentialReviewerId;
  const scholar = row.googleScholarId || enr.googleScholarId;
  const openalex = row.openAlexId || row.openAlexAuthorId;
  return {
    person: person ? String(person).trim().toLowerCase() : '',
    orcid: normalizeOrcid(row.orcid || enr.orcidId || enr.orcid || row.orcidUrl),
    scholar: scholar ? String(scholar).trim().toLowerCase() : '',
    openalex: openalex ? String(openalex).trim().toLowerCase() : '',
  };
}

/**
 * Every identity key a row can be correlated on — unlike reviewerCandidateKey
 * (first anchor wins, for stable per-row identity), this returns ALL of them so
 * a saved row (anchored by suggestion/person) can meet its fresh twin (anchored
 * by orcid/scholar or nothing but a name).
 */
export function reviewerIdentityMatchKeys(row = {}) {
  const anchors = reviewerIdentityAnchors(row);
  const keys = [];
  for (const type of ANCHOR_TYPES) {
    if (anchors[type]) keys.push(`${type}:${anchors[type]}`);
  }
  const name = normalizeReviewerName(row.name);
  if (name) keys.push(`name:${name}`);
  return keys;
}

/**
 * Index the saved pool's ENGAGED rows (see ENGAGED_STAGES) by every identity
 * key. Values are the compact facts the collapsed entry renders.
 */
export function buildEngagedSavedIndex(savedPool = []) {
  const index = new Map();
  for (const row of Array.isArray(savedPool) ? savedPool : []) {
    if (!row || typeof row !== 'object') continue;
    const { stage } = reviewerEngagementProjection(row);
    if (!ENGAGED_STAGES.has(stage)) continue;
    const entry = {
      name: row.name || null,
      affiliation: row.affiliation || null,
      suggestionId: row.suggestionId || null,
      stage,
      anchors: reviewerIdentityAnchors(row),
    };
    for (const key of reviewerIdentityMatchKeys(row)) {
      if (!index.has(key)) index.set(key, entry);
    }
  }
  return index;
}

/**
 * Split a merged display list into { kept, rediscovered }. A candidate whose
 * identity keys intersect the engaged-saved index leaves the actionable list;
 * the rediscovered entry carries both the fresh candidate (for its display key)
 * and the saved row's engagement facts.
 */
export function partitionRediscoveredCandidates(candidates = [], index) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!(index instanceof Map) || index.size === 0) return { kept: list, rediscovered: [] };
  const kept = [];
  const rediscovered = [];
  for (const candidate of list) {
    const candidateAnchors = reviewerIdentityAnchors(candidate);
    let saved = null;
    for (const key of reviewerIdentityMatchKeys(candidate)) {
      const matched = index.get(key);
      if (!matched) continue;
      if (!key.startsWith('name:')) {
        saved = matched;
        break;
      }
      // A shared anchor type with different values is positive evidence that
      // same-name rows are different people. Missing/non-overlapping anchors
      // retain the deliberate ambiguous-namesake display-collapse trade.
      const conflicts = ANCHOR_TYPES.some((type) => (
        candidateAnchors[type]
        && matched.anchors?.[type]
        && candidateAnchors[type] !== matched.anchors[type]
      ));
      if (!conflicts) saved = matched;
    }
    if (saved) rediscovered.push({ candidate, saved });
    else kept.push(candidate);
  }
  return { kept, rediscovered };
}
