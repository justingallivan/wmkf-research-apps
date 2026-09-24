/**
 * Test Request Factory slice 6b, Stage B, item C — synthetic Initial
 * Assessment fixture.
 *
 * The `seed_initial_assessment` step (run-runner.js) must produce a governed
 * Initial Assessment DOCX without ever calling the real paid provider
 * (docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md, Slice 6b). This
 * fixture supplies a fixed, contract-shaped `generated` object plus a
 * stand-in "AI proposal narrative" so `buildInitialAssessmentIdentity`
 * (lib/services/initial-assessment/artifact-model.js) computes an identity
 * exactly the way the producer does over the destination request's own
 * number/title/institution/cycle — the ledger only ever sees the resulting
 * digest (`contentHash`/`generationKey`), never this text.
 */

import { INITIAL_ASSESSMENT_REQUIRED_OUTPUTS } from '../../../../shared/config/prompts/initial-assessment.js';

/**
 * A fixed stand-in narrative long enough to pass the producer's own
 * `proposal.text.trim().length < 60` guard
 * (lib/services/initial-assessment/artifact-service.js).
 */
export const SYNTHETIC_PROPOSAL_TEXT =
  'TEST REQUEST FACTORY SYNTHETIC PROPOSAL NARRATIVE — fixed rehearsal text, '
  + 'never sent to a real AI provider, used only to compute a stable identity.';

export const SYNTHETIC_PROPOSAL_FILENAME = 'ProposalNarrative_SYNTHETIC.pdf';

/**
 * Contract-shaped generated output (INITIAL_ASSESSMENT_REQUIRED_OUTPUTS:
 * summary, significance_impact, research_plan, team_expertise), each a
 * fixed, clearly-synthetic string satisfying `validateGenerated`'s
 * non-empty-string requirement.
 */
export const SYNTHETIC_GENERATED = Object.freeze(
  Object.fromEntries(
    INITIAL_ASSESSMENT_REQUIRED_OUTPUTS.map((key) => [
      key,
      `[TEST REQUEST FACTORY SYNTHETIC ${key.toUpperCase()}] Fixed rehearsal content — not AI-generated.`,
    ]),
  ),
);
