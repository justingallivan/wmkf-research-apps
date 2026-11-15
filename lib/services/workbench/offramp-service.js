/**
 * Workbench offramp control (alignment log D50, D51, D69, D70).
 *
 * Staff mark a J27 request Phase II Offramped (`wmkf_phaseiistatus =
 * 682090001`), undo it, and write the offramp justification
 * (`wmkf_offrampjustification`). The Phase II Status the request had just
 * before the offramp is kept in `wmkf_phaseiistatusbeforeofframp`, written in
 * the same request-ETag-guarded PATCH as the status, so the two never disagree.
 *
 * Rules:
 * - Offramp only from no Phase II Status or Pending Committee Review: staff do
 *   not offramp a request that already has a later Phase II outcome.
 * - Undo only while the status is Offramped. It restores the remembered value
 *   when that value is one of the two allowed starting points, and blank when
 *   nothing was remembered (an offramp set in AkoyaGO). Any other remembered
 *   value is refused rather than written back.
 * - The justification can be saved while the request is offramped, or while
 *   it still holds text (so it can be cleared after an undo).
 * - Every write is conditional on the version the caller read (412 → 409) and
 *   runs under the staff member's own identity (`actingUserSystemId`,
 *   `noFallback`). `beforeWrite` is the route's admission re-check.
 */
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isJ27ScopeCycle, PHASE_II_OFFRAMPED } from './j27-read-model';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';

export const PHASE_II_PENDING_COMMITTEE_REVIEW = 100000002;
export const OFFRAMP_JUSTIFICATION_MAX = 2000;

// Phase II Status values staff may offramp from, and that undo may restore.
const OFFRAMP_FROM = new Map([
  [null, 'no Phase II Status'],
  [PHASE_II_PENDING_COMMITTEE_REVIEW, 'Phase II Pending Committee Review'],
]);

const SELECT = 'akoya_requestid,wmkf_phaseiistatus,wmkf_phaseiistatusbeforeofframp,wmkf_offrampjustification';

const conflict = () => new ServiceHttpError(
  'This request changed. Review its current offramp status before trying again.', { httpStatus: 409 },
);
const refused = message => new ServiceHttpError(message, { httpStatus: 409 });

function describe(row) {
  const status = row.wmkf_phaseiistatus ?? null;
  const offramped = status === PHASE_II_OFFRAMPED;
  const remembered = row.wmkf_phaseiistatusbeforeofframp ?? null;
  const justification = row.wmkf_offrampjustification ?? '';
  return {
    offramped,
    statusLabel: row.wmkf_phaseiistatus_formatted
      || OFFRAMP_FROM.get(status) || null,
    canOfframp: OFFRAMP_FROM.has(status),
    canUndo: offramped && OFFRAMP_FROM.has(remembered),
    undoRestores: offramped && OFFRAMP_FROM.has(remembered) ? OFFRAMP_FROM.get(remembered) : null,
    justification,
    showJustification: offramped || justification !== '',
    version: row._etag ?? null,
  };
}

async function readRow(requestId) {
  const row = await getById(requestId, { select: SELECT, expand: linkedCycleExpand() }).catch(error => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  }
  return row;
}

export async function getOfframp(requestId) {
  return describe(await readRow(requestId));
}

/**
 * @param {{ requestId: string, action: 'offramp'|'undo'|'justification', version: string,
 *   justification?: string, actor: string, beforeWrite: () => Promise<void> }} input
 */
export async function saveOfframp({ requestId, action, version, justification, actor, beforeWrite }) {
  if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite is required');
  const row = await readRow(requestId);
  const current = describe(row);
  if (current.version !== version) throw conflict();

  let patch;
  if (action === 'offramp') {
    if (current.offramped) return;
    if (!current.canOfframp) {
      throw refused('This request already has a Phase II outcome, so it cannot be offramped here.');
    }
    patch = { wmkf_phaseiistatus: PHASE_II_OFFRAMPED, wmkf_phaseiistatusbeforeofframp: row.wmkf_phaseiistatus ?? null };
  } else if (action === 'undo') {
    if (!current.offramped) throw refused('This request is not offramped.');
    if (!current.canUndo) {
      throw refused('The earlier Phase II Status cannot be restored here. Change it in AkoyaGO.');
    }
    patch = { wmkf_phaseiistatus: row.wmkf_phaseiistatusbeforeofframp ?? null, wmkf_phaseiistatusbeforeofframp: null };
  } else if (action === 'justification') {
    if (typeof justification !== 'string' || justification.length > OFFRAMP_JUSTIFICATION_MAX) {
      throw new ServiceHttpError('A valid justification is required.', { httpStatus: 400 });
    }
    if (!current.showJustification) throw refused('Mark the request as offramped before writing a justification.');
    if (justification === current.justification) return;
    patch = { wmkf_offrampjustification: justification || null };
  } else {
    throw new ServiceHttpError('Unknown action.', { httpStatus: 400 });
  }

  await beforeWrite();
  try {
    await updateById(requestId, patch, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
  } catch (error) {
    if (error?.status === 412) throw conflict();
    throw error;
  }
}
