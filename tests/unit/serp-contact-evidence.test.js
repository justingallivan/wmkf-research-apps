/**
 * @jest-environment node
 */

const { SerpContactService } = require('../../lib/services/serp-contact-service');

function response(organicResults) {
  return {
    ok: true,
    json: async () => ({ organic_results: organicResults }),
  };
}

describe('SerpContactService email evidence experiment', () => {
  const originalFlag = process.env.REVIEWER_EMAIL_EVIDENCE_EXPERIMENT_ENABLED;
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.REVIEWER_EMAIL_EVIDENCE_EXPERIMENT_ENABLED;
    else process.env.REVIEWER_EMAIL_EVIDENCE_EXPERIMENT_ENABLED = originalFlag;
  });

  test('continues after an email-less profile and binds the email to its own result URL', async () => {
    process.env.REVIEWER_EMAIL_EVIDENCE_EXPERIMENT_ENABLED = 'true';
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response([{
        title: 'Dr Alex Kim',
        link: 'https://one.edu/people/alex-kim',
        snippet: 'Alex Kim is Professor of Biology.',
      }]))
      .mockResolvedValueOnce(response([{
        title: 'Alex Kim contact',
        link: 'https://directory.one.edu/alex-kim',
        snippet: 'Email Alex Kim at alex.kim@one.edu for research enquiries.',
      }]));

    const result = await SerpContactService.findContact(
      { name: 'Dr. Alex Kim', affiliation: 'One University' },
      'test-key',
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.email).toBe('alex.kim@one.edu');
    expect(result.facultyPageUrl).toBe('https://one.edu/people/alex-kim');
    expect(result.emailEvidence).toMatchObject({
      sourceKind: 'serp_result',
      sourceUrl: 'https://directory.one.edu/alex-kim',
      citedText: expect.stringContaining('alex.kim@one.edu'),
    });
  });

  test('retains the previous request budget when the experiment is disabled', async () => {
    delete process.env.REVIEWER_EMAIL_EVIDENCE_EXPERIMENT_ENABLED;
    global.fetch = jest.fn().mockResolvedValueOnce(response([{
      title: 'Dr Alex Kim',
      link: 'https://one.edu/people/alex-kim',
      snippet: 'Alex Kim is Professor of Biology.',
    }]));

    const result = await SerpContactService.findContact(
      { name: 'Dr. Alex Kim', affiliation: 'One University' },
      'test-key',
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.email).toBeNull();
    expect(result.facultyPageUrl).toBe('https://one.edu/people/alex-kim');
  });
});
