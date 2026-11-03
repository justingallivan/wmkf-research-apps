#!/usr/bin/env node
/** Read-only, one-request reviewer-materials metadata probe. No file downloads.
 * DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/probe-reviewer-materials-availability.mjs <requestGuid>
 */
import { createRequire } from 'node:module';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { isGuid } from '../lib/utils/guid.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
const require = createRequire(import.meta.url);
require('../lib/dataverse/client.js').loadEnvLocal();
const [requestId, ...extra] = process.argv.slice(2);
if (!isGuid(requestId) || extra.length) throw new Error('Exactly one request GUID is required.');
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes'
  || !PRODUCTION_HOSTS.includes(new URL(process.env.DYNAMICS_URL).hostname.toLowerCase())) {
  throw new Error('Explicit Production read acknowledgment required.');
}
const requests = await import('../lib/dataverse/adapters/grant-request.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { listReviewerMaterialsWithAvailability } = await import('../lib/external/reviewer-materials.js');
const report = await withDalContext('probe-reviewer-materials-availability', async () => {
  const request = await requests.getById(requestId, { select: requests.SELECT_PROFILES.IDENTITY });
  if (!request?.akoya_requestid || !request.akoya_requestnum) throw new Error('Request identity unavailable.');
  const buckets = [];
  const result = await listReviewerMaterialsWithAvailability(requestId, request.akoya_requestnum, {
    listFiles: async (library, folder, options) => {
      const bucket = { library };
      buckets.push(bucket);
      try {
        const files = await GraphService.listFiles(library, folder, options);
        bucket.ok = true;
        bucket.fileCount = files.length;
        return files;
      } catch (error) {
        bucket.ok = false;
        bucket.code = error.code || 'unknown';
        bucket.status = error.status || error.statusCode || null;
        throw error;
      }
    },
  });
  return { checkedAt: new Date().toISOString(), readOnly: true, requestNumber: request.akoya_requestnum,
    buckets, unavailable: result.unavailable, unavailableSources: result.unavailableSources,
    reviewerFiles: result.files.map(({ name, size, source }) => ({ name, size, source })) };
});
console.log(JSON.stringify(report, null, 2));
