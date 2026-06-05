/**
 * @jest-environment node
 *
 * Reviewer search time-budget abort propagation through the enrichment path
 * (S223, post-impl Codex findings #1/#2). A fired deadline must STOP enrichment
 * and propagate — not be downgraded to a per-tier "search error" and not let the
 * batch keep scheduling candidates after the budget expired.
 */
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const { ContactParser } = require('../../lib/utils/contact-parser');

afterEach(() => jest.restoreAllMocks());

describe('enrichCandidates — deadline abort', () => {
  test('(#2) already-aborted signal → throws before enriching any candidate', async () => {
    const enrichSpy = jest.spyOn(ContactEnrichmentService, 'enrichCandidate').mockResolvedValue({});
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' }));

    await expect(
      ContactEnrichmentService.enrichCandidates(
        [{ name: 'Dr. A' }, { name: 'Dr. B' }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/reviewer_time_budget_exceeded/);

    // The loop-top guard fires on i=0, so no candidate is enriched.
    expect(enrichSpy).not.toHaveBeenCalled();
  });

  test('(#2) abort between candidates → stops the batch, does NOT return normal results', async () => {
    const controller = new AbortController();
    // First candidate succeeds, then the deadline fires before the second.
    const enrichSpy = jest
      .spyOn(ContactEnrichmentService, 'enrichCandidate')
      .mockImplementationOnce(async () => {
        controller.abort(Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' }));
        return { name: 'Dr. A', contactEnrichment: { tiersUsed: [] } };
      })
      .mockResolvedValue({ name: 'Dr. B', contactEnrichment: { tiersUsed: [] } });

    await expect(
      ContactEnrichmentService.enrichCandidates(
        [{ name: 'Dr. A' }, { name: 'Dr. B' }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/reviewer_time_budget_exceeded/);

    // Only the first candidate was enriched; the loop threw before the second.
    expect(enrichSpy).toHaveBeenCalledTimes(1);
  });
});

describe('enrichCandidate — Tier-3 abort is NOT swallowed', () => {
  test('(#1) claudeWebSearch abort rethrows instead of becoming a tier error', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null); // no Tier-0 email
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' }));
    // Simulate the LLM call aborting under the deadline.
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockRejectedValue(
      Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' }),
    );

    await expect(
      ContactEnrichmentService.enrichCandidate(
        { name: 'Dr. C', affiliation: 'MIT' },
        {
          credentials: { claudeApiKey: 'sk-ant-test' },
          usePubmed: false,
          useOrcid: false,
          useClaudeSearch: true,
          useSerpSearch: false,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow(/reviewer_time_budget_exceeded/);
  });

  test('a NON-abort Tier-3 error is still swallowed (per-tier error, search continues)', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null);
    // No signal → a genuine search failure must NOT abort the candidate.
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockRejectedValue(new Error('network blip'));

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. D', affiliation: 'MIT' },
      {
        credentials: { claudeApiKey: 'sk-ant-test' },
        usePubmed: false,
        useOrcid: false,
        useClaudeSearch: true,
        useSerpSearch: false,
      },
    );
    // Swallowed as a tier error; the candidate is returned (no email found).
    expect(out.contactEnrichment.tierResults.claude_search).toEqual({ error: 'network blip' });
    expect(out.contactEnrichment.email).toBeNull();
  });
});
