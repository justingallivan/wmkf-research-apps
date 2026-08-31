/**
 * Literal-on readiness boundary for Wave 24 Request Document explicit actors.
 *
 * CommonJS is intentional: the runtime health checker is CommonJS while the
 * Dataverse services are transpiled ESM. Both consume this one implementation.
 */

const REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG =
  'REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY';

function isRequestDocumentExplicitActorSchemaReady(env = process.env) {
  return env?.[REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG] === 'on';
}

function requestDocumentExplicitActorReadinessHealth(env = process.env) {
  const production = env?.VERCEL_ENV === 'production';
  if (!production) {
    return {
      status: 'skipped',
      detail: 'Wave 24 readiness is enforced as a health error only in Vercel Production.',
    };
  }
  return isRequestDocumentExplicitActorSchemaReady(env)
    ? { status: 'ok', detail: 'Wave 24 Request Document explicit actors are enabled.' }
    : {
      status: 'error',
      message: `${REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG} must be literal on in Production.`,
    };
}

module.exports = {
  REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG,
  isRequestDocumentExplicitActorSchemaReady,
  requestDocumentExplicitActorReadinessHealth,
};
