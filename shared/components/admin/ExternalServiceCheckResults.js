/** Plain-text evidence only. A source check never counts as a completed human review. */
import { Button } from '../Layout';
const labels = { baseline:'First check — baseline saved',changed:'Source changed',unchanged:'No change detected',unavailable:'Could not check' };
export default function ExternalServiceCheckResults({ check, serviceVersion, onReview }) {
  if (!check) return <p className="text-sm text-gray-600">No update check yet. A check gathers evidence; it does not complete a review.</p>;
  return <div className="space-y-4">
    {check.running && <p role="status" className="text-sm">A check is running. Reload results shortly.</p>}
    {check.interrupted && <p role="alert" className="text-sm text-amber-800">The previous check did not finish. Run another check; any earlier results below are retained.</p>}
    {check.checkedAt && <p className="text-sm text-gray-600">Last check: {new Date(check.checkedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} Pacific. Checks do not change review dates or provider settings.</p>}
    {check.serviceVersion && check.serviceVersion !== serviceVersion && <p className="text-sm text-amber-800">This service was edited after the check. Compare the findings with the current configuration.</p>}
    {(check.sources || []).map(source=><article key={source.key} className="rounded-lg border border-gray-200 p-4 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><h5 className="font-medium text-sm">{source.label}</h5><span className="text-sm">{labels[source.status] || 'Could not check'}{source.attention ? ' · Needs attention' : ''}</span></div>
      <p className="text-sm text-gray-600">{source.summary}</p>
      {source.comparedAt && <p className="text-xs text-gray-500">{source.status==='unavailable'?'Previous successful check':'Compared with'}: {new Date(source.comparedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} Pacific</p>}
      {!!source.lines?.length && <ul className="list-disc pl-5 text-sm space-y-1 break-words">{source.lines.map((line,i)=><li key={i}>{line}</li>)}</ul>}
      {source.status==='changed' && <details className="text-sm"><summary className="cursor-pointer">Previous evidence</summary><ul className="mt-2 list-disc pl-5 break-words">{(source.previousLines||[]).map((line,i)=><li key={i}>{line}</li>)}</ul><p className="mt-2 text-gray-600">Excerpts may not show every change. Read the full source before deciding.</p></details>}
      <a className="text-sm text-blue-700 underline" href={source.url} target="_blank" rel="noopener noreferrer">Open source</a>
    </article>)}
    {check.sources?.some(s=>s.status!=='unavailable') && <Button variant="outline" onClick={onReview}>Start review from findings</Button>}
  </div>;
}
