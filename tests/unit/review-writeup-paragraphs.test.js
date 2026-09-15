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

  it('renders themes but drops an unverifiable quote (Slice 2)', () => {
    const { text, warnings, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers: [reviewer({ name: 'A', mainInstitution: 'X' })],
      synthesis: { writeupThemes: 'Reviewers were broadly positive.', writeupQuotations: [{ quote: 'nope, not in any answer' }] },
    });
    expect(text).toContain('Reviewers were broadly positive.');
    expect(text).not.toContain('nope');
    expect(droppedQuotationCount).toBe(1);
    expect(warnings).toContainEqual(expect.stringContaining('1 quotation(s) could not be matched'));
  });

  it('renders only the deterministic sentences when synthesis is absent (pre-Slice-2 stored row)', () => {
    const result = composeWriteupParagraphs({
      reviewers: [reviewer({ name: 'A', mainInstitution: 'X' })],
    });
    expect(result.themes).toBeNull();
    expect(result.quotations).toEqual([]);
    expect(result.droppedQuotationCount).toBe(0);
    expect(result.paragraphs).toHaveLength(2); // score + reviewer (no expertise data)
  });

  it('renders only the deterministic sentences when synthesis is current-but-empty', () => {
    const result = composeWriteupParagraphs({
      reviewers: [reviewer({ name: 'A', mainInstitution: 'X' })],
      synthesis: { writeupThemes: '', writeupQuotations: [] },
    });
    expect(result.themes).toBeNull();
    expect(result.quotations).toEqual([]);
    expect(result.droppedQuotationCount).toBe(0);
  });
});

