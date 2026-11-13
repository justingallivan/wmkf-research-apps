/**
 * Offline Summary edit-protection command builder; no I/O or runtime callers.
 * Neutral DTO keys are synthetic, NOT Dataverse columns. A future authorized
 * adapter must map text + staffEdited into ONE row PATCH with the exact ifMatch,
 * no fallback or version refresh. Every explicit staff save/clear calls this,
 * including unchanged text; omitted fields do not. Marker is never reset here.
 * captureSummaryBaseline is only a content guard, NOT admission: cohort,
 * authorization, source, reservation and external-writer coverage remain required.
 */
import { isConcreteEtag } from '../../utils/etag';
import { REQUEST_NARRATIVE_MAX_LENGTH } from '../../../shared/config/requestNarratives';

export function prepareSummaryStaffEdit({ text, version } = {}) {
  if (!isConcreteEtag(version) || (text !== null && typeof text !== 'string')
    || (typeof text === 'string' && text.length > REQUEST_NARRATIVE_MAX_LENGTH)) {
    throw new Error('invalid_summary_staff_edit');
  }
  return Object.freeze({
    ifMatch: version,
    patch: Object.freeze({ text: text === '' ? null : text, staffEdited: true }),
  });
}

export function captureSummaryBaseline(row) {
  if (!row || row.staffEdited !== false || !isConcreteEtag(row.version)
    || (row.text !== null && row.text !== '')) return null;
  // Copy scalars: later mutation of the read result cannot refresh this version.
  return Object.freeze({ ifMatch: row.version });
}
