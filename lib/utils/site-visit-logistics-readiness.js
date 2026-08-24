/**
 * Runtime interlock for Wave 21 Site Visit logistics columns.
 *
 * Only exact `on` enables reads or writes of the additive fields. Unset and
 * invalid values fail closed while leaving the legacy custom Activity readable.
 */

export const SITE_VISIT_LOGISTICS_SCHEMA_READY_FLAG = 'SITE_VISIT_LOGISTICS_SCHEMA_READY';

export function isSiteVisitLogisticsSchemaReady(env = process.env) {
  return env?.[SITE_VISIT_LOGISTICS_SCHEMA_READY_FLAG] === 'on';
}
