/**
 * Runtime interlock for Wave 20 guarded-reopen columns.
 *
 * The adapter must not select those columns until the target environment has
 * passed the exact metadata preflight. Only the literal `on` enables them;
 * unset and invalid values fail closed.
 */

export const GUARDED_REOPEN_SCHEMA_READY_FLAG = 'GUARDED_REOPEN_SCHEMA_READY';

export function isGuardedReopenSchemaReady(env = process.env) {
  return env?.[GUARDED_REOPEN_SCHEMA_READY_FLAG] === 'on';
}
