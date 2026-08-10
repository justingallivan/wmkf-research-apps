/**
 * composeReviewReport + htmlToBlocks — workbench Reviews tab Phase 3 panel-
 * prep report composition (docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Covers: the HTML→block tokenizer against every tag in the sanitizer's
 * allowlist (lib/external/sanitize-review-html.js ALLOWED_TAGS — p, br,
 * strong/b, em/i, ul/ol/li, h2/h3, blockquote, a), nesting, unknown-tag
 * degradation, empty/null input, malformed fragments, and the report
 * composition itself (header/summary/answerSections) built
 * on top of `deriveReviewMatrix`.
 */
import { composeReviewReport, htmlToBlocks } from '../../shared/utils/review-report';
import { deriveReviewMatrix } from '../../shared/utils/review-matrix';

describe('htmlToBlocks', () => {
  test('null/undefined/empty/whitespace-only input returns []', () => {
    expect(htmlToBlocks(null)).toEqual([]);
    expect(htmlToBlocks(undefined)).toEqual([]);
    expect(htmlToBlocks('')).toEqual([]);
    expect(htmlToBlocks('   ')).toEqual([]);
    expect(htmlToBlocks(42)).toEqual([]);
  });

  test('plain <p> paragraph', () => {
    const blocks = htmlToBlocks('<p>Hello world</p>');
    expect(blocks).toEqual([
      { type: 'paragraph', runs: [{ text: 'Hello world', bold: false, italic: false, href: null }] },
    ]);
  });

  test('structurally-empty paragraphs ("<p></p>", "<p><br></p>") are dropped, not thrown', () => {
    expect(htmlToBlocks('<p></p>')).toEqual([]);
    expect(htmlToBlocks('<p><br></p>')).toEqual([]);
  });

  test('<br> becomes an embedded newline run within the same paragraph', () => {
    const blocks = htmlToBlocks('<p>line1<br>line2</p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    const text = blocks[0].runs.map((r) => r.text).join('');
    expect(text).toBe('line1\nline2');
  });

  test('strong/b and em/i produce bold/italic runs, including nested bold+italic', () => {
    expect(htmlToBlocks('<p><strong>bold</strong></p>')[0].runs[0]).toMatchObject({ bold: true, italic: false });
    expect(htmlToBlocks('<p><b>bold</b></p>')[0].runs[0]).toMatchObject({ bold: true });
    expect(htmlToBlocks('<p><em>ital</em></p>')[0].runs[0]).toMatchObject({ italic: true, bold: false });
    expect(htmlToBlocks('<p><i>ital</i></p>')[0].runs[0]).toMatchObject({ italic: true });
    const nested = htmlToBlocks('<p><strong>bold and <em>both</em></strong></p>');
    const both = nested[0].runs.find((r) => r.text === 'both');
    expect(both).toMatchObject({ bold: true, italic: true });
  });

  test('h2/h3 map to heading2/heading3 blocks', () => {
    expect(htmlToBlocks('<h2>Section</h2>')[0]).toMatchObject({ type: 'heading2', runs: [{ text: 'Section' }] });
    expect(htmlToBlocks('<h3>Sub</h3>')[0]).toMatchObject({ type: 'heading3', runs: [{ text: 'Sub' }] });
  });

  test('blockquote maps to a blockquote block', () => {
    const blocks = htmlToBlocks('<blockquote>Quoted text</blockquote>');
    expect(blocks[0]).toMatchObject({ type: 'blockquote', runs: [{ text: 'Quoted text' }] });
  });

  test('ul/li produces unordered list-item blocks; ol/li produces ordered ones', () => {
    const ul = htmlToBlocks('<ul><li>one</li><li>two</li></ul>');
    expect(ul).toEqual([
      { type: 'list-item', ordered: false, runs: [{ text: 'one', bold: false, italic: false, href: null }] },
      { type: 'list-item', ordered: false, runs: [{ text: 'two', bold: false, italic: false, href: null }] },
    ]);
    const ol = htmlToBlocks('<ol><li>first</li></ol>');
    expect(ol[0]).toMatchObject({ type: 'list-item', ordered: true });
  });

  test('<a href> carries its href on the run and is scoped to its own text', () => {
    const blocks = htmlToBlocks('<p>See <a href="https://example.org">this link</a> for more.</p>');
    const runs = blocks[0].runs;
    const linkRun = runs.find((r) => r.text === 'this link');
    expect(linkRun.href).toBe('https://example.org');
    const before = runs.find((r) => r.text === 'See ');
    expect(before.href).toBeNull();
  });

  test('a link without an href (sanitizer strips one lacking a safe scheme) still keeps its text', () => {
    const blocks = htmlToBlocks('<p><a>bare link text</a></p>');
    expect(blocks[0].runs[0]).toMatchObject({ text: 'bare link text', href: null });
  });

  test('unknown/unexpected tag degrades to plain text: tag stripped, content kept, never thrown', () => {
    expect(() => htmlToBlocks('<p>Has a <span class="x">span</span> in it</p>')).not.toThrow();
    const blocks = htmlToBlocks('<p>Has a <span class="x">span</span> in it</p>');
    const text = blocks.map((b) => b.runs.map((r) => r.text).join('')).join('');
    expect(text).toContain('span');
    expect(text).not.toContain('<span');
  });

  test('malformed/unclosed fragments do not throw and content is preserved', () => {
    expect(() => htmlToBlocks('<p>unclosed paragraph')).not.toThrow();
    expect(htmlToBlocks('<p>unclosed paragraph')[0].runs[0].text).toBe('unclosed paragraph');

    expect(() => htmlToBlocks('</p>stray closer<p>text</p>')).not.toThrow();
    const stray = htmlToBlocks('</p>stray closer<p>text</p>');
    const allText = stray.map((b) => b.runs.map((r) => r.text).join('')).join('|');
    expect(allText).toContain('stray closer');
    expect(allText).toContain('text');

    // A new block tag implicitly closes a still-open one instead of nesting/throwing.
    expect(() => htmlToBlocks('<p>one<p>two</p>')).not.toThrow();
  });

  test('multiple top-level paragraphs each become their own block', () => {
    const blocks = htmlToBlocks('<p>First</p><p>Second</p>');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].runs[0].text).toBe('First');
    expect(blocks[1].runs[0].text).toBe('Second');
  });

  test('entities are decoded in text content', () => {
    const blocks = htmlToBlocks('<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot;</p>');
    expect(blocks[0].runs[0].text).toBe('Tom & Jerry <3 "quotes"');
  });
});

