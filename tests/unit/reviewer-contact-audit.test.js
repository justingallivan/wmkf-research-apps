/**
 * @jest-environment node
 *
 * Slice 1 contact-leads audit (REVIEWER_CONTACT_LEADS_SPEC §6): the pure
 * classifier that maps a post-enrichment contactEnrichment object to a
 * missing-email reason bucket, plus the batch summarizer. These lock the
 * precedence ordering and the non-lossy signal tally so the measurement
 * stays honest (no a-priori dominant-bucket assumption).
 */

const {
  classifyContactOutcome,
  summarizeContactOutcomes,
  PRIMARY_BUCKETS,
} = require('../../lib/services/reviewer-contact-audit');

const bucketOf = (ce) => classifyContactOutcome(ce).bucket;

describe('classifyContactOutcome — per-bucket', () => {
  test('verified_contact_present when a sendable email exists', () => {
    expect(bucketOf({ email: 'a@mit.edu', emailSource: 'orcid' })).toBe('verified_contact_present');
  });

  test('withheld_by_gate when a found email was dropped on domain contradiction', () => {
    const out = classifyContactOutcome({ email: null, contactStatusReason: 'verified_domain_contradiction' });
    expect(out.bucket).toBe('withheld_by_gate');
    expect(out.detail).toBe('verified_domain_contradiction');
  });

  test('lead_found_not_persisted for an anchor-contradiction Claude discard', () => {
    const out = classifyContactOutcome({
      email: null,
      tierResults: { claude_search: { email: 'x@other.edu', rejectedReason: 'identity_anchor_contradiction' } },
    });
    expect(out.bucket).toBe('lead_found_not_persisted');
    expect(out.detail).toContain('claude:anchor_contradiction');
  });

  test('lead_found_not_persisted for a Serp anchor-contradiction discard', () => {
    const out = classifyContactOutcome({
      email: null,
      tierResults: { serp_search: { rejectedReason: 'identity_anchor_contradiction' } },
    });
    expect(out.bucket).toBe('lead_found_not_persisted');
    expect(out.detail).toContain('serp:anchor_contradiction');
  });

  test('lead_found_not_persisted for a Claude name-mismatch discard', () => {
    const out = classifyContactOutcome({
      email: null,
      tierResults: { claude_search: { emailRejectedReason: 'name_mismatch' } },
    });
    expect(out.bucket).toBe('lead_found_not_persisted');
    expect(out.detail).toContain('claude:name_mismatch');
  });

  test('lead_found_not_persisted for a Serp name-mismatch discard', () => {
    const out = classifyContactOutcome({
      email: null,
      tierResults: { serp_search: { emailRejectedReason: 'name_mismatch' } },
    });
    expect(out.bucket).toBe('lead_found_not_persisted');
    expect(out.detail).toContain('serp:name_mismatch');
  });

  test('namesake_ambiguous from the resolver verdict', () => {
    const out = classifyContactOutcome({ email: null, identity: { status: 'ambiguous' } });
    expect(out.bucket).toBe('namesake_ambiguous');
    expect(out.detail).toBe('resolver_ambiguous');
  });

  test('namesake_ambiguous from an ambiguous ORCID tier', () => {
    const out = classifyContactOutcome({ email: null, tierResults: { orcid: { status: 'ambiguous' } } });
    expect(out.bucket).toBe('namesake_ambiguous');
    expect(out.detail).toBe('orcid_ambiguous');
  });

  test('search_skipped_no_anchor for the unanchored abstain', () => {
    expect(bucketOf({ email: null, contactStatus: 'unresolved', contactStatusReason: 'identity_anchor_required' }))
      .toBe('search_skipped_no_anchor');
  });

  test('provider_error when a tier records an error', () => {
    const out = classifyContactOutcome({ email: null, tierResults: { serp_search: { error: 'rate limited' } } });
    expect(out.bucket).toBe('provider_error');
    expect(out.detail).toBe('serp_search:rate limited');
  });

  test('provider_error for an OpenAlex outage skip', () => {
    expect(bucketOf({ email: null, tierResults: { openalex_author: { skipped: 'openalex_error' } } }))
      .toBe('provider_error');
  });

  test('has_page_no_email when a faculty page exists but no email', () => {
    const out = classifyContactOutcome({ email: null, facultyPageUrl: 'https://x.edu/~p', tiersUsed: ['serp_search'] });
    expect(out.bucket).toBe('has_page_no_email');
    expect(out.detail).toBe('faculty_page');
  });

  test('has_page_no_email also covers a website-only breadcrumb', () => {
    const out = classifyContactOutcome({ email: null, website: 'https://lab.x.edu' });
    expect(out.bucket).toBe('has_page_no_email');
    expect(out.detail).toBe('website');
  });

  test('identity_unresolved when the resolver could not confirm and no page exists', () => {
    expect(bucketOf({ email: null, identity: { status: 'unresolved' }, tiersUsed: ['claude_search'] }))
      .toBe('identity_unresolved');
  });

  test('searched_no_result when a paid tier ran and found nothing', () => {
    const out = classifyContactOutcome({ email: null, tiersUsed: ['pubmed', 'serp_search'] });
    expect(out.bucket).toBe('searched_no_result');
    expect(out.detail).toBe('paid_search_empty');
  });

  test('searched_no_result default (no paid search ran) is distinguished by detail', () => {
    const out = classifyContactOutcome({ email: null, tiersUsed: ['pubmed'] });
    expect(out.bucket).toBe('searched_no_result');
    expect(out.detail).toBe('no_paid_search');
  });
});

