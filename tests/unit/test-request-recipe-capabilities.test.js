/** @jest-environment node */
import {
  LEDGER_RECIPES, recipeSeedsReviewers, recipeSeedsPreSite, recipeSeedsFinalWriteup,
} from '../../lib/services/test-requests/recipe-capabilities.js';

describe('LEDGER_RECIPES (slice 4a)', () => {
  test('is the six cumulative recipe tokens, in order', () => {
    expect(LEDGER_RECIPES).toEqual([
      'basic', 'initial_assessment', 'reviews', 'pre_site_visit', 'final_writeup', 'site_visit_materials',
    ]);
  });
});

// Table-driven: every consumer (or the predicate itself, standing in for
// each converted call site) run for every recipe, per the plan's static-test
// requirement.
describe('recipeSeedsReviewers', () => {
  test.each([
    ['basic', false],
    ['initial_assessment', false],
    ['reviews', true],
    ['pre_site_visit', true],
    ['final_writeup', true],
    ['site_visit_materials', true],
  ])('%s -> %s', (recipe, expected) => {
    expect(recipeSeedsReviewers(recipe)).toBe(expected);
  });

  test('throws (fails closed) on an unrecognized recipe', () => {
    expect(() => recipeSeedsReviewers('bogus')).toThrow(/Unknown Test Request Factory recipe/);
    expect(() => recipeSeedsReviewers(undefined)).toThrow(/Unknown Test Request Factory recipe/);
  });
});

describe('recipeSeedsPreSite', () => {
  test.each([
    ['basic', false],
    ['initial_assessment', false],
    ['reviews', false],
    ['pre_site_visit', true],
    ['final_writeup', true],
    ['site_visit_materials', true],
  ])('%s -> %s', (recipe, expected) => {
    expect(recipeSeedsPreSite(recipe)).toBe(expected);
  });

  test('throws (fails closed) on an unrecognized recipe', () => {
    expect(() => recipeSeedsPreSite('bogus')).toThrow(/Unknown Test Request Factory recipe/);
  });
});

describe('recipeSeedsFinalWriteup (slice 5a)', () => {
  test.each([
    ['basic', false],
    ['initial_assessment', false],
    ['reviews', false],
    ['pre_site_visit', false],
    ['final_writeup', true],
    ['site_visit_materials', true],
  ])('%s -> %s', (recipe, expected) => {
    expect(recipeSeedsFinalWriteup(recipe)).toBe(expected);
  });

  test('throws (fails closed) on an unrecognized recipe', () => {
    expect(() => recipeSeedsFinalWriteup('bogus')).toThrow(/Unknown Test Request Factory recipe/);
  });
});
