/**
 * API Route: /api/admin/operational-events
 *
 * GET — Recent durable operational events (app-recorded + Vercel drain)
 *   Query: ?status=&severity=&source=&eventType=&search=&hours=168&limit=100
 *   (hours max 2160 = 90 days; limit max 500 — bounds enforced in the service)
 *
 * PATCH — Staff resolution
 *   Body: { id, action: 'resolve' | 'reopen', note?,
 *           expectedStatus, expectedLastOccurredAt, expectedStatusChangedAt }
 *   or    { action, events: [{ id, expectedStatus, expectedLastOccurredAt,
 *           expectedStatusChangedAt }], note? }   (≤500, "Resolve all shown")
 *   The freshness triple is REQUIRED on every mutation (400 when absent): a
 *   status write is only ever applied against the row state the client saw.
 *
 * Superuser only.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import OperationalEventService from '../../../lib/services/operational-event-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    try {
      const { status, severity, source, eventType, search, hours, limit } = req.query;
      const [events, summary] = await Promise.all([
        OperationalEventService.queryEvents({
          status, severity, source, eventType, search, hours, limit,
        }),
        OperationalEventService.getEventSummary({ hours }),
      ]);
      return res.json({ events, summary });
    } catch (error) {
      console.error('Admin operational-events GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch operational events' });
    }
  }

  try {
    const { id, action, note, expectedStatus, expectedLastOccurredAt, expectedStatusChangedAt, events } = req.body || {};

    // Bulk form ("Resolve all shown"): every row carries its own freshness
    // precondition; per-row outcomes come back as counts and the client
    // refetches. A stale row is skipped, never blind-closed.
    if (Array.isArray(events)) {
      const outcome = await OperationalEventService.setEventStatuses(events, action, {
        profileId: gate.profileId,
        note: note || null,
      });
      return res.json({
        ok: true,
        action,
        requested: events.length,
        updated: outcome.updated.length,
        stale: outcome.stale.length,
        notFound: outcome.notFound.length,
        invalid: outcome.invalid.length,
      });
    }

    // Fail loud rather than blind-write: a payload without the full freshness
    // triple (a pre-deployment admin bundle, or a hand-built call) could close
    // an open→resolved→open row whose recurrence it never saw. Version skew is
    // a 400 the operator sees, not a silent unguarded update.
    if (typeof expectedStatus !== 'string' || expectedLastOccurredAt == null
        || !Object.prototype.hasOwnProperty.call(req.body || {}, 'expectedStatusChangedAt')) {
      return res.status(400).json({
        error: 'expectedStatus, expectedLastOccurredAt and expectedStatusChangedAt are required — reload the admin page and retry',
      });
    }

    const updated = await OperationalEventService.setEventStatus(id, action, {
      profileId: gate.profileId,
      note: note || null,
      expectedStatus,
      expectedLastOccurredAt,
      expectedStatusChangedAt,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Event not found or not resolvable' });
    }
    return res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (error) {
    if (error?.code === 'invalid_id' || error?.code === 'invalid_action' || error?.code === 'batch_too_large') {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === 'stale_state') {
      // The row folded a new occurrence or changed status since it was
      // rendered — refuse the blind write so a stale list can't close a
      // newly recurrent incident (Codex adversarial finding, cycle 3).
      return res.status(409).json({ error: 'Event changed since it was loaded', current: error.current });
    }
    console.error('Admin operational-events PATCH error:', error);
    return res.status(500).json({ error: 'Failed to update operational event' });
  }
}
