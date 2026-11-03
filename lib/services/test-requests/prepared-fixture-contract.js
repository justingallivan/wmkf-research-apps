/** Prepared J27+ Basic fixtures. Pure, manifest-bound opt-in; never inferred on resume. */
import crypto from 'node:crypto';
export const PREPARED_FIXTURE_CONTRACT = 'j27-reviewer-fixture/v1';
export const PREPARED_REQUIRED_DOCUMENTS = Object.freeze(['reviewerProposal']);
export function isPreparedCycle(code) {
  return typeof code === 'string' && /^[JD]\d{2}$/.test(code) && Number(code.slice(1)) >= 27;
}
export function hasPreparedFixtureContract(manifest) {
  return manifest?.values?.preparedFixture === PREPARED_FIXTURE_CONTRACT;
}
export function assertPreparedFixtureContract(manifest, run) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(manifest?.createBody)).digest('hex');
  const body = manifest?.createBody;
  if (!hasPreparedFixtureContract(manifest) || manifest.targetEnvironment !== 'production'
      || manifest.recipe !== 'basic' || !isPreparedCycle(manifest.values.cycleCode)
      || !manifest.values.grantCycleId || body?.wmkf_readyforreview !== false
      || Object.hasOwn(body, 'akoya_requeststatus') || hash !== manifest.createBodySha256
      || run.createBodySha256 !== hash || run.recipe !== 'basic' || run.destinationEnvironment !== 'production'
      || run.status !== 'ready' || run.destinationRequestId?.toLowerCase() !== manifest.values.requestId?.toLowerCase()
      || run.runId?.toLowerCase() !== manifest.values.runId?.toLowerCase()) {
    throw new Error('This is not a completed, manifest-bound prepared reviewer fixture.');
  }
  assertPreparedPackage(manifest.bundle);
}
export function assertPreparedPackage(bundle) {
  const docs = bundle?.documents;
  if (!Array.isArray(docs) || PREPARED_REQUIRED_DOCUMENTS.some(kind => docs.filter(d => d.kind === kind).length !== 1)
      || typeof bundle?.abstract !== 'string' || !bundle.abstract.trim()) {
    throw Object.assign(new Error('Prepared fixture requires an applicant abstract and canonical reviewer proposal.'), { code: 'factory_prepared_package_incomplete' });
  }
}
