/**
 * @jest-environment node
 *
 * Characterization suite for claudeWebSearch (Tier 3) + buildGoogleScholarUrl
 * (Stage 6 / search-tiers cluster of the ContactEnrichmentService
 * decomposition, docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md,
 * Checkpoint A2).
 *
 * Neither method had DIRECT body coverage before this suite: every existing
 * reference to claudeWebSearch in tests/unit/contact-enrichment-*.test.js
 * spies on `ContactEnrichmentService.claudeWebSearch` itself (replacing the
 * implementation), and the only buildGoogleScholarUrl-adjacent coverage
 * (scholar-url.test.js) exercises the separate lib/utils/scholar-url.js
 * helper, not this method. This suite baselines the ACTUAL bodies —
 * including the 3 dynamic-import code paths (ai-payload-boundary,
 * llm-client, ai-output-schema) — against the pre-extraction facade so the
 * Stage 6 move to lib/services/contact-enrichment/search-tiers.js is a
 * verified behavior-freeze.
 *
 * Only the network boundary (LLMClient) and the model-name lookup
 * (getModelForApp) are mocked; wrapUntrustedContent / buildUntrustedContentPreamble
 * / validateAiJson run for REAL so the dynamic-import paths are genuinely
 * exercised end-to-end.
 */

jest.mock('../../shared/config/baseConfig', () => ({
  getModelForApp: jest.fn(() => 'claude-test-model'),
}));

const completeMock = jest.fn();
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((opts) => ({
    __opts: opts,
    complete: completeMock,
  })),
}));

const { ContactEnrichmentService: S } = require('../../lib/services/contact-enrichment-service');
const { LLMClient } = require('../../lib/services/llm-client');

afterEach(() => {
  jest.clearAllMocks();
});

describe('ContactEnrichmentService.buildGoogleScholarUrl (characterization)', () => {
  it('returns null for a falsy name', () => {
    expect(S.buildGoogleScholarUrl(null, 'MIT')).toBeNull();
    expect(S.buildGoogleScholarUrl('', 'MIT')).toBeNull();
  });

  it('strips a leading Dr./Prof. honorific, and falls back to the first affiliation part when none matches the institution regex', () => {
    const url = S.buildGoogleScholarUrl('Dr. Jane Smith', 'Dept of Biology, MIT');
    expect(url).toBe(
      'https://scholar.google.com/citations?view_op=search_authors&mauthors=' +
        encodeURIComponent('Jane Smith Dept of Biology'),
    );
  });

  it('prefers a university/institute/college part over a department part', () => {
    const url = S.buildGoogleScholarUrl('Prof. John Doe', 'Department of Chemistry, University of Colorado Boulder');
    expect(url).toContain(encodeURIComponent('John Doe University of Colorado Boulder'));
  });

  it('falls back to the first affiliation segment when nothing matches the institution regex', () => {
    const url = S.buildGoogleScholarUrl('Alice Zhao', 'Room 204, Building 3');
    expect(url).toBe(
      'https://scholar.google.com/citations?view_op=search_authors&mauthors=' +
        encodeURIComponent('Alice Zhao Room 204'),
    );
  });

  it('uses only the clean name when affiliation is absent (regex here only strips Dr./Prof./Professor, not every ContactParser honorific)', () => {
    const url = S.buildGoogleScholarUrl('Sir Michael Bay', null);
    expect(url).toBe(
      'https://scholar.google.com/citations?view_op=search_authors&mauthors=' +
        encodeURIComponent('Sir Michael Bay'),
    );
  });
});

