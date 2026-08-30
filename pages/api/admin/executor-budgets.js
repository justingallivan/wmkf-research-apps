/**
 * API Route: /api/admin/executor-budgets
 *
 * Superuser-only read/publish shell for the append-only Executor budget
 * configuration. Clients submit the complete closed schema plus an
 * expectedVersion and UUID requestId; runtime callers never accept these
 * values from their own request bodies.
 */
import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  getExecutorBudgetConfig,
  publishExecutorBudgetConfig,
} from '../../../lib/services/executor-budget-service';
import { ServiceHttpError } from '../../../lib/services/service-http-error';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await withDalContext('admin-executor-budgets', async () => {
      try {
        if (req.method === 'GET') {
          return res.json(await getExecutorBudgetConfig({ strict: true }));
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const outcome = await publishExecutorBudgetConfig({
          budgets: body.budgets,
          expectedVersion: body.expectedVersion,
          requestId: body.requestId,
          profileId: gate.profileId,
        });
        return res.status(200).json(outcome);
      } catch (error) {
        if (error instanceof ServiceHttpError) {
          return res.status(error.httpStatus).json(error.body ?? {
            error: error.message,
            ...(error.code ? { code: error.code } : {}),
          });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('[admin/executor-budgets] unexpected error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
}
