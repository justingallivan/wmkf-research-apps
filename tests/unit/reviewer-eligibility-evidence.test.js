/** @jest-environment node */

const {
  buildEligibilityQuery,
  classifyEligibilitySearchLeads,
  classifyEligibilityPage,
  attachEligibilityEvidence,
} = require('../../lib/services/contact-enrichment/eligibility-evidence');

const CHECKED_AT = '2026-07-19T12:00:00.000Z';

describe('reviewer eligibility evidence', () => {
  test('classifies direct first-party deceased evidence', () => {
    const out = classifyEligibilitySearchLeads('Patricia Thiel', [{
      title: 'Ames Lab Researcher Patricia Thiel Passes Away',
      link: 'https://www.ameslab.gov/news/patricia-thiel-passes-away',
      snippet: 'Patricia Thiel, an Ames Laboratory scientist and Iowa State professor, passed away on September 7.',
    }], ['ameslab.gov'], CHECKED_AT);

    expect(out).toMatchObject({
      status: 'deceased',
      evidence: {
        status: 'deceased',
        sourceDomain: 'ameslab.gov',
        checkedAt: CHECKED_AT,
      },
    });
  });

  test.each([
    ['middle initial', 'Patricia A. Thiel, age 67, died on September 7.'],
    ['parenthetical nickname', 'Patricia (Pat) Thiel passed away on September 7.'],
  ])('accepts a conservative %s in candidate-bound evidence', (_label, snippet) => {
    const out = classifyEligibilitySearchLeads('Patricia Thiel', [{
      title: 'Department notice',
      link: 'https://www.chem.iastate.edu/news/patricia-thiel',
      snippet,
    }], ['iastate.edu'], CHECKED_AT);
    expect(out.status).toBe('deceased');
  });

  test('classifies direct first-party emeritus evidence', () => {
    const out = classifyEligibilitySearchLeads('Michael Feiss', [{
      title: 'Michael Feiss | Professor Emeritus',
      link: 'https://biology.uiowa.edu/people/michael-feiss',
      snippet: 'Michael Feiss is Professor Emeritus in the Department of Biology.',
    }], ['uiowa.edu'], CHECKED_AT);

    expect(out.status).toBe('emeritus');
    expect(out.evidence.url).toContain('uiowa.edu');
  });

  test.each([
    ['unrelated obituary navigation', 'Sharon Glotzer', ['umich.edu'], {
      title: 'Sharon Glotzer | Chemical Engineering',
      link: 'https://che.engin.umich.edu/people/sharon-glotzer/',
      snippet: 'Sharon Glotzer leads the group. Department news: remembering Professor John Doe, who died in 2024.',
    }],
    ['candidate remembers somebody else', 'Ju Li', ['mit.edu'], {
      title: 'Ju Li remembers a colleague',
      link: 'https://dmse.mit.edu/news/ju-li-remembers-a-colleague/',
      snippet: 'Ju Li remembers Professor John Doe, who passed away after a long career.',
    }],
    ['candidate appears in somebody else’s memorial title', 'Patricia Thiel', ['ameslab.gov'], {
      title: 'Remembering John Doe: Patricia Thiel reflects on a colleague',
      link: 'https://www.ameslab.gov/news/remembering-john-doe',
      snippet: 'Patricia Thiel remembers John Doe, who passed away after a long career.',
    }],
    ['shared faculty list assigns emeritus role to another person', 'Alice Smith', ['university.edu'], {
      title: 'Department faculty',
      link: 'https://university.edu/faculty',
      snippet: 'Alice Smith, Department Chair; Bob Jones, Professor Emeritus.',
    }],
    ['cross-person first/last name span reports somebody else’s death', 'Alice Smith', ['university.edu'], {
      title: 'Alice Smith faculty profile',
      link: 'https://university.edu/faculty/alice-smith',
      snippet: 'Alice introduced Bob Smith, who died after a long career.',
    }],
    ['cross-person first/last name span assigns somebody else’s emeritus role', 'Alice Smith', ['university.edu'], {
      title: 'Alice Smith faculty profile',
      link: 'https://university.edu/faculty/alice-smith',
      snippet: 'Alice introduced Bob Smith, Professor Emeritus.',
    }],
    ['third-party obituary', 'Active Person', ['university.edu'], {
      title: 'Obituary: Active Person',
      link: 'https://example-obituaries.com/active-person',
      snippet: 'Active Person died yesterday.',
    }],
  ])('does not classify %s', (_label, name, domains, item) => {
    expect(classifyEligibilitySearchLeads(name, [item], domains, CHECKED_AT))
      .toEqual({ status: 'unknown', reason: null, evidence: null });
  });

  test('query binds the name to trusted institution domains', () => {
    expect(buildEligibilityQuery('Dr. Roald Hoffmann', ['cornell.edu', 'chem.cornell.edu']))
      .toBe('"Roald Hoffmann" (site:cornell.edu OR site:chem.cornell.edu) ("passed away" OR died OR obituary OR "in memoriam" OR emeritus OR retired)');
  });

  test('leaves eligibility incomplete when the candidate identity is unresolved', async () => {
    const result = {
      name: 'Unresolved Person',
      contactEnrichment: {
        identity: { status: 'unresolved' },
        anchoredInstitutionDomains: ['university.edu'],
      },
    };
    const searchOrganicResults = jest.fn();

    await attachEligibilityEvidence(result, result, {
      useSerpSearch: true,
      credentials: { serpApiKey: 'test-key' },
      searchOrganicResults,
    });

    expect(result).toMatchObject({
      eligibilityStatus: 'unknown',
      eligibilityCheckStatus: 'incomplete',
      contactEnrichment: {
        eligibilityStatus: 'unknown',
        eligibilityCheckStatus: 'incomplete',
      },
    });
    expect(searchOrganicResults).not.toHaveBeenCalled();
  });

  test('requires a candidate-anchored first-party page before hard deceased classification', async () => {
    const result = {
      name: 'Patricia Thiel',
      contactEnrichment: {
        identity: { status: 'confirmed' },
        anchoredInstitutionDomains: ['ameslab.gov'],
      },
    };
    const fetchInstitutionPage = jest.fn(async () => ({
      ok: true,
      finalUrl: 'https://www.ameslab.gov/news/patricia-thiel-passes-away',
      text: '<html><head><title>Patricia Thiel Passes Away</title></head><body><h1>Patricia Thiel Passes Away</h1><p>Patricia Thiel, an Ames Laboratory scientist, passed away on September 7.</p></body></html>',
    }));
    await attachEligibilityEvidence(result, result, {
      useSerpSearch: true,
      credentials: { serpApiKey: 'test-key' },
      searchOrganicResults: async () => [{
        title: 'Ames Lab Researcher Patricia Thiel Passes Away',
        link: 'https://www.ameslab.gov/news/patricia-thiel-passes-away',
        snippet: 'Patricia Thiel, an Ames Laboratory scientist, passed away on September 7.',
      }],
      fetchInstitutionPage,
      now: () => CHECKED_AT,
    });

    expect(fetchInstitutionPage).toHaveBeenCalledWith(
      expect.stringContaining('patricia-thiel'),
      expect.objectContaining({ allowedDomain: 'ameslab.gov' }),
    );
    expect(result).toMatchObject({
      eligibilityStatus: 'deceased',
      eligibilityEvidence: {
        status: 'deceased',
        sourceDomain: 'ameslab.gov',
        checkedAt: CHECKED_AT,
      },
    });
  });

  test('accepts a nickname headline when the fetched first-party body directly binds the full name', async () => {
    const result = {
      name: 'Patricia Thiel',
      contactEnrichment: {
        identity: { status: 'probable' },
        anchoredInstitutionDomains: ['iastate.edu'],
      },
    };
    await attachEligibilityEvidence(result, result, {
      useSerpSearch: true,
      credentials: { serpApiKey: 'test-key' },
      searchOrganicResults: async () => [{
        title: 'Dr. Pat Thiel | Department of Chemistry',
        link: 'https://www.chem.iastate.edu/news/2020/dr-pat-thiel',
        snippet: 'Patricia A. Thiel, age 67, died on Monday, September 7, 2020.',
      }],
      fetchInstitutionPage: async () => ({
        ok: true,
        finalUrl: 'https://www.chem.iastate.edu/news/2020/dr-pat-thiel',
        text: '<html><head><title>Dr. Pat Thiel | Department of Chemistry</title></head><body><h1>Dr. Pat Thiel</h1><p>Patricia A. Thiel, age 67, died on Monday, September 7, 2020.</p></body></html>',
      }),
      now: () => CHECKED_AT,
    });

    expect(result).toMatchObject({
      eligibilityStatus: 'deceased',
      eligibilityEvidence: {
        status: 'deceased',
        sourceDomain: 'chem.iastate.edu',
        snippet: expect.stringContaining('Patricia A. Thiel'),
      },
    });
  });

  test('abstains when the first-party page does not bind the death to the candidate', async () => {
    const result = {
      name: 'Patricia Thiel',
      contactEnrichment: {
        identity: { status: 'confirmed' },
        anchoredInstitutionDomains: ['ameslab.gov'],
      },
    };
    await attachEligibilityEvidence(result, result, {
      useSerpSearch: true,
      credentials: { serpApiKey: 'test-key' },
      searchOrganicResults: async () => [{
        title: 'Patricia Thiel remembers John Doe',
        link: 'https://www.ameslab.gov/news/remembering-john-doe',
        snippet: 'Patricia Thiel remembers John Doe, who passed away.',
      }],
      fetchInstitutionPage: async () => ({
        ok: true,
        text: '<html><head><title>Patricia Thiel remembers John Doe</title></head><body><h1>Patricia Thiel remembers John Doe</h1><p>John Doe passed away. Patricia Thiel described his work.</p></body></html>',
      }),
    });

    expect(result.eligibilityStatus).toBe('unknown');
    expect(result.eligibilityEvidence).toBeNull();
  });

  test('page classifier requires a title or sole-H1 identity anchor', () => {
    expect(classifyEligibilityPage('Alice Smith', {
      titleText: 'Department news',
      h1Texts: ['Faculty updates'],
      text: 'Alice Smith passed away.',
    }, 'https://university.edu/news', CHECKED_AT)).toEqual({
      status: 'unknown',
      reason: null,
      evidence: null,
    });
  });

  test.each([
    'Alice introduced Bob Smith, who died after a long career.',
    'Alice introduced Bob Smith, Professor Emeritus.',
  ])('page classifier does not span first and last names across people: %s', (text) => {
    expect(classifyEligibilityPage('Alice Smith', {
      titleText: 'Alice Smith faculty profile',
      h1Texts: ['Alice Smith'],
      text,
    }, 'https://university.edu/faculty/alice-smith', CHECKED_AT)).toEqual({
      status: 'unknown',
      reason: null,
      evidence: null,
    });
  });

  test('provider failure leaves unknown and does not throw', async () => {
    const result = {
      name: 'Active Person',
      contactEnrichment: {
        identity: { status: 'confirmed' },
        anchoredInstitutionDomains: ['university.edu'],
      },
    };
    await attachEligibilityEvidence(result, result, {
      useSerpSearch: true,
      credentials: { serpApiKey: 'test-key' },
      searchOrganicResults: async () => { throw new Error('provider down'); },
    });
    expect(result.eligibilityStatus).toBe('unknown');
    expect(result.contactEnrichment.eligibilityEvidence).toBeNull();
  });
});
