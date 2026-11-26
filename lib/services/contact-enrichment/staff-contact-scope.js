/** A Find contact can be staff-verified on a request linked to J27 and Research.
 * Resolve both fields together on the Dataverse request. Read errors propagate
 * so enrichment cannot fall back to treating a failed check as an ordinary lead.
 */
import { withDalContext } from '../../dataverse/core/context';
import { findByIds } from '../../dataverse/adapters/grant-request';
import { linkedCycleFilter } from '../../dataverse/adapters/operations-grant-cycle';
import { GUID_RE } from '../../utils/guid';

export async function staffContactRequestEnabled(requestId) {
  if (typeof requestId !== 'string' || !GUID_RE.test(requestId)) return false;
  return withDalContext('reviewer-find-staff-contact-scope', async () => {
    const { records } = await findByIds([requestId], {
      select: ['akoya_requestid'],
      filter: `${linkedCycleFilter('J27')} and wmkf_GrantProgram/wmkf_name eq 'Research'`,
    });
    return records.some(request => request.akoya_requestid?.toLowerCase() === requestId.toLowerCase());
  });
}
