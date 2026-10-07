/**
 * Pre-Site writeup visibility before group review.
 *
 * Until the writeup moves to group review (Pre-Site lifecycle FINAL), the lead
 * Program Director drafts alone: only the lead PD, Program Coordinators and
 * superusers see the draft's file in the apps; everyone else keeps the status
 * but never the file. Changing the draft (generate, regenerate, post-visit
 * editing, linking it into a distribution email) is the lead PD's or a
 * superuser's. App-level hiding only: SharePoint permissions are unchanged
 * (owner 2026-10-06; docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md
 * Stage 2).
 *
 * Every server surface that returns the Pre-Site file routes through
 * redactDraftWriteup / canSeeDraftWriteup; tests/unit/pre-site-writeup-visibility.test.js
 * enumerates them.
 */
import { isGuid } from '../../utils/guid.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';
import { FINAL_WRITEUP_PERSONA } from '../../../shared/config/finalWriteupPersonas.js';
import { resolveFinalWriteupPersonas } from '../final-writeup/persona-service.js';

const DRAFT_LIFECYCLES = new Set([
  REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
]);

const DEFAULT_DEPENDENCIES = Object.freeze({
  resolvePersonas: (actingUserSystemId) => resolveFinalWriteupPersonas(actingUserSystemId),
});

function normalizedId(value) {
  return isGuid(value) ? String(value).toLowerCase() : null;
}

/**
 * Resolves the viewer once per request. Program Coordinator status comes from
 * the Final Writeup staffing personas and fails closed: an unreadable or
 * disabled configuration means "not a coordinator". Superuser and lead-PD
 * access never depend on it.
 */
export async function resolveWriteupViewer(
  { isSuperuser = false, actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const actor = normalizedId(actingUserSystemId);
  if (isSuperuser === true) return { isSuperuser: true, actingUserSystemId: actor, isCoordinator: false };
  let isCoordinator = false;
  if (actor) {
    try {
      const projection = await dependencies.resolvePersonas(actor);
      isCoordinator = projection?.enabled === true
        && Array.isArray(projection.personas)
        && projection.personas.includes(FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR);
    } catch {
      isCoordinator = false;
    }
  }
  return { isSuperuser: false, actingUserSystemId: actor, isCoordinator };
}

export function isDraftWriteupLifecycle(lifecycleState) {
  return DRAFT_LIFECYCLES.has(lifecycleState);
}

export function canChangeDraftWriteup(viewer, leadProgramDirectorId) {
  if (viewer?.isSuperuser === true) return true;
  const lead = normalizedId(leadProgramDirectorId);
  return Boolean(lead && viewer?.actingUserSystemId && viewer.actingUserSystemId === lead);
}

export function canSeeDraftWriteup(viewer, leadProgramDirectorId) {
  if (viewer?.isCoordinator === true) return true;
  return canChangeDraftWriteup(viewer, leadProgramDirectorId);
}

/**
 * Returns a projected Pre-Site artifact unchanged when the viewer may see it
 * or it is past drafting; otherwise without its file, flagged `fileHidden` so
 * the page reports drafting rather than a missing document.
 */
export function redactDraftWriteup(artifact, viewer, leadProgramDirectorId) {
  if (!artifact || !isDraftWriteupLifecycle(artifact.lifecycleState)
    || canSeeDraftWriteup(viewer, leadProgramDirectorId)) {
    return artifact;
  }
  return { ...artifact, file: null, fileHidden: true };
}
