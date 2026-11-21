/** Manual superuser orchestration: claim → bounded read-only sources → fenced latest snapshot. */
import { claimCheck, finishCheck } from './check-store';
import { collectSource, sourcesFor } from './check-sources';
export async function checkForUpdates(id, actorId) {
  const claim = await claimCheck(id, actorId);
  if (claim.cached) return claim.cached;
  const checkedAt = new Date().toISOString();
  const signal = AbortSignal.timeout(35000);
  const sources = sourcesFor(id);
  const collected = await Promise.all(sources.map(source=>collectSource(source,claim.previous.baselines?.[source.key],signal,checkedAt)));
  const baselines = {};
  collected.forEach((item,index)=>{if(item.baseline)baselines[sources[index].key]=item.baseline;});
  return finishCheck(id, claim.token, { checkedAt, serviceVersion:claim.service.version, configuration:claim.service.data.configuration, sources:collected.map(item=>item.result), baselines });
}