describe('composeWriteupParagraphs — Slice 2 quotation provenance', () => {
  function reviewerWithAnswers(overrides, answers) {
    return reviewer({ ...overrides, answers });
  }

  it('drops a paraphrased quote (not a verbatim substring of any answer)', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'This proposal has a rigorous and well-designed methodology.' }],
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: 'This is a very rigorous methodology.' }] },
    });
    expect(quotations).toEqual([]);
    expect(droppedQuotationCount).toBe(1);
  });

  it('keeps a curly-quote/whitespace variant of a real sentence', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: "The PI's   approach   is “innovative” and timely." }],
      ),
    ];
    const { quotations } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: 'The PI\'s approach is "innovative" and timely.' }] },
    });
    expect(quotations).toHaveLength(1);
    expect(quotations[0].quote).toBe('The PI\'s approach is "innovative" and timely.');
  });

  it('keeps a case-folded variant of a real sentence (casing differs, text matches)', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'The design is Innovative and well justified.' }],
      ),
    ];
    const { quotations } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: 'the design is innovative and well justified.' }] },
    });
    expect(quotations).toHaveLength(1);
  });

  it('escapes markup in a synthesized theme and a verified quote in the HTML serialisation', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', mainInstitution: 'X', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'This is <b>bold</b> and unsafe text in a review.' }],
      ),
    ];
    const { html } = composeWriteupParagraphs({
      reviewers,
      synthesis: {
        writeupThemes: 'Reviewers <script>alert(1)</script> agreed.',
        writeupQuotations: [{ questionKey: 'q1', quote: 'This is <b>bold</b> and unsafe text in a review.' }],
      },
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('keeps only one of two quotes attributed to the same reviewer (first wins)', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [
          { questionKey: 'q1', answerText: 'The first sentence is here.' },
          { questionKey: 'q2', answerText: 'The second sentence is here.' },
        ],
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: {
        writeupQuotations: [
          { questionKey: 'q1', quote: 'The first sentence is here.' },
          { questionKey: 'q2', quote: 'The second sentence is here.' },
        ],
      },
    });
    expect(quotations).toHaveLength(1);
    expect(quotations[0].quote).toBe('The first sentence is here.');
    expect(droppedQuotationCount).toBe(1);
  });

  it('orders kept quotes by rating, not by the order the model supplied them', () => {
    // Discriminating: the model lists the low-rated reviewer's quote first.
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'low', name: 'Low', reviewerOverallAssessment: 2 },
        [{ questionKey: 'q1', answerText: 'This proposal has serious flaws.' }],
      ),
      reviewerWithAnswers(
        { suggestionId: 'high', name: 'High', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'This proposal is outstanding work.' }],
      ),
    ];
    const { quotations } = composeWriteupParagraphs({
      reviewers,
      synthesis: {
        writeupQuotations: [
          { questionKey: 'q1', quote: 'This proposal has serious flaws.' },
          { questionKey: 'q1', quote: 'This proposal is outstanding work.' },
        ],
      },
    });
    expect(quotations.map((q) => q.quote)).toEqual([
      'This proposal is outstanding work.',
      'This proposal has serious flaws.',
    ]);
    expect(quotations[0].leadIn).toBe('The most positive reviewer said:');
    expect(quotations[1].leadIn).toBe('The most critical reviewer noted:');
  });

  it('drops a quote that matches two reviewers\' answers (ambiguous attribution)', () => {
    const sharedText = 'This exact sentence appears in both reviews verbatim.';
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: sharedText }],
      ),
      reviewerWithAnswers(
        { suggestionId: 'b', name: 'B', reviewerOverallAssessment: 4 },
        [{ questionKey: 'q1', answerText: sharedText }],
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: sharedText }] },
    });
    expect(quotations).toEqual([]);
    expect(droppedQuotationCount).toBe(1);
  });

  it('reduces five survivors to top, median, and bottom by rating (W8)', () => {
    // Discriminating: ratings are neither in roster order nor in candidate-list
    // order, so a broken implementation that picks by index rather than
    // sorting by rating (desc) would fail this assertion.
    const ratings = [3, 5, 1, 4, 2];
    const reviewers = ratings.map((rating, i) => reviewerWithAnswers(
      { suggestionId: `r${i}`, name: `R${i}`, reviewerOverallAssessment: rating },
      [{ questionKey: 'q1', answerText: `Reviewer ${i} quote text goes here.` }],
    ));
    const { quotations } = composeWriteupParagraphs({
      reviewers,
      synthesis: {
        writeupQuotations: ratings.map((_, i) => ({ questionKey: 'q1', quote: `Reviewer ${i} quote text goes here.` })),
      },
    });
    expect(quotations).toHaveLength(3);
    // Sorted desc by rating: R1(5), R3(4), R0(3), R4(2), R2(1) — top/median/bottom = R1, R0, R2.
    expect(quotations.map((q) => q.quote)).toEqual([
      'Reviewer 1 quote text goes here.',
      'Reviewer 0 quote text goes here.',
      'Reviewer 2 quote text goes here.',
    ]);
    expect(quotations.map((q) => q.leadIn)).toEqual([
      'The most positive reviewer said:',
      'Another reviewer noted:',
      'The most critical reviewer noted:',
    ]);
  });

  it('breaks a rating tie by canonical name order, not roster order or candidate-list order (W8)', () => {
    // Discriminating: both reviewers tie at rating 5. The reviewers array
    // arrives in roster order [Zed, Abe] (reverse of name order) and the
    // candidate list is given in yet a third order ([Abe's quote, Zed's
    // quote]). An implementation that fell back to roster-array index or
    // candidate-list order would produce [Zed, Abe] or [Abe, Zed]
    // respectively for the wrong reason; canonical name order also happens
    // to put Abe first, so this alone doesn't fully discriminate — see the
    // next test, which flips the roster order and re-asserts the identical
    // result.
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'zed', name: 'Zed', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'Zed thinks this is excellent work.' }],
      ),
      reviewerWithAnswers(
        { suggestionId: 'abe', name: 'Abe', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'Abe also thinks this is excellent.' }],
      ),
    ];
    const { quotations } = composeWriteupParagraphs({
      reviewers,
      synthesis: {
        writeupQuotations: [
          { questionKey: 'q1', quote: 'Abe also thinks this is excellent.' },
          { questionKey: 'q1', quote: 'Zed thinks this is excellent work.' },
        ],
      },
    });
    expect(quotations.map((q) => q.quote)).toEqual([
      'Abe also thinks this is excellent.',
      'Zed thinks this is excellent work.',
    ]);
  });

  it('selects the identical three quotations regardless of the caller-supplied reviewer order (Opus Slice 2 review follow-up 1)', () => {
    // Discriminating: five reviewers with two tied at the top rating (5) and
    // two tied at the bottom rating (1) — the exact shape that forces W8's
    // top/median/bottom reduction to depend on a tie-break. Call the composer
    // once with the reviewers in one order (as the tab's name-sort would
    // produce) and once in the reverse order (as an unsorted Dataverse fetch
    // might produce) and require byte-identical selected quotes — this is
    // the cross-surface invariant the tab (name-sorted `submitted`) and the
    // export roster must both satisfy.
    const specs = [
      { suggestionId: 'r-alice', name: 'Alice', rating: 5, text: 'Alice found the proposal exceptional.' },
      { suggestionId: 'r-bob', name: 'Bob', rating: 5, text: 'Bob also found it exceptional overall.' },
      { suggestionId: 'r-carol', name: 'Carol', rating: 3, text: 'Carol thought it was solid but unremarkable.' },
      { suggestionId: 'r-dave', name: 'Dave', rating: 1, text: 'Dave raised serious concerns about the design.' },
      { suggestionId: 'r-erin', name: 'Erin', rating: 1, text: 'Erin also raised serious concerns about scope.' },
    ];
    const toReviewer = (spec) => reviewerWithAnswers(
      { suggestionId: spec.suggestionId, name: spec.name, reviewerOverallAssessment: spec.rating },
      [{ questionKey: 'q1', answerText: spec.text }],
    );
    const candidates = specs.map((s) => ({ questionKey: 'q1', quote: s.text }));

    const forward = composeWriteupParagraphs({
      reviewers: specs.map(toReviewer),
      synthesis: { writeupQuotations: candidates },
    });
    const reversed = composeWriteupParagraphs({
      reviewers: [...specs].reverse().map(toReviewer),
      synthesis: { writeupQuotations: [...candidates].reverse() },
    });

    expect(forward.quotations.map((q) => q.quote)).toEqual(reversed.quotations.map((q) => q.quote));
    expect(forward.quotations).toHaveLength(3);
  });

  it('drops a candidate whose quote is an empty string', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: 'Some real answer text here.' }],
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: '' }, { questionKey: 'q1', quote: '   ' }] },
    });
    expect(quotations).toEqual([]);
    expect(droppedQuotationCount).toBe(2);
  });

  it('never matches against a null/non-string answerText', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{ questionKey: 'q1', answerText: null }, { questionKey: 'q2' }],
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: 'anything at all' }] },
    });
    expect(quotations).toEqual([]);
    expect(droppedQuotationCount).toBe(1);
  });

  it('never matches a reviewer with no answers array at all', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        undefined,
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: 'anything at all' }] },
    });
    expect(quotations).toEqual([]);
    expect(droppedQuotationCount).toBe(1);
  });

  it('orders an unlabelled (null) rating quote last, after every labelled survivor', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'unlabelled', name: 'Unlabelled', reviewerOverallAssessment: null },
        [{ questionKey: 'q1', answerText: 'This reviewer left no overall rating at all.' }],
      ),
      reviewerWithAnswers(
        { suggestionId: 'low', name: 'Low', reviewerOverallAssessment: 2 },
        [{ questionKey: 'q1', answerText: 'This reviewer gave a low rating overall.' }],
      ),
    ];
    const { quotations } = composeWriteupParagraphs({
      reviewers,
      // Candidate list deliberately lists the unlabelled reviewer's quote
      // FIRST — a broken implementation that treats a null rating as 0 (or
      // trusts candidate order) would rank it ahead of, or tied with, the
      // labelled rating-2 reviewer.
      synthesis: {
        writeupQuotations: [
          { questionKey: 'q1', quote: 'This reviewer left no overall rating at all.' },
          { questionKey: 'q1', quote: 'This reviewer gave a low rating overall.' },
        ],
      },
    });
    expect(quotations.map((q) => q.quote)).toEqual([
      'This reviewer gave a low rating overall.',
      'This reviewer left no overall rating at all.',
    ]);
  });

  it('quote provenance reads answerText only — a sentence present ONLY in answerHtml is dropped as unverified', () => {
    const reviewers = [
      reviewerWithAnswers(
        { suggestionId: 'a', name: 'A', reviewerOverallAssessment: 5 },
        [{
          questionKey: 'q1',
          answerText: 'A short plain-text summary that omits the quoted sentence.',
          answerHtml: '<p>The design is <strong>truly innovative</strong> and compelling.</p>',
        }],
      ),
    ];
    const { quotations, droppedQuotationCount } = composeWriteupParagraphs({
      reviewers,
      synthesis: { writeupQuotations: [{ questionKey: 'q1', quote: 'The design is truly innovative and compelling.' }] },
    });
    expect(quotations).toEqual([]);
    expect(droppedQuotationCount).toBe(1);
  });
});
