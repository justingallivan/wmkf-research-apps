/**
 * Literal-on readiness interlock for the applicant materials collection
 * (migration 042). Same convention as the briefing page and the tracker:
 * only the string `on` enables the routes and the contributor link.
 */
export const SITE_VISIT_MATERIALS_SCHEMA_READY_FLAG = 'SITE_VISIT_MATERIALS_SCHEMA_READY';

export function isSiteVisitMaterialsSchemaReady(env = process.env) {
  return env?.[SITE_VISIT_MATERIALS_SCHEMA_READY_FLAG] === 'on';
}
