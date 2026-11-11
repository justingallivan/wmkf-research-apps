/** Rehearsal-only owner-approved identity/eligibility contract. The legacy prompt
 * remains byte-identical for old code. No expertise or scoring rule changes.
 */
import { EXPERTISE_FINDER_MATCH_ROW, buildExpertiseMatchVariables } from './expertise-finder-dynamics.js';
export const ROSTER_V2_CAPABILITY='expertise-roster-guid-eligibility-v2';
const instructions=`\nContract: ${ROSTER_V2_CAPABILITY}\nOnly profiles in eligible_lead_guids may be primary or secondary PD recommendations. Other active staff remain available in staff_consultation. Return null for either PD slot when no eligible suitable candidate exists; when eligible_lead_guids is empty both slots MUST be null. Return canonical profile_guid values from this run's roster for every person; never return a name as identity. Unknown identities are forbidden. Return staff_consultation as an array of {profile_guid, rationale}; it may be empty.\n`;
export const EXPERTISE_FINDER_ROSTER_V2_ROW={
 ...EXPERTISE_FINDER_MATCH_ROW,
 promptName:'expertise-finder.match.roster-v2',
 systemPrompt:EXPERTISE_FINDER_MATCH_ROW.systemPrompt
  .replace('from the Research Program Staff.','from the explicitly eligible lead candidates.')
  .replace('The secondary PD is the next-best staff member to consult if the primary has a conflict or capacity issue.','The secondary PD must also be an eligible lead candidate. Other active staff may be recommended separately for consultation.')
  .replace(/"name": "[^"]*"/g,'"profile_guid": "canonical GUID from the roster"')
  .replace('## ROSTER',instructions+'\n## ROSTER'),
 notes:'Owner-approved November 10 minimal GUID/eligibility contract. Sandbox rehearsal only; separate row from legacy expertise-finder.match.',
};
export function buildRosterV2Variables({rosterMembers,leadGuids,...input}){
 const variables=buildExpertiseMatchVariables({...input,rosterMembers});
 variables.roster_block=variables.roster_block.replace('(eligible for primary/secondary PD assignment)','(available for consultation; PD eligibility is listed separately)');
 // JSON identity catalogue is data; expertise wording/formatter remains unchanged.
 variables.roster_block+='\nIdentity catalogue (data):\n'+JSON.stringify(rosterMembers.map(r=>({profile_guid:r.profile_guid,name:r.name,category:r.role_type})))+'\neligible_lead_guids (data):\n'+JSON.stringify(leadGuids);
 return variables;
}

export const TOOL_PROMPT_ROWS=[EXPERTISE_FINDER_ROSTER_V2_ROW];
