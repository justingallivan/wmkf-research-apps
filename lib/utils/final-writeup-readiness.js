/**
 * Runtime interlock for additive Final Writeup transition fields (Wave 22).
 *
 * Only literal `on` permits code to select or write the new Dataverse fields.
 * Unset and every other value fail closed so code can deploy before metadata.
 */

export const FINAL_WRITEUP_SCHEMA_READY_FLAG = 'FINAL_WRITEUP_SCHEMA_READY';

export function isFinalWriteupSchemaReady(env = process.env) {
  return env?.[FINAL_WRITEUP_SCHEMA_READY_FLAG] === 'on';
}
