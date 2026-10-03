export const MATERIALS_BACKGROUND_SCHEMA_READY_FLAG = 'SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY';
export const MATERIALS_BACKGROUND_ADMISSION_ENABLED_FLAG = 'SITE_VISIT_MATERIALS_BACKGROUND_ADMISSION_ENABLED';

export function isMaterialsBackgroundSchemaReady(env = process.env) {
  return env?.[MATERIALS_BACKGROUND_SCHEMA_READY_FLAG] === 'on';
}

export function isMaterialsBackgroundAdmissionEnabled(env = process.env) {
  return isMaterialsBackgroundSchemaReady(env)
    && env?.[MATERIALS_BACKGROUND_ADMISSION_ENABLED_FLAG] === 'on';
}
