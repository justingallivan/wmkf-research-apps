/** Shared external-edition selection and byte verification; never changes staff current-artifact semantics. */
import { readPresentationVisibility } from './edition-store.js';
import { approvedEditionRows, editionMemberBytesMatch } from './edition-model.js';
import { ServiceHttpError } from '../service-http-error.js';

function unavailable() {
  return new ServiceHttpError('Presentation approval could not be checked. Try again.', { httpStatus: 503, code: 'presentation_approval_unavailable' });
}
async function read(requestId, dependencies) {
  try { return await (dependencies.readPresentationVisibility || readPresentationVisibility)(requestId); }
  catch { throw unavailable(); }
}
export async function externalPresentationRows(rows, requestId, legacySelector, dependencies) {
  const visibility = await read(requestId, dependencies);
  let selected;
  try { selected = visibility ? approvedEditionRows(rows, requestId, visibility) : legacySelector(rows, requestId); }
  catch { throw unavailable(); }
  const policy = visibility ? { version: Number(visibility.version), id: visibility.active_edition_id } : { version: null, id: null };
  return selected.map(row => ({ ...row, _presentationPolicy: policy }));
}
/** Check after Graph/body reads, so a withdrawn edition or enrollment during the read cannot be redirected. */
export async function requireUnchangedPresentationPolicy(row, requestId, dependencies) {
  if (!row?._presentationPolicy) return;
  const current = await read(requestId, dependencies);
  const expected = row._presentationPolicy;
  if (expected.version === null ? current !== null
    : !current || Number(current.version) !== expected.version || current.active_edition_id !== expected.id) {
    throw new ServiceHttpError('Presentation approval changed. Refresh the page.', { httpStatus: 404, code: 'presentation_approval_changed' });
  }
}
export function approvedMemberBytesMatch(row, media) {
  return editionMemberBytesMatch(row?._approvedEditionMember, media);
}
