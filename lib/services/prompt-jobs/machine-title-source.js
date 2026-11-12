/** Same-Request field source. Caller establishes authorized DAL context; no document selection. */
import { getById } from '../../dataverse/adapters/grant-request.js';
import { isGuid } from '../../utils/guid.js';
import { canonical, sha256, PROFILE_LIMITS } from './profile.js';
import { prepareContextSnapshot } from './context.js';
import { validateMachineTitleProfile } from './machine-title-contract.js';
import { machinePilotError } from './machine-pilot-policy.js';

const SELECT = 'akoya_title,wmkf_abstract,wmkf_phaseistatus';
const ETAG = /^(?:W\/)?"[^"\r\n]+"$/;
const VERSION = 'request-title-abstract-v1';
export function createMachineTitleSource({ readRequest = getById } = {}) {
  async function load(requestId) {
    if (!isGuid(requestId) || requestId !== requestId.toLowerCase()) throw machinePilotError('machine_source_invalid',422);
    let row;
    try { row = await readRequest(requestId,{select:SELECT}); }
    catch { throw machinePilotError('machine_source_unavailable'); }
    if (!row || typeof row.akoya_title !== 'string' || row.akoya_title.trim().length < 3 || row.akoya_title.length > 600
      || typeof row.wmkf_abstract !== 'string' || row.wmkf_abstract.trim().length < 50 || row.wmkf_abstract.length > 20000
      || !Object.hasOwn(row,'wmkf_phaseistatus') || !(row.wmkf_phaseistatus === null || Number.isSafeInteger(row.wmkf_phaseistatus))
      || row.wmkf_phaseistatus === 100000003 || typeof row._etag !== 'string' || row._etag.length > 200 || !ETAG.test(row._etag)) {
      throw machinePilotError('machine_source_invalid',422);
    }
    const records = [
      {name:'source_title',present:true,value:row.akoya_title,provenance:`akoya_request:${requestId}:akoya_title`},
      {name:'source_abstract',present:true,value:row.wmkf_abstract,provenance:`akoya_request:${requestId}:wmkf_abstract`},
    ];
    if (records.some(record=>Buffer.byteLength(canonical(record)) > PROFILE_LIMITS.maxRecordBytes)) throw machinePilotError('machine_source_invalid',422);
    return {manifest:{version:VERSION,requestId,hash:sha256(canonical(records))},records,etag:row._etag};
  }
  function checkManifest(manifest) {
    if (!manifest || Object.keys(manifest).sort().join(',') !== 'hash,requestId,version' || manifest.version !== VERSION
      || !isGuid(manifest.requestId) || !/^[a-f0-9]{64}$/.test(manifest.hash || '')) throw machinePilotError('machine_source_invalid',422);
  }
  return {
    async inspect({requestId}) { return (await load(requestId)).manifest; },
    async isCurrent({manifest,expectedEtag}) {
      checkManifest(manifest);
      try {
        const current = await load(manifest.requestId);
        return canonical(current.manifest) === canonical(manifest) && (expectedEtag === undefined || current.etag === expectedEtag);
      } catch(error) { if (error.httpStatus === 422) return false; throw error; }
    },
    async prepare({manifest,scope,profile,nonceSecret}) {
      checkManifest(manifest); validateMachineTitleProfile(profile);
      if (scope.requestId !== manifest.requestId) throw machinePilotError('machine_source_invalid',422);
      const current = await load(manifest.requestId);
      if (canonical(current.manifest) !== canonical(manifest)) throw Object.assign(new Error('Source changed'),{code:'proposal_source_changed'});
      return prepareContextSnapshot({scope,profile,documents:[],records:current.records,nonceSecret});
    },
  };
}
