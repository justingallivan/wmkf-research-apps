/**
 * Test Request Factory recipe capability predicates (slice 4a, Recipes 3-5
 * plan section "Recipe composition (canonical, stated once)").
 *
 * Recipes are cumulative: `pre_site_visit` = `reviews` + recipe-4 steps;
 * `final_writeup` = `pre_site_visit` + recipe-5 steps; `site_visit_materials`
 * = `final_writeup` + recipe-3 steps. Every existing `recipe === 'reviews'`
 * (or `!== 'reviews'`) comparison across the Factory is a REVIEWER-CAPABILITY
 * check, not a recipe-name check, and must go through `recipeSeedsReviewers`
 * instead: true for `reviews` and every later (cumulative) recipe, false for
 * `basic`/`initial_assessment`. `recipeSeedsPreSite` is the same shape for the
 * Pre-Site section, true starting at `pre_site_visit`.
 *
 * This module is pure (no pg, no ServiceHttpError) so it can be imported from
 * `source-bundle.js` (a pure schema module) as well as `run-ledger.js` and
 * `run-runner.js`. `LEDGER_RECIPES` lives here (not in run-ledger.js) so the
 * static "no recipe-name comparison outside the predicate" guard test has a
 * single, obvious file to exempt; `run-ledger.js` re-exports it unchanged so
 * existing imports (`import { LEDGER_RECIPES } from './run-ledger.js'`) keep
 * working.
 *
 * Both predicates FAIL CLOSED (throw) on an unrecognized recipe -- never
 * silently treat an unknown value as "no capability".
 */

/** Finite recipe tokens, in cumulative order; the SQL CHECK in migration 054 lists the same values. */
export const LEDGER_RECIPES = Object.freeze([
  'basic', 'initial_assessment', 'reviews', 'pre_site_visit', 'final_writeup', 'site_visit_materials',
]);

const RANK = new Map(LEDGER_RECIPES.map((recipe, index) => [recipe, index]));

function rankOrThrow(recipe) {
  const rank = RANK.get(recipe);
  if (rank === undefined) throw new Error(`Unknown Test Request Factory recipe: ${recipe}.`);
  return rank;
}

/** True for `reviews` and every later cumulative recipe; throws on an unrecognized recipe. */
export function recipeSeedsReviewers(recipe) {
  return rankOrThrow(recipe) >= RANK.get('reviews');
}

/** True for `pre_site_visit` and every later cumulative recipe; throws on an unrecognized recipe. */
export function recipeSeedsPreSite(recipe) {
  return rankOrThrow(recipe) >= RANK.get('pre_site_visit');
}
