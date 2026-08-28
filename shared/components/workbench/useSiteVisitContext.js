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
      fetch(`/api/workbench/site-visit/logistics?requestId=${encodeURIComponent(requestId)}`, {
        signal: controller.signal,
      }),
      fetch('/api/workbench/site-visit/recipients', { signal: controller.signal }),
    ]).then(async ([logisticsResponse, directoryResponse]) => {
      const logisticsBody = await logisticsResponse.json().catch(() => ({}));
      const directoryBody = await directoryResponse.json().catch(() => ({}));
      if (cancelled || !logisticsResponse.ok || !directoryResponse.ok) return;
      const visit = logisticsBody.siteVisit || null;
      const lookup = new Map([
        ...(directoryBody.staff || []).map((row) => [refKey(row), row]),
        ...(directoryBody.external || []).map((row) => [refKey(row), row]),
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
    }).catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestId]);

  return context;
}
