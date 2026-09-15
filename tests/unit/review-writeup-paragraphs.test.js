/**
 * review-writeup-paragraphs — Reviews Tab Phase II Slice 1 deterministic
 * composer. Pure module, no mocks.
 */
import {
  reviewerAffiliationOf,
  composeScoreSentence,
  composeReviewerSentence,
  composeExpertiseSentence,
  composeWriteupParagraphs,
} from '../../shared/utils/review-writeup-paragraphs';

function reviewer(overrides = {}) {
  return {
    suggestionId: overrides.suggestionId || 'g1',
    name: 'Dr. Submitted',
    reviewReceivedAt: '2026-06-20T00:00:00Z',
    reviewerOverallAssessment: 5,
    ...overrides,
  };
}

describe('composeScoreSentence', () => {
  it('tallies descending by rating, number words up to twelve', () => {
    // Discriminating: input order is ascending-by-rating (Fair before either
    // Excellent), so a non-sorting implementation would tally "one Fair and
    // two Excellent" — the wrong (input) order.
    const reviewers = [
      reviewer({ suggestionId: 'c', reviewerOverallAssessment: 2 }),
      reviewer({ suggestionId: 'a', reviewerOverallAssessment: 5 }),
      reviewer({ suggestionId: 'b', reviewerOverallAssessment: 5 }),
    ];
    const { sentence, warnings } = composeScoreSentence(reviewers);
    expect(sentence).toBe('We received three reviews with scores of two Excellent and one Fair.');
    expect(warnings).toEqual([]);
  });

  it('renders single-review grammar', () => {
    const { sentence } = composeScoreSentence([reviewer({ reviewerOverallAssessment: 4 })]);
    expect(sentence).toBe('We received one review with a score of Very Good.');
  });

  it('excludes pending (non-submitted) reviewers from the count', () => {
    const reviewers = [
      reviewer({ suggestionId: 'a', reviewerOverallAssessment: 5 }),
      // Discriminating fixture: present, unsubmitted, must be excluded.
      { suggestionId: 'pending', name: 'Dr. Pending', reviewReceivedAt: null, reviewerOverallAssessment: 3 },
    ];
    const { sentence } = composeScoreSentence(reviewers);
    expect(sentence).toBe('We received one review with a score of Excellent.');
  });

  it('numbers above twelve fall back to digits', () => {
    const reviewers = Array.from({ length: 13 }, (_, i) => reviewer({
      suggestionId: `r${i}`,
      reviewerOverallAssessment: 5,
    }));
    const { sentence } = composeScoreSentence(reviewers);
    expect(sentence).toBe('We received 13 reviews with scores of 13 Excellent.');
  });

  it('skips an unlabelled rating from the tally and reports a warning', () => {
    const reviewers = [
      reviewer({ suggestionId: 'a', reviewerOverallAssessment: 5 }),
      reviewer({ suggestionId: 'b', name: 'Dr. Legacy', reviewerOverallAssessment: 99 }),
    ];
    const { sentence, warnings } = composeScoreSentence(reviewers);
    expect(sentence).toBe('We received two reviews with scores of one Excellent.');
    expect(warnings).toEqual([
      "Dr. Legacy's overall rating has no label and was left out of the score tally.",
    ]);
  });

  it('reports a bare count when nobody has a labelled rating', () => {
    const { sentence, warnings } = composeScoreSentence([
      reviewer({ name: 'Dr. Legacy', reviewerOverallAssessment: null }),
    ]);
    expect(sentence).toBe('We received one review.');
    expect(warnings).toHaveLength(1);
  });

  it('returns null when there are no submitted reviews', () => {
    const { sentence, warnings } = composeScoreSentence([
      { suggestionId: 'pending', name: 'Dr. Pending', reviewReceivedAt: null },
    ]);
    expect(sentence).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe('composeReviewerSentence', () => {
  it('produces one clause per reviewer, descending rating, underlined names as runs', () => {
    // Discriminating: input order (Breitbart, Cordero, Nadell) is neither
    // rating-descending nor alphabetical, so this fails both a no-sort and a
    // name-sort implementation.
    const reviewers = [
      reviewer({
        suggestionId: 'c', name: 'Mya Breitbart', reviewerOverallAssessment: 2,
        academicRank: 'Professor', mainInstitution: 'University of South Florida',
      }),
      reviewer({
        suggestionId: 'a', name: 'Otto X. Cordero', reviewerOverallAssessment: 5,
        academicRank: 'Professor', mainInstitution: 'MIT',
      }),
      reviewer({
        suggestionId: 'b', name: 'Carey Nadell', reviewerOverallAssessment: 4,
        academicRank: 'Associate Professor', mainInstitution: 'Dartmouth',
      }),
    ];
    const { runs } = composeReviewerSentence(reviewers);
    const text = runs.map((r) => r.text).join('');
    expect(text).toBe(
      'The reviewers were Otto X. Cordero, a professor at MIT; Carey Nadell, an associate professor at Dartmouth; and Mya Breitbart, a professor at University of South Florida.',
    );
    const underlineRuns = runs.filter((r) => r.underline);
    expect(underlineRuns.map((r) => r.text)).toEqual(['Otto X. Cordero', 'Carey Nadell', 'Mya Breitbart']);
  });

  it('handles single-review grammar', () => {
    const { runs } = composeReviewerSentence([
      reviewer({ name: 'Dr. Solo', academicRank: 'Professor', mainInstitution: 'MIT' }),
    ]);
    expect(runs.map((r) => r.text).join('')).toBe('The reviewer was Dr. Solo, a professor at MIT.');
  });

  it('chooses a/an by the rank\'s first letter', () => {
    const { runs } = composeReviewerSentence([
      reviewer({ name: 'A', academicRank: 'Investigator', mainInstitution: 'X' }),
    ]);
    expect(runs.map((r) => r.text).join('')).toContain('an investigator');
  });

  it('collapses a blank rank to "Name of Institution"', () => {
    const { runs } = composeReviewerSentence([
      reviewer({ name: 'Dr. Norank', academicRank: '', mainInstitution: 'MIT' }),
    ]);
    expect(runs.map((r) => r.text).join('')).toBe('The reviewer was Dr. Norank of MIT.');
  });

  it('follows the institution precedence chain: mainInstitution > accepted affiliation > affiliation > fallback', () => {
    // Every case below carries ALL lower-precedence fields too, so a chain
    // that picks the wrong source (or falls through) is caught, not just a
    // chain that happens to have only one field populated.
    const full = { mainInstitution: 'Main U', reviewerAffiliation: 'Accepted U', affiliation: 'Person U' };
    expect(
      composeReviewerSentence([reviewer({ name: 'A', ...full })]).runs.map((r) => r.text).join(''),
    ).toContain('of Main U');
    expect(
      composeReviewerSentence([reviewer({ name: 'A', reviewerAffiliation: 'Accepted U', affiliation: 'Person U' })])
        .runs.map((r) => r.text).join(''),
    ).toContain('of Accepted U');
    expect(
      composeReviewerSentence([reviewer({ name: 'A', affiliation: 'Person U' })]).runs.map((r) => r.text).join(''),
    ).toContain('of Person U');
    expect(
      composeReviewerSentence([reviewer({ name: 'A' })]).runs.map((r) => r.text).join(''),
    ).toContain('of institution not recorded');
  });

  it('strips a trailing echoed email from the accepted affiliation, in the composed sentence, not just in isolation', () => {
    const isolated = reviewerAffiliationOf({
      reviewerAffiliation: 'MIT, Electronic address: jane@mit.edu',
      email: 'jane@mit.edu',
    });
    expect(isolated).toBe('MIT');

    const { runs } = composeReviewerSentence([
      reviewer({
        name: 'Jane', reviewerAffiliation: 'MIT, Electronic address: jane@mit.edu', email: 'jane@mit.edu',
      }),
    ]);
    expect(runs.map((r) => r.text).join('')).toBe('The reviewer was Jane of MIT.');
  });

  it('falls through to affiliation when the accept-time affiliation strips to empty (Opus follow-up)', () => {
    // Discriminating: reviewerAffiliation IS the reviewer's own email, so
    // reviewerAffiliationOf strips it down to null/empty; a composer that
    // stopped there (instead of falling through to `affiliation`) would emit
    // "institution not recorded" instead of "Real University".
    const { runs } = composeReviewerSentence([
      reviewer({
        name: 'A', reviewerAffiliation: 'someone@x.org', email: 'someone@x.org', affiliation: 'Real University',
      }),
    ]);
    expect(runs.map((r) => r.text).join('')).toBe('The reviewer was A of Real University.');
  });

  it('chooses "a" (not "an") for consonant-sound vowel-letter ranks (Opus follow-up)', () => {
    expect(
      composeReviewerSentence([reviewer({ name: 'A', academicRank: 'University Professor', mainInstitution: 'X' })])
        .runs.map((r) => r.text).join(''),
    ).toContain('a university professor');
    expect(
      composeReviewerSentence([reviewer({ name: 'A', academicRank: 'University Distinguished Professor', mainInstitution: 'X' })])
        .runs.map((r) => r.text).join(''),
    ).toContain('a university distinguished professor');
  });

  it('keeps roster order on a rating tie (not a name re-sort)', () => {
    // Discriminating: names are reverse-alphabetical, so a name-sorting
    // implementation would emit ['Abe', 'Zed'] instead of roster order.
    const reviewers = [
      reviewer({ suggestionId: 'first', name: 'Zed', reviewerOverallAssessment: 5 }),
      reviewer({ suggestionId: 'second', name: 'Abe', reviewerOverallAssessment: 5 }),
    ];
    const { runs } = composeReviewerSentence(reviewers);
    const underlineNames = runs.filter((r) => r.underline).map((r) => r.text);
    expect(underlineNames).toEqual(['Zed', 'Abe']);
  });
});

describe('composeExpertiseSentence', () => {
  it('prefers keywords over areaOfExpertise, caps at three areas, first letter lowercased', () => {
    const sentence = composeExpertiseSentence([
      reviewer({
        name: 'Carey Nadell', lastName: 'Nadell', reviewerOverallAssessment: 5,
        keywords: 'Microbial ecology; Evolutionary dynamics; Bacterial community interactions; Fourth area',
        areaOfExpertise: 'Should not be used',
      }),
    ]);
    expect(sentence).toBe('Nadell has expertise in microbial ecology, evolutionary dynamics, and bacterial community interactions.');
  });

  it('falls back to areaOfExpertise when keywords is absent', () => {
    const sentence = composeExpertiseSentence([
      reviewer({ name: 'Cordero', lastName: 'Cordero', areaOfExpertise: 'Microbial ecology; Environmental microbiology' }),
    ]);
    expect(sentence).toBe('Cordero has expertise in microbial ecology and environmental microbiology.');
  });

  it('joins a pair with "while" and starts a new sentence for a third reviewer', () => {
    // Discriminating: input order (Cordero, Nadell, Breitbart) is not
    // rating-descending, so a non-sorting implementation would pair
    // Cordero+Nadell instead of Nadell+Breitbart.
    const sentence = composeExpertiseSentence([
      reviewer({ suggestionId: 'c', name: 'Cordero', lastName: 'Cordero', reviewerOverallAssessment: 2, keywords: 'phage biology' }),
      reviewer({ suggestionId: 'a', name: 'Nadell', lastName: 'Nadell', reviewerOverallAssessment: 5, keywords: 'microbial ecology' }),
      reviewer({ suggestionId: 'b', name: 'Breitbart', lastName: 'Breitbart', reviewerOverallAssessment: 4, keywords: 'viral ecology' }),
    ]);
    expect(sentence).toBe(
      'Nadell has expertise in microbial ecology, while Breitbart has expertise in viral ecology. Cordero has expertise in phage biology.',
    );
  });

  it('omits a reviewer with no expertise data', () => {
    const sentence = composeExpertiseSentence([
      reviewer({ suggestionId: 'a', name: 'Nadell', lastName: 'Nadell', reviewerOverallAssessment: 5, keywords: 'microbial ecology' }),
      reviewer({ suggestionId: 'b', name: 'NoData', lastName: 'NoData', reviewerOverallAssessment: 4 }),
    ]);
    expect(sentence).toBe('Nadell has expertise in microbial ecology.');
  });

  it('falls back to the last token of name when lastName is absent', () => {
    const sentence = composeExpertiseSentence([
      reviewer({ name: 'Carey Nadell', keywords: 'microbial ecology' }),
    ]);
    expect(sentence).toBe('Nadell has expertise in microbial ecology.');
  });

  it('returns null when nobody has expertise data', () => {
    expect(composeExpertiseSentence([reviewer({ name: 'A' })])).toBeNull();
  });

  it('keeps an acronym area\'s case (second letter uppercase) instead of lowercasing it', () => {
    const sentence = composeExpertiseSentence([
      reviewer({ name: 'A', lastName: 'A', keywords: 'DNA repair; CRISPR screens; Molecular biology' }),
    ]);
    expect(sentence).toBe('A has expertise in DNA repair, CRISPR screens, and molecular biology.');
  });
});

describe('composeWriteupParagraphs', () => {
  it('composes all three deterministic sentences and both serialisations', () => {
    const reviewers = [
      reviewer({
        name: 'Carey Nadell', lastName: 'Nadell', reviewerOverallAssessment: 5,
        academicRank: 'Professor', mainInstitution: 'Dartmouth', keywords: 'microbial ecology',
      }),
    ];
    const { paragraphs, text, html, warnings } = composeWriteupParagraphs({ reviewers });
    expect(paragraphs).toHaveLength(3);
    expect(warnings).toEqual([]);
    expect(text).toContain('We received one review with a score of Excellent.');
    expect(html).toContain('<u>Carey Nadell</u>');
    expect(html).not.toContain('<script');
  });

  it('escapes Dataverse text in the HTML serialisation', () => {
    const { html } = composeWriteupParagraphs({
      reviewers: [reviewer({ name: '<b>Injected</b>', mainInstitution: 'X' })],
    });
    expect(html).toContain('&lt;b&gt;Injected&lt;/b&gt;');
    expect(html).not.toContain('<b>Injected</b>');
  });

  it('escapes markup in mainInstitution (reviewer sentence) and keywords (expertise sentence, non-underline branch)', () => {
    const { html } = composeWriteupParagraphs({
      reviewers: [reviewer({
        name: 'A', lastName: 'A', mainInstitution: '<i>Evil U</i>', keywords: '<script>alert(1)</script>',
      })],
    });
    expect(html).toContain('&lt;i&gt;Evil U&lt;/i&gt;');
    expect(html).not.toContain('<i>Evil U</i>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('ignores a synthesis object in Slice 1 (no themes/quotations appended)', () => {
    const { text } = composeWriteupParagraphs({
      reviewers: [reviewer({ name: 'A', mainInstitution: 'X' })],
      synthesis: { writeupThemes: 'Should not appear', writeupQuotations: [{ quote: 'nope' }] },
    });
    expect(text).not.toContain('Should not appear');
    expect(text).not.toContain('nope');
  });
});
