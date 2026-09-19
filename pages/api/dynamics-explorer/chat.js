/**
 * API Route: /api/dynamics-explorer/chat
 *
 * Agentic chat endpoint for the Dynamics Explorer.
 * Runs a server-side tool-use loop: user question → Claude tool calls
 * → Dynamics API execution → Claude response → SSE stream to client.
 *
 * Data boundary: role-gated, org-wide CRM exploration. The caller's access
 * is shaped by `dynamics_user_roles` (read_only / read_write / superuser)
 * plus org-wide table/field rules in `dynamics_restrictions`, loaded into
 * `withDynamicsContext` here and enforced inside every tool by
 * `DynamicsService.checkRestriction`. Within those rules the user sees
 * Dynamics data org-wide — not user-scoped — because CRM records belong
 * to the foundation, not to individual staff. Tightening to per-user
 * visibility (e.g., PD-only) is the job of Dataverse security roles, not
 * this layer.
 *
 * Architecture: Search-first discovery with server-side relationship traversal.
 * 11 tools: search, get_entity, get_related, describe_table, query_records,
 * count_records, aggregate, find_reports_due, list_documents, search_documents, export_csv.
 */

import crypto from 'crypto';
import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { withDynamicsContext } from '../../../lib/services/dynamics-context';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import {
  DynamicsExplorerRequestTelemetry,
  normalizeSessionId,
} from '../../../lib/services/dynamics-explorer-request-telemetry';
import { describeChatFailure } from '../../../lib/services/dynamics-explorer/failure-copy';
import { getUserRole, getActiveRestrictions } from '../../../lib/services/dynamics-explorer/explorer-store';
import { runExplorerChat } from '../../../lib/services/dynamics-explorer/chat-session';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 300,
};

const limiter = nextRateLimiter({ max: 10 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const access = await requireAppAccess(req, res, 'dynamics-explorer');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    if (res.writableEnded || res.destroyed) return false;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      return false;
    }
  };

  const { messages, sessionId: rawSessionId } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    sendEvent('error', { message: 'At least one message is required' });
    res.end();
    return;
  }

  const userProfileId = access.profileId;
  const sessionId = normalizeSessionId(rawSessionId);
  const requestId = crypto.randomUUID();
  const abortController = new AbortController();
  let terminalIntent = false;
  let disconnectObserved = false;
  let completedRounds = 0;
  let lastModel = null;
  let lastStopReason = null;
  let errorStage = 'context';

  const finalizeLifecycle = (outcome, overrides = {}) =>
    DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId,
      userProfileId,
      sessionId,
      outcome,
      roundsUsed: completedRounds,
      model: lastModel,
      stopReason: lastStopReason,
      errorStage: outcome === 'error' ? errorStage : null,
      ...overrides,
    });

  const handleDisconnect = () => {
    if (terminalIntent || disconnectObserved) return;
    // LOAD-BEARING ordering: the abort rejection reaches the outer catch. Set
    // the durable classification flag before aborting so that catch converges
    // on client_disconnected instead of racing an `error` finalizer.
    disconnectObserved = true;
    abortController.abort();
    void finalizeLifecycle('client_disconnected');
  };

  req.once?.('aborted', handleDisconnect);
  res.once?.('close', handleDisconnect);

  await DynamicsExplorerRequestTelemetry.startRequest({
    requestId,
    userProfileId,
    sessionId,
  });

  if (disconnectObserved) {
    req.off?.('aborted', handleDisconnect);
    res.off?.('close', handleDisconnect);
    return;
  }

  try {
    const claudeApiKey = process.env.CLAUDE_API_KEY;

    if (!claudeApiKey) {
      errorStage = 'model';
      terminalIntent = true;
      await finalizeLifecycle('error');
      sendEvent('error', {
        message: 'Claude API key not configured on server',
        requestId,
      });
      return;
    }

    await loadModelOverrides();

    const [userRole, restrictions] = await Promise.all([
      getUserRole(userProfileId),
      getActiveRestrictions(),
    ]);

    const result = await withDynamicsContext({ restrictions, requestId }, () => runExplorerChat({
      messages,
      sessionId,
      userProfileId,
      userRole,
      restrictions,
      requestId,
      apiKey: claudeApiKey,
      sendEvent,
      signal: abortController.signal,
      isDisconnected: () => disconnectObserved,
      onRoundComplete: ({ round, model, stopReason }) => {
        if (round === 0) { lastModel = model; return; }
        completedRounds = round;
        lastModel = model || lastModel;
        lastStopReason = stopReason;
      },
      onStage: (stage) => { errorStage = stage; },
      onTerminal: async ({ outcome }) => {
        terminalIntent = true;
        await finalizeLifecycle(outcome);
      },
    }));

    if (result.outcome === 'client_disconnected') {
      await finalizeLifecycle('client_disconnected');
      return;
    }
  } catch (error) {
    if (disconnectObserved) {
      await finalizeLifecycle('client_disconnected');
      return;
    }

    terminalIntent = true;
    await finalizeLifecycle('error');
    console.error(`Dynamics Explorer chat error [requestId=${requestId}]:`, error);
    sendEvent('error', {
      message: describeChatFailure(error),
      requestId,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    req.off?.('aborted', handleDisconnect);
    res.off?.('close', handleDisconnect);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}
