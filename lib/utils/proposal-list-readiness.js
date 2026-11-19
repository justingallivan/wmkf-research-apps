/**
 * Runtime interlock for proposal list links
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * Only exact `on` enables link creation, the staff route, and the external
 * proposal list routes. Unset and invalid values fail closed, so a deployment
 * whose Postgres has not applied migration 101 behaves exactly as before. The
 * owner sets the flag after applying the migration; agents never set it.
 */

export const PROPOSAL_LIST_SCHEMA_READY_FLAG = 'PROPOSAL_LIST_SCHEMA_READY';

export function isProposalListSchemaReady(env = process.env) {
  return env?.[PROPOSAL_LIST_SCHEMA_READY_FLAG] === 'on';
}
