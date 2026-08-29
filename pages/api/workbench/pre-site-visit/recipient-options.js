/** Read-only, admin-curated recipient options for the Site Visit materials composer. */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { getCuratedRecipientOptions } from '../../../../lib/services/site-visit/curated-recipient-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  return withDalContext('workbench-pre-site-visit-recipient-options', async () => {
    try {
      const recipients = await getCuratedRecipientOptions();
      return res.status(200).json({ success: true, recipients });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
      }
      console.error('workbench Site Visit recipient options error:', error);
      return res.status(500).json({ error: 'The recipient options could not be loaded.' });
    }
  });
}
