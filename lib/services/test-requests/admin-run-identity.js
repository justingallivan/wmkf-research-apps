/**
 * Server-derived identities for the admin Test Request Factory form
 * (docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md, 2f).
 *
 * The actor and every run GUID are derived (UUIDv5) from the session profile
 * and the browser's idempotency key, never taken from request input, so a lost
 * response and its retry compute identical ids and `reserveRun` finds the
 * stored row. Pure; no I/O.
 */

import { v5 as uuidv5 } from 'uuid';
import { classifyDeployment } from '../../dataverse/core/interlock.js';
import { idempotencyKeyDigest } from './run-ledger.js';

/** Never change: every derived actor and run id depends on it. */
export const FACTORY_ID_NAMESPACE = '717824eb-02d6-4f1e-8c95-891f6ffad959';

const SEPARATOR = '\u001f'; // cannot appear in a ledger-grammar key (printable ASCII)

export function deriveActorId(profileId) {
  if (typeof profileId !== 'number' || !Number.isInteger(profileId) || profileId <= 0) {
    throw new TypeError('A positive integer profile id is required.');
  }
  return `admin:${uuidv5(`profile:${String(profileId)}`, FACTORY_ID_NAMESPACE)}`;
}

export function deriveRunIds(actorId, idempotencyKey) {
  idempotencyKeyDigest(idempotencyKey); // ledger grammar, throws on a bad key
  const derive = (label) => uuidv5(`${actorId}${SEPARATOR}${idempotencyKey}${SEPARATOR}${label}`, FACTORY_ID_NAMESPACE);
  return { runId: derive('run'), requestId: derive('request'), locationId: derive('location') };
}

/** The deployment alone picks the target: only Production addresses the production host. */
export function targetFromDeployment(deployment = classifyDeployment()) {
  if (deployment === 'production') return 'production';
  if (deployment === 'preview' || deployment === 'test' || deployment === 'local') return 'sandbox';
  throw new Error(`Unrecognized deployment "${deployment}"; refusing to pick a Factory target.`);
}
