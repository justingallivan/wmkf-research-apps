/**
 * Headless Site Visit context for the Staff Deliberations workspace (S466).
 *
 * The visible logistics editor was removed from the Workbench by owner
 * decision 2026-08-28 — scheduling is handled by others, directly on the
 * `wmkf_sitevisit` Dataverse Activity. The materials composer still needs
 * what that record provides (the scheduled visit for the .ics attachment,
 * linked materials, suggested recipients), so this hook performs the same
 * read the retired SiteVisitLogisticsPanel did and derives the same context.
 *
 * Fail-open: a load failure just yields no context — the composer renders
 * without calendar/materials/suggestions, exactly as it does for a request
 * with no scheduled visit.
 */

import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

function refKey(ref) {
  if (ref?.kind === 'staff') return `staff:${ref.profileId}`;
  if (ref?.kind === 'roster') return `roster:${ref.rosterId}`;
  if (ref?.kind === 'manual') return `manual:${ref.email}`;
  return '';
}

export default function useSiteVisitContext(requestId) {
  const [context, setContext] = useState(null);

  useEffect(() => {
    setContext(null);
    if (!requestId) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    Promise.all([
      requestEnvelope(`/api/workbench/site-visit/logistics?requestId=${encodeURIComponent(requestId)}`, {
        signal: controller.signal,
        tolerantBody: true,
      }),
      requestEnvelope('/api/workbench/site-visit/recipients', { signal: controller.signal, tolerantBody: true })
        .catch(() => ({ ok: false, data: {} })),
    ]).then(([logisticsEnvelope, directoryEnvelope]) => {
      const logisticsBody = logisticsEnvelope.data;
      const directoryBody = directoryEnvelope.data;
      if (cancelled) return;
      // A settled failure is distinct from loading (null) so consumers never
      // read a failed Site Visit fetch as "no visit scheduled". A directory
      // failure alone keeps the visit and only loses suggested recipients.
      if (!logisticsEnvelope.ok) { setContext({ unavailable: true }); return; }
      const visit = logisticsBody.siteVisit || null;
      const directory = directoryEnvelope.ok ? directoryBody : {};
      const lookup = new Map([
        ...(directory.staff || []).map((row) => [refKey(row), row]),
        ...(directory.external || []).map((row) => [refKey(row), row]),
      ]);
      const emails = (refs) => (refs || []).filter(Boolean).map((ref) => (
        ref.kind === 'manual' ? ref : lookup.get(refKey(ref))
      )).filter((row) => row?.email).map((row) => row.email);
      setContext({
        siteVisit: visit,
        materials: logisticsBody.materials || [],
        suggestedTo: visit ? emails([visit.organizer, ...(visit.requiredAttendees || [])]) : [],
        suggestedCc: visit ? emails(visit.optionalAttendees) : [],
      });
    }).catch(() => {
      if (!cancelled) setContext({ unavailable: true });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestId]);

  return context;
}
