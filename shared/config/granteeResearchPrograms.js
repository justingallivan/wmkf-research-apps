/**
 * Grantee deliverables — research-awardee eligibility config.
 *
 * Research program membership is shared with request discovery in
 * researchPrograms.js. This file retains Awardees-specific status eligibility
 * for the Awardees list and optional auto-on-award cron.
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

export { RESEARCH_PROGRAM_IDS as GRANTEE_RESEARCH_PROGRAM_IDS } from './researchPrograms.js';

// The akoya_requeststatus value that marks a funded/active grant (Atlas:
// Active = decided-terminal funded grant). String compare against the live field.
export const GRANTEE_AWARDED_STATUS = 'Active';
