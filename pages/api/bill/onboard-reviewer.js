/**
 * POST /api/bill/onboard-reviewer
 *
 * Internal-only endpoint called from respond.js (Stage 2a reviewer accept)
 * after creating the honorarium akoya_request. Drives BILL vendor creation,
 * network search, invitation, and Dataverse writeback.
 *
 * Auth: HMAC-signed body (see lib/bill/internal-call-auth.js).
 * Response: always 200 on auth+validation success; outcome lives in body.status.
 *
 * Design: docs/BILL_CHUNK_6_ENDPOINT_DESIGN.md
 * Logic:  lib/bill/onboard-reviewer-service.js
 */

import { verifyInternalCall } from '../../../lib/bill/internal-call-auth';
import { onboardReviewer, validateOnboardInput } from '../../../lib/bill/onboard-reviewer-service';
import NotificationService from '../../../lib/services/notification-service';
import { withDalContext } from '../../../lib/dataverse/core/context';

export const config = {
  api: { bodyParser: false },
};

const MAX_BODY_BYTES = 32 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.BILL_INTEGRATION_SECRET;
  if (process.env.NODE_ENV !== 'development') {
    if (!secret) {
      console.error('[bill-onboard-reviewer] BILL_INTEGRATION_SECRET not configured');
      return res.status(500).json({ error: 'Integration secret not configured' });
    }
    if (secret.length < 32) {
      console.error('[bill-onboard-reviewer] BILL_INTEGRATION_SECRET too short (<32 chars)');
      return res.status(500).json({ error: 'Integration secret misconfigured' });
    }
  }

  // Read raw body for HMAC.
  let rawBody;
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES);
  } catch (err) {
    console.warn('[bill-onboard-reviewer] body read failed:', err?.message || String(err));
    return res.status(400).json({ error: 'Could not read request body' });
  }
  if (!rawBody || rawBody.length === 0) {
    return res.status(400).json({ error: 'Empty request body' });
  }

  // Verify signature (skip in dev only when no secret is set).
  if (process.env.NODE_ENV !== 'development' || secret) {
    const verifyResult = verifyInternalCall({ rawBody, headers: req.headers, secret });
    if (!verifyResult.ok) {
      console.warn('[bill-onboard-reviewer] auth rejected:', verifyResult.reason);
      return res.status(401).json({ error: 'Unauthorized', reason: verifyResult.reason });
    }
  }

  // Parse + validate body.
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  // Shared validator (same gate the in-process caller applies) — one definition,
  // no drift between the HTTP and in-process entry points.
  const validationError = validateOnboardInput(body);
  if (validationError) {
    return res.status(400).json({ error: 'Invalid body', detail: validationError });
  }

  // Drive orchestration.
  try {
    const result = await onboardReviewer(body);
    return res.status(200).json(result);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[bill-onboard-reviewer] unhandled:', msg);
    // Codex post-impl P1 #3: surface the unhandled error as an ops alert.
    // The body is validated by this point, so identifiers are safe to include.
    // Notification is best-effort; never let it convert a 500 into something
    // worse (e.g., a notification-system failure should still return 500).
    try {
      await withDalContext('notification-email', () => NotificationService.notify({
        type: 'bill_unhandled_error',
        severity: 'error',
        title: 'BILL onboarding endpoint: unhandled exception',
        message: msg,
        metadata: {
          honorariumRequestId: body.honorariumRequestId,
          reviewerContactId: body.reviewerContactId,
          phase: 'route_handler',
        },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      }));
    } catch (notifyErr) {
      console.error('[bill-onboard-reviewer] notify() failed during 500 path:', notifyErr?.message || notifyErr);
    }
    return res.status(500).json({
      ok: false,
      error: { code: 'unhandled', message: msg },
    });
  }
}

// Lifted from pages/api/webhooks/bill.js — same raw-body pattern for HMAC verify.
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      req.off('aborted', onAborted);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onData = chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        try { req.destroy(); } catch { /* noop */ }
        settle(reject, new Error(`body too large (>${maxBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => settle(resolve, Buffer.concat(chunks));
    const onError = err => settle(reject, err);
    const onClose = () => settle(reject, new Error('client disconnected before body completed'));
    const onAborted = () => settle(reject, new Error('client aborted before body completed'));

    try {
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('close', onClose);
      req.on('aborted', onAborted);
    } catch (err) {
      settle(reject, err);
    }
  });
}
