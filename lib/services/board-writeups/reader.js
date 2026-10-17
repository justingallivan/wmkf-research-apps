/** Request-scoped durable Board references for ordinary Workbench readers. */
import * as documents from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as OP, REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE } from '../../../shared/config/requestDocument.js';
import { fail } from './model.js';
export async function boardReferences(requestId, overrides = {}) {
  const d = { ready: () => process.env.BOARD_WRITEUP_SCHEMA_READY === 'on', find: id => documents.findByRequest(id, { artifactType: TYPE.BOARD_WRITEUP }), ...overrides };
  if (!d.ready()) return [];
  const result = await d.find(requestId);
  if (result.capped) fail('board_history_capped', 'The Board document history could not be loaded completely.', 503);
  return (result.records || []).filter(x => x._wmkf_request_value?.toLowerCase() === requestId.toLowerCase() && x.wmkf_artifacttype === TYPE.BOARD_WRITEUP && x.wmkf_operationstatus === OP.READY && x.wmkf_lifecyclestate === LIFE.BOARD_READY).map(x => {
    let url;
    try { url = new URL(x.wmkf_sharepointweburl); } catch { return null; }
    if (url.protocol !== 'https:' || !['appriver3651007194.sharepoint.com', 'appriver3651007194-my.sharepoint.com'].includes(url.hostname)) return null;
    return { documentId: x.wmkf_requestdocumentid, cycle: x.wmkf_cyclecode, filename: x.wmkf_filename, archivedAt: x.createdon, webUrl: url.href };
  }).filter(Boolean);
}
