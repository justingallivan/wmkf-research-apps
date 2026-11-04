/**
 * Read-only diagnosis of the review DOCX calendar's page-size mismatch.
 * Run only with explicit authorization for the target Dataverse calendar read:
 * DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/probe-review-docx-calendar.mjs
 * Reads cycle codes/Board dates twice (100 vs 500 rows per page). No filing,
 * settings, business-data writes, or LLM calls; OAuth token acquisition is POST.
 */
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { fetchWithTimeout } = await import('../lib/services/dynamics/http.js');
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const { currentYmdInTimeZone } = await import('../lib/utils/date-ymd.js');

try {
  await withDalContext('approved-review-docx-calendar-diagnostic', async () => {
    const token = await DynamicsService.getAccessToken();
    const params = new URLSearchParams({
      $select: 'wmkf_cyclecode,wmkf_meetingdate',
      $filter: "startswith(wmkf_cyclecode,'J') or startswith(wmkf_cyclecode,'D')",
      $top: '500',
    });
    const today = currentYmdInTimeZone(new Date());
    for (const pageSize of [100, 500]) {
      const response = await fetchWithTimeout(
        `${process.env.DYNAMICS_URL}/api/data/v9.2/wmkf_grantcycles?${params}`,
        { headers: { ...DynamicsService.buildHeaders(token), Prefer: `odata.include-annotations="*",odata.maxpagesize=${pageSize}` } },
        10_000,
      );
      if (!response.ok) throw new Error(`Calendar GET failed (${response.status}).`);
      const body = await response.json();
      if (!Array.isArray(body?.value)) throw new Error('Calendar response has no value array.');
      const modern = body.value.filter(row => /^[JD]\d{2}$/.test(row.wmkf_cyclecode));
      const paged = Boolean(body['@odata.nextLink']);
      console.log(JSON.stringify({
        pageSize, rows: body.value.length, paged, modernRows: modern.length,
        upcoming: modern.filter(row => row.wmkf_meetingdate >= today)
          .map(row => ({ code: row.wmkf_cyclecode, boardDate: row.wmkf_meetingdate })),
      }));
      if (pageSize === 500 && paged) process.exitCode = 1;
    }
  });
} catch (error) {
  console.error(error?.message || 'Calendar diagnostic failed.');
  process.exitCode = 1;
}
