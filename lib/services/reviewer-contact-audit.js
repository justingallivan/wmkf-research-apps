/**
 * Reviewer Contact Audit — Slice 1 (measurement / audit)
 *
 * Pure, side-effect-free classifier for "why does this candidate lack a usable
 * (sendable) email after enrichment?" It reads ONLY the post-enrichment
 * `contactEnrichment` object that ContactEnrichmentService.enrichCandidate
 * produced — it never re-derives identity, never searches, never assumes a
 * dominant bucket. This is the spec's "measure first" requirement: the bucket a
 * candidate lands in reflects the actual funnel state, not an a-priori guess.
 *
 * Design refs:
 *   docs/REVIEWER_CONTACT_LEADS_SPEC.md §6 Slice 1
 *   docs/REVIEWER_CONTACT_LEADS_REVIEW.md (build order, namesake_ambiguous)
 *
 * IMPORTANT measurement nuance (spec §6 / review): the paid-search anchor is
 * institution-OR-ORCID, NOT confirmed identity, and the institution comes from
 * `_effectiveInstitution` (orcidAffiliation / affiliation / institution /
 * primaryAffiliation) — NOT `suggestedInstitution`. So a Claude suggestion that
 * carries only `suggestedInstitution` is still in the no-anchor abstain bucket.
 * This classifier reads the resulting `contactStatusReason` directly, so it
 * measures that distinction instead of assuming it.
 *
 * The spec wants ONE primary bucket per candidate, but the raw signals are not
 * mutually exclusive (a candidate can be both `identity_unresolved` and have a
 * page). To stay non-lossy, classifyContactOutcome returns BOTH:
 *   - `bucket`  — the precedence winner (the spec histogram)
 *   - `signals` — every detected condition (so the summary can report a raw
 *                 signal-frequency tally independent of the precedence choice)
 *
 * Precedence (first match wins) and its rationale:
 *   1. verified_contact_present  — a sendable email exists; nothing else matters.
 *   2. withheld_by_gate          — a found email was DROPPED by a safety gate
 *                                  (verified-domain contradiction). Recoverable
 *                                  only by relaxing the gate; report it as such.
 *   3. lead_found_not_persisted  — a tier FOUND a contact but discarded it
 *                                  (anchor contradiction / name mismatch). This
 *                                  is the Slice-2a "surface the discard" target.
 *   4. namesake_ambiguous        — same-name disambiguation failed (resolver or
 *                                  ORCID ambiguous). The Smirnova/Le class.
 *   5. search_skipped_no_anchor  — no institution AND no ORCID, so the paid
 *                                  search never ran. The headline funnel reason.
 *   6. provider_error            — a tier errored (outage); surface it, don't
 *                                  let a partial page mask an operational fault.
 *   7. has_page_no_email         — no email but a faculty/profile page exists.
 *                                  The Slice-2a faculty-page-as-lead target.
 *   8. identity_unresolved       — searched, but the resolver could not confirm
 *                                  identity (verdict < probable), no page.
 *   9. searched_no_result        — a paid tier ran and returned nothing usable
 *                                  (default catch-all for "had a chance, empty").
 */

const PRIMARY_BUCKETS = [
  'verified_contact_present',
  'withheld_by_gate',
  'lead_found_not_persisted',
  'namesake_ambiguous',
  'search_skipped_no_anchor',
  'provider_error',
  'has_page_no_email',
  'identity_unresolved',
  'searched_no_result',
];

