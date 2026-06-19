/**
 * Grantee deliverables — research-awardee eligibility config.
 *
 * EDITABLE — this is the single place to change which grants count as "research
 * awardees" for the Awardees list (and the optional auto-on-award cron). Program
 * NAMES can change and programs can be added/retired, so the eligibility is NOT
 * hard-wired into route logic — adjust it here.
 *
 * Keyed by `akoya_programid` GUID, not name, per the Atlas duplicate-name caution
 * (`docs/atlas/dataverse-akoya-request.md` — "Law and Legal Administration" exists
 * twice; filter by GUID). The trailing comment on each line is just a human label.
 *
 * Definition (confirmed S268 against the live J26 cycle, owner-validated = 12
 * awardees): a research awardee is `akoya_requeststatus = 'Active'` AND
 * `akoya_programid` ∈ this set AND has a PI (`wmkf_projectleader`). The PI
 * requirement excludes the standing endowment (#985674, Medical Research, no PI);
 * the program set excludes Active-with-a-PI civic grants (e.g. #1002650).
 */

// akoya_program GUIDs that count as research for this workflow.
export const GRANTEE_RESEARCH_PROGRAM_IDS = [
  '8dcab30b-958f-ee11-8179-000d3a341e8f', // Science and Engineering Research
  '94cab30b-958f-ee11-8179-000d3a341e8f', // Medical Research
];

// The akoya_requeststatus value that marks a funded/active grant (Atlas:
// Active = decided-terminal funded grant). String compare against the live field.
export const GRANTEE_AWARDED_STATUS = 'Active';