describe('classifyContactOutcome — precedence', () => {
  test('email present wins over every suppression signal', () => {
    expect(bucketOf({
      email: 'a@mit.edu',
      identity: { status: 'unresolved' },
      facultyPageUrl: 'https://x.edu',
      tierResults: { serp_search: { rejectedReason: 'identity_anchor_contradiction' } },
    })).toBe('verified_contact_present');
  });

  test('a discarded lead outranks has_page_no_email', () => {
    expect(bucketOf({
      email: null,
      facultyPageUrl: 'https://x.edu/~p',
      tierResults: { claude_search: { emailRejectedReason: 'name_mismatch' } },
    })).toBe('lead_found_not_persisted');
  });

  test('has_page_no_email outranks identity_unresolved when both hold', () => {
    expect(bucketOf({
      email: null,
      facultyPageUrl: 'https://x.edu/~p',
      identity: { status: 'unresolved' },
    })).toBe('has_page_no_email');
  });

  test('signals array is non-lossy even when one bucket wins', () => {
    const out = classifyContactOutcome({
      email: null,
      facultyPageUrl: 'https://x.edu/~p',
      identity: { status: 'unresolved' },
    });
    expect(out.signals).toEqual(expect.arrayContaining(['has_page_no_email', 'identity_unresolved']));
  });
});

describe('summarizeContactOutcomes', () => {
  const enriched = [
    { name: 'A', contactEnrichment: { email: 'a@mit.edu', emailSource: 'orcid' } },
    { name: 'B', contactEnrichment: { email: null, contactStatusReason: 'identity_anchor_required' } },
    { name: 'C', contactEnrichment: { email: null, facultyPageUrl: 'https://x.edu/~c' } },
    { name: 'D', contactEnrichment: { email: null, tierResults: { serp_search: { rejectedReason: 'identity_anchor_contradiction' } } } },
    { name: 'E', contactEnrichment: { email: null, contactStatusReason: 'verified_domain_contradiction' } },
  ];

  test('histogram is 0-filled for every primary bucket', () => {
    const s = summarizeContactOutcomes(enriched);
    expect(Object.keys(s.buckets).sort()).toEqual([...PRIMARY_BUCKETS].sort());
    expect(s.total).toBe(5);
    expect(s.buckets.verified_contact_present).toBe(1);
    expect(s.buckets.search_skipped_no_anchor).toBe(1);
    expect(s.buckets.has_page_no_email).toBe(1);
    expect(s.buckets.lead_found_not_persisted).toBe(1);
    expect(s.buckets.withheld_by_gate).toBe(1);
    expect(s.buckets.searched_no_result).toBe(0);
  });

  test('rejected list surfaces candidate/source/reason for discards + gate-withholds', () => {
    const s = summarizeContactOutcomes(enriched);
    expect(s.rejected).toEqual(
      expect.arrayContaining([
        { name: 'D', source: 'lead_found_not_persisted', reason: 'serp:anchor_contradiction' },
        { name: 'E', source: 'withheld_by_gate', reason: 'verified_domain_contradiction' },
      ]),
    );
    expect(s.rejected).toHaveLength(2);
  });

  test('carries run metadata through', () => {
    const s = summarizeContactOutcomes(enriched, { paidSearchEnabled: true });
    expect(s.paidSearchEnabled).toBe(true);
  });

  test('handles an empty / non-array input safely', () => {
    expect(summarizeContactOutcomes(undefined).total).toBe(0);
    expect(summarizeContactOutcomes([]).total).toBe(0);
  });
});