describe('composeReviewReport', () => {
  function reviewer(suggestionId, name, answers) {
    return { suggestionId, name, answers };
  }
  function row(questionKey, questionOrder, questionType, questionText, opts = {}) {
    return { questionKey, questionOrder, questionType, questionText, answerText: null, answerHtml: null, answerValue: null, ...opts };
  }

  test('composes header, summary, and answerSections from a derived matrix', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 4 }),
        row('comments', 2, 'richtext', 'Comments?', { answerHtml: '<p>Great <strong>work</strong>.</p>' }),
      ]),
      reviewer('r2', 'Dr. B', [
        row('impact', 1, 'picklist', 'Impact?', { answerText: 'Medium', answerValue: 2 }),
        // r2 has no row for 'comments' — not-asked.
      ]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);

    const report = composeReviewReport({
      requestNumber: '2026-001',
      requestTitle: 'A Great Proposal',
      piName: 'Dr. Lead',
      institution: 'Acme University',
      matrix,
      generatedAtIso: '2026-07-03T12:00:00.000Z',
    });

    expect(report.header).toEqual({
      requestNumber: '2026-001',
      requestTitle: 'A Great Proposal',
      piName: 'Dr. Lead',
      institution: 'Acme University',
      generatedAtIso: '2026-07-03T12:00:00.000Z',
      reviewerCount: 2,
    });

    expect(report.summary.reviewsSubmitted).toBe(2);
    expect(report.reviewers).toEqual([
      { suggestionId: 'r1', name: 'Dr. A', affiliation: null },
      { suggestionId: 'r2', name: 'Dr. B', affiliation: null },
    ]);
    expect(report.summary.ratingQuestions).toHaveLength(1);
    expect(report.summary.ratingQuestions[0]).toMatchObject({
      key: 'impact', average: 3, min: 2, max: 4, answeredCount: 2, totalReviewers: 2,
    });

    expect(report.answerSections).toHaveLength(2);
    const impactSection = report.answerSections[0];
    expect(impactSection.type).toBe('picklist');
    expect(impactSection.answers.find((a) => a.suggestionId === 'r1').label).toBe('High');
    expect(impactSection.answers.find((a) => a.suggestionId === 'r2').label).toBe('Medium');

    const section = report.answerSections[1];
    expect(section.key).toBe('comments');
    expect(section.type).toBe('richtext');
    const r1Answer = section.answers.find((a) => a.suggestionId === 'r1');
    expect(r1Answer.state).toBe('answered');
    expect(r1Answer.blocks[0].runs.some((r) => r.text === 'work' && r.bold)).toBe(true);
    const r2Answer = section.answers.find((a) => a.suggestionId === 'r2');
    expect(r2Answer.state).toBe('not-asked');
    expect(r2Answer.blocks).toEqual([]);
  });

  test('carries the "Prior cycle" (retired) flag through to summary rows and answerSections', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('oldRating', 5, 'picklist', 'Old rating?', { answerText: 'High', answerValue: 3 }),
        row('oldNarrative', 6, 'richtext', 'Old narrative?', { answerHtml: '<p>legacy</p>' }),
      ]),
    ];
    // liveQuestions known, but neither key is in it → both retired.
    const matrix = deriveReviewMatrix(reviewers, [{ key: 'somethingElse', order: 1, text: 'Live Q', type: 'picklist' }]);
    const report = composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' });

    expect(report.summary.ratingQuestions[0].retired).toBe(true);
    expect(report.answerSections.map((s2) => s2.retired)).toEqual([true, true]);
  });

  test('zero submitted reviewers composes an empty-but-valid report, never throws', () => {
    const matrix = deriveReviewMatrix([], null);
    expect(() => composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' })).not.toThrow();
    const report = composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' });
    expect(report.header.reviewerCount).toBe(0);
    expect(report.reviewers).toEqual([]);
    expect(report.summary.reviewsSubmitted).toBe(0);
    expect(report.summary.ratingQuestions).toEqual([]);
    expect(report.answerSections).toEqual([]);
  });

  test('missing/null identity fields pass through as null rather than throwing', () => {
    const matrix = deriveReviewMatrix([], null);
    const report = composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' });
    expect(report.header.requestNumber).toBeNull();
    expect(report.header.requestTitle).toBeNull();
    expect(report.header.piName).toBeNull();
    expect(report.header.institution).toBeNull();
  });

  test('includes a normalized named reviewer roster outside the anonymous synthesis', () => {
    const matrix = {
      reviewers: [
        {
          suggestionId: 'r1',
          name: ' John Hackett ',
          affiliation: ' Florida International University ',
        },
        { suggestionId: 'r2', name: '', affiliation: '' },
      ],
      questions: [],
    };
    const report = composeReviewReport({
      matrix,
      generatedAtIso: '2026-07-03T00:00:00.000Z',
      synthesis: { overall: 'A reviewer raised a concern.' },
    });

    expect(report.reviewers).toEqual([
      { suggestionId: 'r1', name: 'John Hackett', affiliation: 'Florida International University' },
      { suggestionId: 'r2', name: null, affiliation: null },
    ]);
    expect(report.synthesisSection.overall).toBe('A reviewer raised a concern.');
  });

  test('an "empty" cell (row exists, blank content) renders no label and empty blocks, distinct from not-asked', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [row('comments', 1, 'richtext', 'Comments?', { answerHtml: '' })]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    const report = composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' });
    const answer = report.answerSections[0].answers[0];
    expect(answer.state).toBe('empty');
    expect(answer.blocks).toEqual([]);
  });

  test('multiselect questions compose answer sections with tallies and unreadable markers', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerText: 'Tools; Broad interest',
          answerValues: [{ value: 1, label: 'Tools' }, { value: 3, label: 'Broad interest' }],
        }),
      ]),
      reviewer('r2', 'Dr. B', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerText: 'Unreadable answer',
          answerValuesUnreadable: true,
        }),
      ]),
    ];
    const report = composeReviewReport({
      matrix: deriveReviewMatrix(reviewers, null),
      generatedAtIso: '2026-07-03T00:00:00.000Z',
    });

    expect(report.summary.ratingQuestions).toEqual([]);
    expect(report.answerSections).toHaveLength(1);
    expect(report.answerSections[0].tallies).toEqual([
      { value: 1, label: 'Tools', count: 1, reviewers: [{ suggestionId: 'r1', name: 'Dr. A' }] },
      { value: 3, label: 'Broad interest', count: 1, reviewers: [{ suggestionId: 'r1', name: 'Dr. A' }] },
    ]);
    expect(report.answerSections[0].answers).toEqual([
      expect.objectContaining({ reviewerName: 'Dr. A', labels: ['Tools', 'Broad interest'], unreadable: false }),
      expect.objectContaining({ reviewerName: 'Dr. B', labels: [], unreadable: true }),
    ]);
  });

  test('answerSections put every question type in question order', () => {
    // Regression: the former categoricalSections/narrativeSections split made
    // renderers print every multiselect before every narrative, so a Q3
    // multiselect landed ahead of Q1/Q2 narratives in the export.
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('priorArt', 1, 'richtext', 'Q1 Prior art?', { answerHtml: '<p>a</p>' }),
        row('impacts', 2, 'richtext', 'Q2 Impacts?', { answerHtml: '<p>b</p>' }),
        row('impactAreas', 3, 'multiselect', 'Q3 Impact areas?', {
          answerText: 'Tools',
          answerValues: [{ value: 1, label: 'Tools' }],
        }),
        row('risk', 4, 'picklist', 'Q4 Risk?', { answerText: 'Low', answerValue: 1 }),
      ]),
    ];
    const report = composeReviewReport({
      matrix: deriveReviewMatrix(reviewers, null),
      generatedAtIso: '2026-07-03T00:00:00.000Z',
    });
    expect(report.answerSections.map((s) => [s.key, s.type])).toEqual([
      ['priorArt', 'richtext'],
      ['impacts', 'richtext'],
      ['impactAreas', 'multiselect'],
      ['risk', 'picklist'],
    ]);
  });

  test('a malformed/unsanitized-looking answerHtml on an answered cell does not throw during composition', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [row('comments', 1, 'richtext', 'Comments?', { answerHtml: '<p>unterminated <strong>bold' })]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    expect(() => composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' })).not.toThrow();
  });

  // Phase 4 (AI synthesis) — additive, optional section.
  test('omitting synthesis (default) leaves synthesisSection null', () => {
    const matrix = deriveReviewMatrix([], null);
    const report = composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z' });
    expect(report.synthesisSection).toBeNull();
  });

  test('passing synthesis produces a normalized synthesisSection', () => {
    const matrix = deriveReviewMatrix([], null);
    const synthesis = {
      consensus: ['Strong methodology'],
      disagreements: ['Impact rating split'],
      keyConcerns: ['Budget seems high'],
      ratingSummaries: [{ questionKey: 'impact', questionText: 'Rate impact', summary: 'Mostly high scores' }],
      overall: 'Reviewers are largely positive.',
    };
    const report = composeReviewReport({ matrix, generatedAtIso: '2026-07-03T00:00:00.000Z', synthesis });
    expect(report.synthesisSection).toEqual(synthesis);
  });

  test('carries explicit stale currentness so renderers can distinguish the current roster', () => {
    const matrix = deriveReviewMatrix([], null);
    const report = composeReviewReport({
      matrix,
      generatedAtIso: '2026-07-03T00:00:00.000Z',
      synthesis: { overall: 'Earlier synthesis.' },
      synthesisCurrent: false,
    });
    expect(report.synthesisSection).toEqual({
      consensus: [],
      disagreements: [],
      keyConcerns: [],
      ratingSummaries: [],
      overall: 'Earlier synthesis.',
      current: false,
    });
  });

  test('a malformed synthesis (non-array fields, missing overall) is normalized rather than thrown', () => {
    const matrix = deriveReviewMatrix([], null);
    const report = composeReviewReport({
      matrix,
      generatedAtIso: '2026-07-03T00:00:00.000Z',
      synthesis: { consensus: 'not an array', overall: 42 },
    });
    expect(report.synthesisSection).toEqual({
      consensus: [], disagreements: [], keyConcerns: [], ratingSummaries: [], overall: '',
    });
  });
});
