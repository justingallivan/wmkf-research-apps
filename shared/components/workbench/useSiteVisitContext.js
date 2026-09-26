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
    setContext(requestId ? {
      siteVisit: null,
      materials: [],
      suggestedTo: [],
      suggestedCc: [],
      presentationMaterialsStatus: 'loading',
      presentationMaterials: [],
      presentationMaterialConflicts: [],
    } : null);
    if (!requestId) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    const logistics = requestEnvelope(`/api/workbench/site-visit/logistics?requestId=${encodeURIComponent(requestId)}`, {
      signal: controller.signal,
      tolerantBody: true,
    });
    const directory = requestEnvelope('/api/workbench/site-visit/recipients', {
      signal: controller.signal,
      tolerantBody: true,
    }).catch(() => null);

    // Presentation materials are projected by the logistics read and become
    // visible as soon as that response succeeds. Recipient-directory failure
    // may suppress suggestions, but cannot erase a successfully loaded material.
    logistics.then((logisticsEnvelope) => {
      const logisticsBody = logisticsEnvelope.data;
      if (cancelled) return;
      if (!logisticsEnvelope.ok) {
        setContext((value) => value ? { ...value, presentationMaterialsStatus: 'unavailable' } : value);
        return;
      }
      const visit = logisticsBody.siteVisit || null;
      const projectionReady = logisticsBody.presentationMaterialsStatus === 'ready';
      setContext((value) => ({
        ...(value || {}),
        siteVisit: visit,
        materials: logisticsBody.materials || [],
        presentationMaterialsStatus: projectionReady ? 'loaded' : 'disabled',
        presentationMaterials: projectionReady ? (logisticsBody.presentationMaterials || []) : [],
        presentationMaterialConflicts: projectionReady ? (logisticsBody.presentationMaterialConflicts || []) : [],
      }));
      return directory.then((directoryEnvelope) => {
        if (cancelled || !directoryEnvelope?.ok) return;
        const directoryBody = directoryEnvelope.data;
        const lookup = new Map([
          ...(directoryBody.staff || []).map((row) => [refKey(row), row]),
          ...(directoryBody.external || []).map((row) => [refKey(row), row]),
        ]);
        const emails = (refs) => (refs || []).filter(Boolean).map((ref) => (
          ref.kind === 'manual' ? ref : lookup.get(refKey(ref))
        )).filter((row) => row?.email).map((row) => row.email);
        if (cancelled) return;
        setContext((value) => ({
          ...(value || {}),
          suggestedTo: visit ? emails([visit.organizer, ...(visit.requiredAttendees || [])]) : [],
          suggestedCc: visit ? emails(visit.optionalAttendees) : [],
        }));
      });
    }).catch(() => {
      if (!cancelled) {
        setContext((value) => value ? { ...value, presentationMaterialsStatus: 'unavailable' } : value);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestId]);

  return context;
}
