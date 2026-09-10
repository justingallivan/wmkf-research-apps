/**
 * Runtime interlock for the deliberation briefing page
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2).
 *
 * Only exact `on` enables link minting, the link section in Share emails, the
 * staff link route, and the external briefing routes. Unset and invalid values
 * fail closed, so a deployment whose Postgres has not applied migration 038
 * behaves exactly as before. The owner sets the flag after applying the
 * migration; agents never set it.
 */

export const DELIBERATION_BRIEFING_SCHEMA_READY_FLAG = 'DELIBERATION_BRIEFING_SCHEMA_READY';

export function isDeliberationBriefingSchemaReady(env = process.env) {
  return env?.[DELIBERATION_BRIEFING_SCHEMA_READY_FLAG] === 'on';
}
