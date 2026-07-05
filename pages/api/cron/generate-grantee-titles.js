/**
 * Cron: generate the house-style edited title for newly-Invited research proposals.
 *
 * Fires at the Phase I→II board flip (`wmkf_phaseistatus = Invited`) and fills the
 * EXISTING `akoya_request.wmkf_wmkfprojectdescription` (the board-summary "To [verb] …"
 * objective) ONLY when it is empty — never overwriting staff's manual curation.
 * See docs/GRANTEE_PORTAL_SPEC.md (D7) + docs/GRANTEE_PORTAL_BUILD_PLAN.md (chunk 7).
 *
 * Auth: Vercel CRON_SECRET (`verifyCronSecret`, matches all /api/cron/* routes).
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → verifyCronSecret (byte-untouched) → cycle/program validation →
 * model-override warm (route-level per the Stage 4 gate contract) →
 * withDalContext (historical label kept, same scope) → one service call →
 * result/error→HTTP mapping. Batch orchestration (write-when-empty + ETag
 * idempotency, bounded concurrency, time budget, per-row fail-soft) lives in
 * lib/services/cron/generate-grantee-titles-service.js.
 *
 * Scope: research grants only (`GRANTEE_RESEARCH_PROGRAM_IDS`), current open board
 * cycle by default; `?cycleCode=` overrides it (one-off backfill / a prior cycle / test).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { cycleCodeToOdataFilter } from '../../../lib/utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS } from '../../../shared/config/granteeResearchPrograms';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { runGranteeTitleGeneration } from '../../../lib/services/cron/generate-grantee-titles-service';

/**
 * Current open board cycle from today: first half of the year → the June meeting
 * (`Jyy`), second half → December (`Dyy`). The seasonal schedule only runs this
 * route in Apr–Jun / Oct–Dec, so this always resolves to the cycle in prep.
 * `?cycleCode=` overrides for a one-off backfill of a prior cycle.
 */
function currentCycleCode(now) {
  const month = now.getUTCMonth() + 1;
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  return (month <= 6 ? 'J' : 'D') + yy;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  const cycleCode = (typeof req.query?.cycleCode === 'string' && req.query.cycleCode.trim())
    || currentCycleCode(new Date());
  const cycleFilter = cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate');
  if (!cycleFilter) {
    return res.status(400).json({ error: `Invalid cycleCode "${cycleCode}" (expected e.g. J26 / D26).` });
  }
  if (!GRANTEE_RESEARCH_PROGRAM_IDS.length) {
    return res.status(500).json({ error: 'No research programs are configured.' });
  }

  // Warm model overrides BEFORE any model resolution (generateGranteeTitle →
  // executePrompt resolves the prompt's model) — required by check:model-override-warming.
  await loadModelOverrides();

  return withDalContext('grantee-titles-cron', async () => {
    try {
      const summary = await runGranteeTitleGeneration({ cycleCode, cycleFilter });
      return res.status(200).json(summary);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      throw err;
    }
  });
}
