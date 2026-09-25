/**
 * Server-only Request Document explicit-actor resolution and observability.
 *
 * Actor identity comes only from the authenticated session value supplied by
 * the route/service. This service freshly rereads the exact Dataverse
 * systemuser before any lookup bind is added. It never accepts a client name,
 * timestamp, or actor override.
 */

import * as systemUserAdapter from '../dataverse/adapters/system-user.js';
import { isGuid } from '../utils/guid.js';
import {
  isRequestDocumentExplicitActorSchemaReady,
} from '../utils/request-document-explicit-actor-readiness.js';
import OperationalEventService from './operational-event-service.js';
import { ServiceHttpError } from './service-http-error.js';

export const REQUEST_DOCUMENT_ACTOR_POLICY = Object.freeze({
  REQUIRED: 'required',
  ALLOW_UNATTRIBUTED: 'allow-unattributed',
  // Applicant-side writes (materials contributor link): no staff actor exists,
  // so nothing is resolved or bound and no missing-actor event is recorded.
  EXTERNAL_CONTRIBUTOR: 'external-contributor',
  // Test Request Factory sandbox rehearsal writes (lib/services/test-requests/
  // ia-sandbox-deps.js createDocument, called from run-runner.js's
  // seed_initial_assessment step): there is deliberately no staff actor (the
  // sandbox path never passes actingUserSystemId), and unlike
  // ALLOW_UNATTRIBUTED this is expected on every single write, not an
  // exceptional case worth a missing-actor operational event. Excluded from
  // isActorNotCaptured the same way EXTERNAL_CONTRIBUTOR is, so a sandbox
  // create never triggers recordRequestDocumentActorNotCaptured (which would
  // otherwise read the module-level, production-bound findByGenerationKey on
  // a lost-response retry, and write into the shared operational_events
  // table on every rehearsal run).
  SANDBOX_REHEARSAL: 'sandbox-rehearsal',
});

const POLICIES = new Set(Object.values(REQUEST_DOCUMENT_ACTOR_POLICY));

const DEFAULT_DEPENDENCIES = Object.freeze({
  getSystemUser: systemUserAdapter.getById,
  schemaReady: isRequestDocumentExplicitActorSchemaReady,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  now: () => new Date(),
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function actorUnavailableError() {
  return new ServiceHttpError(
    'Your Dataverse staff identity could not be verified. Ask an administrator to reconcile your identity, then retry.',
    {
      httpStatus: 403,
      code: 'request_document_actor_unavailable',
      body: {
        error: 'Your Dataverse staff identity could not be verified. Ask an administrator to reconcile your identity, then retry.',
        code: 'request_document_actor_unavailable',
      },
    },
  );
}

async function readEnabledActor(actingUserSystemId, dependencies) {
  if (!isGuid(actingUserSystemId)) return { actorId: null, reason: 'missing' };
  let user;
  try {
    user = await dependencies.getSystemUser(actingUserSystemId);
  } catch (error) {
    if (error?.status === 404) return { actorId: null, reason: 'stale' };
    throw error;
  }
  if (!user || !sameId(user.systemuserid, actingUserSystemId)) {
    return { actorId: null, reason: 'stale' };
  }
  if (user.isdisabled !== false) return { actorId: null, reason: 'disabled' };
  return { actorId: user.systemuserid, reason: null };
}

export async function resolveRequestDocumentActor(
  { actingUserSystemId = null, policy },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.schemaReady()) {
    return { schemaReady: false, actorId: null, reason: 'schema-not-ready' };
  }
  if (!POLICIES.has(policy)) {
    throw new ServiceHttpError('Request Document actor policy is not configured.', {
      httpStatus: 500,
      code: 'request_document_actor_policy_missing',
    });
  }
  if (policy === REQUEST_DOCUMENT_ACTOR_POLICY.EXTERNAL_CONTRIBUTOR) {
    return { schemaReady: true, actorId: null, reason: 'external-contributor' };
  }
  if (policy === REQUEST_DOCUMENT_ACTOR_POLICY.SANDBOX_REHEARSAL) {
    // No staff actor is ever resolved for a sandbox rehearsal write -- never
    // reads getSystemUser, even if a caller mistakenly supplied
    // actingUserSystemId (which the sandbox path must never do).
    return { schemaReady: true, actorId: null, reason: 'sandbox-rehearsal' };
  }
  const resolution = await readEnabledActor(actingUserSystemId, dependencies);
  if (!resolution.actorId && policy === REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED) {
    throw actorUnavailableError();
  }
  return { schemaReady: true, ...resolution };
}

/** True when a create completed without the staff actor its policy expected. */
export function isActorNotCaptured(resolution) {
  return Boolean(
    resolution?.schemaReady
    && !resolution.actorId
    && resolution.reason !== 'external-contributor'
    && resolution.reason !== 'sandbox-rehearsal',
  );
}

function requestIdFromPayload(payload) {
  const match = String(payload?.['wmkf_Request@odata.bind'] || '')
    .match(/^\/akoya_requests\(([0-9a-f-]{36})\)$/i);
  return match?.[1]?.toLowerCase() || null;
}

export async function recordRequestDocumentActorNotCaptured(
  { payload = {}, created = null, context = {}, reason = 'missing' },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const requestDocumentId = created?.wmkf_requestdocumentid || context.requestDocumentId || null;
  const requestId = context.requestId || requestIdFromPayload(payload);
  const generationKey = payload.wmkf_generationkey || context.generationKey || null;
  const operationId = context.operationId || generationKey || requestDocumentId || requestId;
  return dependencies.recordEvent({
    eventType: 'request_document_actor_not_captured',
    severity: 'warning',
    summary: 'A Request Document business action completed without a verified staff actor.',
    subsystem: 'request-document',
    stage: context.operation || 'create',
    transient: false,
    requestNumber: context.requestNumber || null,
    entityRefs: {
      requestId,
      requestDocumentId,
      generationKey,
    },
    correlationId: operationId,
    dedupeKey: `request-document-actor-not-captured:${operationId || 'unknown'}`,
    metadata: {
      reason,
      producer: payload.wmkf_producer || context.producer || null,
      operation: context.operation || 'create',
    },
  });
}

export function explicitActorCreateFields(actorId, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(actorId)) return {};
  return {
    'wmkf_InitiatedBy@odata.bind': `/systemusers(${actorId})`,
    wmkf_initiatedat: dependencies.now().toISOString(),
  };
}

export const _internal = {
  actorUnavailableError,
  readEnabledActor,
  requestIdFromPayload,
};
