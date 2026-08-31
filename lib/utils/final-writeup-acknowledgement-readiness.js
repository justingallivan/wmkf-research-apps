/**
 * Runtime interlock for the Wave 23 Final Writeup acknowledgement entity.
 *
 * This flag is intentionally separate from FINAL_WRITEUP_SCHEMA_READY, which
 * governs the already-live Wave 22 transition fields. Operators may set this
 * flag to literal `on` only after the target's hardened Wave 23 preflight
 * reports the composite alternate-key index Active. Unset and every other
 * value fail closed.
 */

export const FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY_FLAG =
  'FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY';

export function isFinalWriteupAcknowledgementSchemaReady(env = process.env) {
  return env?.[FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY_FLAG] === 'on';
}