const PAID_TIERS = ['claude_search', 'serp_search'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Detect every condition present on a contactEnrichment object. Returns a Set of
 * signal keys (a superset of the bucket names plus a couple of finer signals).
 * Kept separate from bucket selection so the summary can report raw frequencies
 * that don't depend on the precedence ordering.
 */
function detectSignals(ce = {}) {
  const signals = new Set();
  const tierResults = ce.tierResults || {};
  const tiersUsed = Array.isArray(ce.tiersUsed) ? ce.tiersUsed : [];

  if (isNonEmptyString(ce.email)) signals.add('has_email');

  // A found email dropped by the verified-domain cross-check (a real contact
  // withheld by a safety gate, distinct from "never found").
  if (ce.contactStatusReason === 'verified_domain_contradiction') signals.add('withheld_by_gate');

  // Discards a tier captured-but-rejected (Slice 2a recovery targets). The
  // anchor-contradiction class is preserved in tierResults with a rejectedReason;
  // name-mismatch discards (both Claude and Serp) set emailRejectedReason on the
  // stored tier result before the email is nulled, so they survive here.
  if (tierResults.claude_search?.rejectedReason === 'identity_anchor_contradiction') signals.add('lead_found_not_persisted');
  if (tierResults.serp_search?.rejectedReason === 'identity_anchor_contradiction') signals.add('lead_found_not_persisted');
  if (tierResults.claude_search?.emailRejectedReason === 'name_mismatch') signals.add('lead_found_not_persisted');
  if (tierResults.serp_search?.emailRejectedReason === 'name_mismatch') signals.add('lead_found_not_persisted');

  // Same-name disambiguation failure: resolver verdict or ORCID tier ambiguous.
  if (ce.identity?.status === 'ambiguous') signals.add('namesake_ambiguous');
  if (tierResults.orcid?.status === 'ambiguous') signals.add('namesake_ambiguous');

  // No anchor → the unanchored abstain (_markUnanchoredAbstain) cleared contact
  // and skipped the paid tiers.
  if (ce.contactStatusReason === 'identity_anchor_required') signals.add('search_skipped_no_anchor');

  // A tier errored. tierResults.*.error is set by the catch in each tier;
  // openalex_author records an outage under skipped:'openalex_error'.
  const errored = Object.values(tierResults).some(
    (r) => r && (isNonEmptyString(r.error) || r.skipped === 'openalex_error'),
  );
  if (errored) signals.add('provider_error');

  // A page breadcrumb with no email (faculty-page-as-lead target).
  if (!isNonEmptyString(ce.email) && (isNonEmptyString(ce.facultyPageUrl) || isNonEmptyString(ce.website))) {
    signals.add('has_page_no_email');
  }

  // Resolver could not confirm identity (verdict < probable).
  if (ce.identity?.status === 'unresolved') signals.add('identity_unresolved');

  // A paid search tier actually ran.
  if (tiersUsed.some((t) => PAID_TIERS.includes(t))) signals.add('searched');

  return signals;
}

/**
 * Classify a single candidate's contact outcome.
 * @param {Object} ce - the candidate's `contactEnrichment` object
 * @returns {{ bucket: string, signals: string[], detail: string|null }}
 */
function classifyContactOutcome(ce = {}) {
  const signals = detectSignals(ce);
  const tierResults = ce.tierResults || {};

  let bucket;
  let detail = null;

  if (signals.has('has_email')) {
    bucket = 'verified_contact_present';
    detail = ce.emailSource || null;
  } else if (signals.has('withheld_by_gate')) {
    bucket = 'withheld_by_gate';
    detail = 'verified_domain_contradiction';
  } else if (signals.has('lead_found_not_persisted')) {
    bucket = 'lead_found_not_persisted';
    detail = rejectedLeadDetail(tierResults);
  } else if (signals.has('namesake_ambiguous')) {
    bucket = 'namesake_ambiguous';
    detail = ce.identity?.status === 'ambiguous' ? 'resolver_ambiguous' : 'orcid_ambiguous';
  } else if (signals.has('search_skipped_no_anchor')) {
    bucket = 'search_skipped_no_anchor';
    detail = 'identity_anchor_required';
  } else if (signals.has('provider_error')) {
    bucket = 'provider_error';
    detail = providerErrorDetail(tierResults);
  } else if (signals.has('has_page_no_email')) {
    bucket = 'has_page_no_email';
    detail = isNonEmptyString(ce.facultyPageUrl) ? 'faculty_page' : 'website';
  } else if (signals.has('identity_unresolved')) {
    bucket = 'identity_unresolved';
    detail = 'resolver_unresolved';
  } else {
    bucket = 'searched_no_result';
    detail = signals.has('searched') ? 'paid_search_empty' : 'no_paid_search';
  }

  return { bucket, signals: [...signals], detail };
}

/** Source(s) of a discarded-but-recoverable lead, for the per-candidate log. */
function rejectedLeadDetail(tierResults) {
  const parts = [];
  if (tierResults.claude_search?.rejectedReason === 'identity_anchor_contradiction') parts.push('claude:anchor_contradiction');
  if (tierResults.claude_search?.emailRejectedReason === 'name_mismatch') parts.push('claude:name_mismatch');
  if (tierResults.serp_search?.rejectedReason === 'identity_anchor_contradiction') parts.push('serp:anchor_contradiction');
  if (tierResults.serp_search?.emailRejectedReason === 'name_mismatch') parts.push('serp:name_mismatch');
  return parts.join(',') || null;
}

/** First erroring tier + message, for the per-candidate log. */
function providerErrorDetail(tierResults) {
  for (const [tier, r] of Object.entries(tierResults)) {
    if (!r) continue;
    if (isNonEmptyString(r.error)) return `${tier}:${r.error}`;
    if (r.skipped === 'openalex_error') return `${tier}:openalex_error`;
  }
  return null;
}

/**
 * Aggregate contact outcomes across an enriched batch.
 *
 * @param {Array} enriched - enrichCandidates' `results.enriched` list
 * @param {Object} [meta]  - run metadata to carry through (e.g. paidSearchEnabled)
 * @returns {Object} audit summary:
 *   {
 *     total,
 *     buckets,   // primary-bucket histogram (every bucket present, 0-filled)
 *     signals,   // non-lossy signal-frequency tally
 *     rejected,  // [{ name, source, reason }] — the rejected candidate/source/
 *                //   reason the spec wants visible in structured output
 *     ...meta
 *   }
 */
function summarizeContactOutcomes(enriched, meta = {}) {
  const list = Array.isArray(enriched) ? enriched : [];
  const buckets = Object.fromEntries(PRIMARY_BUCKETS.map((b) => [b, 0]));
  const signals = {};
  const rejected = [];

  for (const item of list) {
    const ce = item?.contactEnrichment || {};
    const { bucket, signals: itemSignals, detail } = classifyContactOutcome(ce);
    buckets[bucket] = (buckets[bucket] || 0) + 1;
    for (const s of itemSignals) signals[s] = (signals[s] || 0) + 1;

    // The spec acceptance: "for search-sourced results rejected by gates, the
    // rejected candidate/source/reason is visible in structured output."
    if (bucket === 'lead_found_not_persisted' || bucket === 'withheld_by_gate') {
      rejected.push({ name: item?.name || ce.name || null, source: bucket, reason: detail });
    }
  }

  return {
    total: list.length,
    buckets,
    signals,
    rejected,
    ...meta,
  };
}

module.exports = {
  classifyContactOutcome,
  summarizeContactOutcomes,
  PRIMARY_BUCKETS,
};
