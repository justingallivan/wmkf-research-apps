/**
 * Admin display placement only. These exact keys belong to retired interfaces.
 * Do not use this list to gate execution, delete settings, or retire prompts:
 * preserved services and external backend flows can still use their contracts.
 * Unknown/new keys stay in the normal inventory for review.
 */
export const PRESERVED_MODEL_KEYS = new Set([
  'batch-phase-i', 'batch-phase-ii', 'phase-i-writeup', 'phase-ii-writeup',
  'peer-review-summarizer', 'qa', 'refine', 'grant-reporting',
]);

export const PRESERVED_PROMPT_NAMES = new Set([
  'funding-gap.analyze', 'funding-gap.extract',
  'literature-analyzer.compare', 'literature-analyzer.extract-paper', 'literature-analyzer.synthesize',
  'multi-perspective.initial-analysis', 'multi-perspective.integrator',
  'multi-perspective.neutral', 'multi-perspective.optimist',
  'multi-perspective.proposal-summary', 'multi-perspective.skeptic',
  'peer-review-summarizer.analyze', 'peer-review-summarizer.questions',
  'phase-i.checkin', 'phase-i.summary', 'phase-ii.extract-structured',
  'phase-ii.qa', 'phase-ii.refine', 'phase-ii.summarize',
]);