describe('ContactEnrichmentService.claudeWebSearch (characterization)', () => {
  const candidate = { name: 'Dr. Jane Gallivan', affiliation: 'Dept of Biology, MIT' };

  it('constructs LLMClient with the resolved model + appName, and no timeoutMs override without a deadline', async () => {
    completeMock.mockResolvedValueOnce({ text: '{"email":null,"facultyPageUrl":null,"website":null}' });
    await S.claudeWebSearch(candidate, 'sk-ant-test');
    expect(LLMClient).toHaveBeenCalledTimes(1);
    const ctorArg = LLMClient.mock.calls[0][0];
    expect(ctorArg).toMatchObject({ apiKey: 'sk-ant-test', model: 'claude-test-model', appName: 'contact-enrichment' });
    expect(ctorArg.timeoutMs).toBeUndefined();
  });

  it('bounds timeoutMs by the remaining deadline budget (capped at 180s)', async () => {
    completeMock.mockResolvedValueOnce({ text: '{"email":null,"facultyPageUrl":null,"website":null}' });
    const deadlineAt = Date.now() + 5_000;
    await S.claudeWebSearch(candidate, 'sk-ant-test', { deadlineAt });
    const ctorArg = LLMClient.mock.calls[0][0];
    expect(ctorArg.timeoutMs).toBeGreaterThan(0);
    expect(ctorArg.timeoutMs).toBeLessThanOrEqual(5_000);
  });

  it('caps timeoutMs at 180s when the remaining budget is larger', async () => {
    completeMock.mockResolvedValueOnce({ text: '{"email":null,"facultyPageUrl":null,"website":null}' });
    const deadlineAt = Date.now() + 10_000_000;
    await S.claudeWebSearch(candidate, 'sk-ant-test', { deadlineAt });
    const ctorArg = LLMClient.mock.calls[0][0];
    expect(ctorArg.timeoutMs).toBe(180_000);
  });

  it('returns null when the response has no text', async () => {
    completeMock.mockResolvedValueOnce({ text: '' });
    const result = await S.claudeWebSearch(candidate, 'sk-ant-test');
    expect(result).toBeNull();
  });

  it('returns null when the response text contains no JSON object', async () => {
    completeMock.mockResolvedValueOnce({ text: 'no contact info found, sorry' });
    const result = await S.claudeWebSearch(candidate, 'sk-ant-test');
    expect(result).toBeNull();
  });

  it('returns null when the parsed JSON fails schema validation (extra/bad-typed field)', async () => {
    completeMock.mockResolvedValueOnce({ text: '{"email": 12345, "facultyPageUrl": null, "website": null}' });
    const result = await S.claudeWebSearch(candidate, 'sk-ant-test');
    expect(result).toBeNull();
  });

  it('returns the validated value for a schema-valid, name-consistent email', async () => {
    completeMock.mockResolvedValueOnce({
      text: '{"email":"jgallivan@mit.edu","facultyPageUrl":"https://mit.edu/~jgallivan","website":null}',
    });
    const result = await S.claudeWebSearch(candidate, 'sk-ant-test');
    expect(result).toEqual({
      email: 'jgallivan@mit.edu',
      facultyPageUrl: 'https://mit.edu/~jgallivan',
      website: null,
    });
  });

  it('retains the citation that contains the returned email as address evidence', async () => {
    completeMock.mockResolvedValueOnce({
      text: '{"email":"jgallivan@mit.edu","facultyPageUrl":null,"website":null}',
      content: [{
        type: 'text',
        text: '{"email":"jgallivan@mit.edu","facultyPageUrl":null,"website":null}',
        citations: [{
          type: 'web_search_result_location',
          url: 'https://biology.mit.edu/people/jane-gallivan',
          title: 'Jane Gallivan',
          cited_text: 'Contact Jane Gallivan at jgallivan@mit.edu.',
        }],
      }],
    });

    const result = await S.claudeWebSearch(candidate, 'sk-ant-test');

    expect(result.emailEvidence).toMatchObject({
      sourceKind: 'claude_web_search_citation',
      sourceUrl: 'https://biology.mit.edu/people/jane-gallivan',
      citedText: expect.stringContaining('jgallivan@mit.edu'),
    });
    expect(result.facultyPageUrl).toBe('https://biology.mit.edu/people/jane-gallivan');
  });

  it('rejects (nulls) an email whose local part is not name-consistent, and records the rejection', async () => {
    completeMock.mockResolvedValueOnce({
      text: '{"email":"totallyunrelated@mit.edu","facultyPageUrl":null,"website":null}',
    });
    const result = await S.claudeWebSearch(candidate, 'sk-ant-test');
    expect(result.email).toBeNull();
    expect(result.emailRejectedReason).toBe('name_mismatch');
    expect(result.rejectedEmail).toBe('totallyunrelated@mit.edu');
  });

  it('an already-aborted signal rethrows the abort error as-is (not wrapped)', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    Object.defineProperty(controller.signal, 'aborted', { value: true });
    completeMock.mockRejectedValueOnce(abortErr);
    await expect(
      S.claudeWebSearch(candidate, 'sk-ant-test', { signal: controller.signal }),
    ).rejects.toBe(abortErr);
  });

  it('a non-abort error is wrapped as "Claude API error: <message>"', async () => {
    completeMock.mockRejectedValueOnce(new Error('network blip'));
    await expect(S.claudeWebSearch(candidate, 'sk-ant-test')).rejects.toThrow('Claude API error: network blip');
  });
});
