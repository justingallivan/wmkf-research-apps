/** Manual superuser orchestration: claim → bounded read-only sources → fenced latest snapshot. */
import { claimCheck, finishCheck, interruptCheck } from './check-store';
import { collectSource, sourcesFor } from './check-sources';
export async function checkForUpdates(id, actorId) {
  const claim = await claimCheck(id, actorId);
  if (claim.cached) return claim.cached;
  try {
    const checkedAt = new Date().toISOString();
    const signal = AbortSignal.timeout(35000);
    const sources = sourcesFor(id);
    const reviewed = claim.previous.reviewRevision !== claim.reviewRevision;
    const collected = await Promise.all(sources.map(source=>{
      const prior = claim.previous.baselines?.[source.key];
      const baseline = reviewed && prior ? { ...prior, pending:false, changeFrom:undefined } : prior;
      return collectSource(source,baseline,signal,checkedAt);
    }));
    const baselines = {};
    collected.forEach((item,index)=>{if(item.baseline)baselines[sources[index].key]=item.baseline;});
    return await finishCheck(id, claim.token, { checkedAt, serviceVersion:claim.service.version, configuration:claim.service.data.configuration, reviewRevision:claim.reviewRevision, sources:collected.map(item=>item.result), baselines });
  } catch (error) {
    // If the database is unavailable, expiry remains the recovery mechanism.
    await interruptCheck(id,claim.token).catch(()=>{});
    throw error;
  }
}
