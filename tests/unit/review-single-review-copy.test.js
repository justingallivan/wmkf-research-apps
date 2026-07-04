/**
 * composeSingleReviewCopy — pure composer for the thank-you courtesy DOCX copy
 * of a single reviewer's own review. Picklist + richtext answers, htmlToBlocks
 * reuse, deterministic output.
 */

const { composeSingleReviewCopy, htmlToBlocks } = require('../../shared/utils/review-report');

const GEN = '2026-07-04T12:00:00.000Z';

function answer(over = {}) {
  return {
    questionKey: 'q1',
    questionOrder: 1,
    questionText: 'Overall rating',
    questionType: 'picklist',
    answerHtml: '',
    answerText: 'Excellent',
    answerValue: 5,
    ...over,
  };
}

describe('composeSingleReviewCopy', () => {
  test('header carries reviewer + request identity', () => {
    const copy = composeSingleReviewCopy({
      reviewerName: 'Dr. Reviewer',
      requestNumber: 'R-1',
      requestTitle: 'A Proposal',
      generatedAtIso: GEN,
      answers: [],
    });
    expect(copy.header).toEqual({
      reviewerName: 'Dr. Reviewer',
      requestNumber: 'R-1',
      requestTitle: 'A Proposal',
      generatedAtIso: GEN,
    });
    expect(copy.sections).toEqual([]);
  });

  test('picklist answer → answerLabel (answerText wins), no blocks', () => {
    const copy = composeSingleReviewCopy({ generatedAtIso: GEN, answers: [answer()] });
    expect(copy.sections).toHaveLength(1);
    const s = copy.sections[0];
    expect(s.questionType).toBe('picklist');
    expect(s.state).toBe('answered');
    expect(s.answerLabel).toBe('Excellent');
    expect(s.blocks).toEqual([]);
  });

  test('picklist with no answerText falls back to stringified answerValue', () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GEN,
      answers: [answer({ answerText: '', answerValue: 4 })],
    });
    expect(copy.sections[0].answerLabel).toBe('4');
    expect(copy.sections[0].state).toBe('answered');
  });

  test('picklist with neither text nor numeric value → empty', () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GEN,
      answers: [answer({ answerText: '', answerValue: null })],
    });
    expect(copy.sections[0].state).toBe('empty');
    expect(copy.sections[0].answerLabel).toBeNull();
  });

  test('richtext answer → blocks from htmlToBlocks, answerLabel null', () => {
    const html = '<p>Strong <strong>methods</strong>.</p><ul><li>clear aim</li></ul>';
    const copy = composeSingleReviewCopy({
      generatedAtIso: GEN,
      answers: [answer({ questionType: 'richtext', answerHtml: html, answerText: '', answerValue: null })],
    });
    const s = copy.sections[0];
    expect(s.questionType).toBe('richtext');
    expect(s.answerLabel).toBeNull();
    expect(s.state).toBe('answered');
    // Reuses the shared tokenizer verbatim — byte-identical to a direct call.
    expect(s.blocks).toEqual(htmlToBlocks(html));
    expect(s.blocks[0].type).toBe('paragraph');
    expect(s.blocks.some((b) => b.type === 'list-item')).toBe(true);
  });

  test('richtext with empty HTML → empty state, no blocks', () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GEN,
      answers: [answer({ questionType: 'richtext', answerHtml: '', answerText: '', answerValue: null })],
    });
    expect(copy.sections[0].state).toBe('empty');
    expect(copy.sections[0].blocks).toEqual([]);
  });

  test('deterministic: same input → deep-equal output (pure, no Date.now)', () => {
    const answers = [answer(), answer({ questionKey: 'q2', questionOrder: 2, questionType: 'richtext', answerHtml: '<p>Good</p>', answerText: '', answerValue: null })];
    const a = composeSingleReviewCopy({ reviewerName: 'X', generatedAtIso: GEN, answers });
    const b = composeSingleReviewCopy({ reviewerName: 'X', generatedAtIso: GEN, answers });
    expect(a).toEqual(b);
  });

  test('non-array answers → empty sections (never throws)', () => {
    const copy = composeSingleReviewCopy({ generatedAtIso: GEN, answers: null });
    expect(copy.sections).toEqual([]);
  });
});
