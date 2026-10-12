// The Site Visit page header's one status chip (docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md §3 and the
// mapping table in §10): where the visit stands, taken from the first stage not yet finished. It summarizes what the
// Applicant materials card and the Board materials readiness list already show; each card reports its own state, so
// the chip never re-derives it from a different read.
//
// materials: { key, overdue } from SiteVisitMaterialsCard, where key is one of 'unavailable', 'not_requested',
//   'missing', 'processing', 'needs_attention', 'received', 'ready', 'closed'.
// recording: { available, hasTranscript, board } from the Recording and transcript cards, where board lists the shown
//   readiness lines as 'on', 'not_yet', 'unknown' or 'pending' (still loading).
// Returns { label, tone } with ArtifactRow tones, or null while either card has not reported.

const UNKNOWN = Object.freeze({ label: 'Status unknown', tone: 'gray' });

export function resolveSiteVisitHeaderStatus(materials, recording) {
  if (!materials || !recording) return null;
  switch (materials.key) {
    case 'not_requested': return { label: 'Materials not requested', tone: 'gray' };
    case 'missing': return { label: 'Waiting on materials', tone: materials.overdue ? 'amber' : 'gray' };
    case 'processing': return { label: 'Waiting on materials', tone: 'gray' };
    case 'needs_attention':
    case 'received': return { label: 'Materials need attention', tone: 'amber' };
    case 'ready':
    case 'closed': break;
    default: return UNKNOWN;
  }
  if (!recording.available) return UNKNOWN;
  if (!recording.hasTranscript) return { label: 'No recording yet', tone: 'gray' };
  const board = Array.isArray(recording.board) ? recording.board : [];
  if (board.includes('pending')) return null;
  if (board.length === 0 || board.includes('unknown')) return UNKNOWN;
  if (board.includes('not_yet')) return { label: 'Board page incomplete', tone: 'amber' };
  return { label: 'Board page ready', tone: 'green' };
}
