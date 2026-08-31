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
  const resolution = await readEnabledActor(actingUserSystemId, dependencies);
  if (!resolution.actorId && policy === REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED) {
    throw actorUnavailableError();
  }
  return { schemaReady: true, ...resolution };
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
