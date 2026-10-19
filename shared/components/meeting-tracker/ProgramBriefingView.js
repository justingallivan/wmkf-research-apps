import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout, { Button } from '../Layout';
import ToolbarSelect from '../ToolbarSelect';
import { useProfile } from '../../context/ProfileContext';
import { requestEnvelope } from '../../utils/api-request';

const missing = {
  missing: 'No published summary yet.',
  out_of_date: 'The saved summary is out of date. Review and publish an updated summary in the Site Visit.',
  unavailable: 'This summary could not be verified or loaded. Refresh to try again.',
};
const sentimentMissing = {
  none: 'No accepted, current analysis is available. Analyze and accept it in Discussion Sentiment.',
  out_of_date: 'The accepted analysis is out of date. Review and accept an updated analysis in Discussion Sentiment.',
  unavailable: 'The analysis could not be loaded. Refresh to try again.',
};

function Summary({ title, value, requestId }) {
  return <section className="briefing-block mt-5">
    <h4 className="mb-2 text-sm font-semibold text-gray-900">{title}</h4>
    {value?.status === 'current' ? <>
      <p className="max-w-prose whitespace-pre-line text-sm leading-6 text-gray-800">{value.text}</p>
      <p className="briefing-controls mt-2 text-xs text-gray-600">
        {value.excerpt ? 'Opening excerpt. ' : 'From the published summary. '}
        <Link href={`/workbench/read?request=${encodeURIComponent(requestId)}&document=${encodeURIComponent(value.documentId)}`} className="rounded underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Read full summary</Link>
      </p>
    </> : <p className="text-sm leading-6 text-gray-600">{missing[value?.status] || missing.unavailable}</p>}
  </section>;
}

function EvidenceList({ title, items, empty }) {
  return <section className="briefing-block">
    <h4 className="mb-2 text-sm font-semibold text-gray-900">{title}</h4>
    {items.length ? <ul className="space-y-3">
      {items.slice(0, 3).map((item, index) => <li key={index} className="text-sm leading-6 text-gray-800">
        <q>{item.quote}</q><span className="ml-1 text-xs text-gray-600">{item.speaker || item.speakerLabel || 'Unidentified speaker'} · {item.time}</span>
      </li>)}
      {items.length > 3 && <li className="text-xs text-gray-600">{items.length - 3} more in the full analysis.</li>}
    </ul> : <p className="text-sm leading-6 text-gray-600">{empty}</p>}
  </section>;
}

function Proposal({ proposal }) {
  const record = proposal.discussion?.status === 'current' ? proposal.discussion.sentiment : null;
  const questions = [
    ...(record?.uncertainties || []).map((item) => ({ topic: item.topic, type: 'Uncertainty' })),
    ...(record?.disagreements || []).map((item) => ({ topic: item.topic, type: 'Staff disagreement' })),
  ];
  return <article className="briefing-proposal border-t border-gray-200 py-8" aria-labelledby={`proposal-${proposal.requestId}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <h3 id={`proposal-${proposal.requestId}`} className="min-w-0 text-xl font-semibold leading-7 text-gray-900">{proposal.institution || 'Institution unavailable'}</h3>
      <p className="text-sm tabular-nums text-gray-600">Request {proposal.requestNumber}</p>
    </div>
    <p className="mt-1 text-base font-medium leading-6 text-gray-800">{proposal.title}</p>
    {proposal.projectLeader && <p className="mt-1 text-sm text-gray-600">Project leader: {proposal.projectLeader}</p>}
    <Summary title="Proposal overview" value={proposal.proposalSummary} requestId={proposal.requestId} />
    <Summary title="Staff discussion" value={proposal.discussionSummary} requestId={proposal.requestId} />
    {record ? <>
      <p className="briefing-block mt-5 text-sm leading-6 text-gray-800"><strong>Staff reception: {record.reception}; {record.enthusiasm} enthusiasm.</strong> {record.headline}</p>
      <div className="briefing-signals mt-5 grid gap-6 md:grid-cols-3">
        <EvidenceList title="Main positives" items={record.supportPoints || []} empty="No positive points recorded in the accepted analysis." />
        <EvidenceList title="Main concerns" items={record.concernPoints || []} empty="No concerns recorded in the accepted analysis." />
        <section className="briefing-block">
          <h4 className="mb-2 text-sm font-semibold text-gray-900">Unresolved questions</h4>
          {questions.length ? <ul className="space-y-3">{questions.slice(0, 4).map((item, index) => <li key={index} className="text-sm leading-6 text-gray-800">{item.topic}<span className="block text-xs text-gray-600">{item.type}</span></li>)}
            {questions.length > 4 && <li className="text-xs text-gray-600">{questions.length - 4} more in the full analysis.</li>}
          </ul> : <p className="text-sm leading-6 text-gray-600">No uncertainties or disagreements recorded in the accepted analysis.</p>}
        </section>
      </div>
    </> : <p className="briefing-block mt-5 text-sm leading-6 text-gray-600"><strong>Positives, concerns, and unresolved questions: </strong>{sentimentMissing[proposal.discussion?.status] || sentimentMissing.unavailable}</p>}
    <p className="briefing-controls mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-gray-700">
      <Link href={`/meeting-tracker/visits/${proposal.requestId}`} className="rounded underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Open Site Visit</Link>
      <Link href="/meeting-tracker/discussion-sentiment" className="rounded underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Review full sentiment analysis</Link>
    </p>
  </article>;
}

export default function ProgramBriefingView() {
  const { currentProfile } = useProfile();
  return <Briefing key={currentProfile?.id || 'loading'} profileId={currentProfile?.id} />;
}

function Briefing({ profileId }) {
  const [cycles, setCycles] = useState([]);
  const [cycleCode, setCycleCode] = useState('');
  const [resource, setResource] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [catalogReload, setCatalogReload] = useState(0);
  const data = resource?.cycleCode === cycleCode && resource?.profileId === profileId ? resource.body : null;

  useEffect(() => {
    let active = true;
    requestEnvelope('/api/meeting-tracker/program-briefing').then(({ ok, data: body }) => {
      if (!active) return;
      if (!ok) throw new Error(body?.error || 'The grant cycles could not be loaded.');
      setCycles(body.cycles || []); setCycleCode(body.defaultCycleCode || '');
      if (!body.defaultCycleCode) setLoading(false);
    }).catch((failure) => { if (active) { setError(failure.message || 'The grant cycles could not be loaded.'); setLoading(false); } });
    return () => { active = false; };
  }, [profileId, catalogReload]);

  useEffect(() => {
    if (!cycleCode) return undefined;
    let active = true;
    requestEnvelope(`/api/meeting-tracker/program-briefing?cycleCode=${encodeURIComponent(cycleCode)}`).then(({ ok, data: body }) => {
      if (!active) return;
      if (!ok) throw new Error(body?.error || 'The briefing could not be loaded.');
      setResource({ cycleCode, profileId, body }); setLoading(false);
    }).catch((failure) => { if (active) { setError(failure.message || 'The briefing could not be loaded.'); setLoading(false); } });
    return () => { active = false; };
  }, [cycleCode, profileId, reload]);

  const total = data?.groups?.reduce((sum, group) => sum + group.proposals.length, 0) || 0;
  const gaps = data?.groups?.flatMap((group) => group.proposals).filter((p) => p.proposalSummary.status !== 'current' || p.discussionSummary.status !== 'current' || p.discussion.status !== 'current').length || 0;
  const refresh = () => { setResource(null); setError(''); setLoading(true); if (cycleCode) setReload((value) => value + 1); else setCatalogReload((value) => value + 1); };

  return <Layout title="Program briefing" maxWidth="6xl">
    <div className="program-briefing">
      <div className="briefing-controls mb-6 pt-8">
        <Link href="/meeting-tracker" className="rounded text-sm text-gray-600 underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Meeting Tracker</Link>
        <h1 className="mt-3 text-2xl font-semibold leading-8 text-gray-900">Program briefing</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">The proposal and the staff discussion, together for each grant program.</p>
      </div>
      <div className="briefing-controls mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <ToolbarSelect id="briefing-cycle" label="Grant cycle" value={cycleCode} disabled={!cycles.length} onChange={(event) => { setResource(null); setError(''); setLoading(true); setCycleCode(event.target.value); }}>
            {!cycles.length && <option value="">{loading ? 'Loading cycles…' : 'No cycles available'}</option>}
            {cycles.map((cycle) => <option key={cycle.code} value={cycle.code}>{cycle.label}</option>)}
          </ToolbarSelect>
          <Button type="button" variant="outline" className="min-h-12" onClick={refresh} disabled={loading}>Refresh briefing</Button>
        </div>
        <Button type="button" className="min-h-12" disabled={loading || !data || !total} onClick={() => window.print()}>Print / save PDF</Button>
      </div>
      <div className="briefing-controls mb-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700">
        <Link href="/meeting-tracker/discussion-sentiment" className="rounded underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Discussion Sentiment</Link>
      </div>
      {loading && <div role="status" className="space-y-8 bg-white p-8">
        <span className="sr-only">Loading proposal summaries and staff discussion…</span>
        <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
          <div className="h-6 w-64 max-w-full rounded bg-gray-200" />
          <div className="h-4 max-w-2xl rounded bg-gray-200" />
          <div className="h-4 max-w-xl rounded bg-gray-200" />
          <div className="h-4 max-w-2xl rounded bg-gray-200" />
        </div>
      </div>}
      {error && <div role="alert" className="py-8"><p className="text-gray-800">{error}</p><Button type="button" variant="outline" className="mt-4" onClick={refresh}>Try again</Button></div>}
      {!loading && !error && !cycles.length && <p className="py-10 text-gray-600">No SE or MR proposals are available for a briefing.</p>}
      {data && <div className="briefing-document bg-white px-5 py-7 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-semibold leading-8 text-gray-900">{data.cycleLabel} program briefing</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">Staff only · {total} proposal{total === 1 ? '' : 's'} · Loaded {new Date(data.loadedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <p className="mt-3 max-w-prose text-sm leading-6 text-gray-600">Published summary excerpts and accepted, current sentiment. Quotes reflect staff discussion; they are not independent evaluations. Advancing and Phase II Pending research proposals are included; set-aside proposals are excluded.</p>
        {gaps > 0 && <p className="mt-3 text-sm leading-6 text-gray-800">{gaps} proposal{gaps === 1 ? ' has' : 's have'} missing, out-of-date, or unavailable material. Gaps are marked below.</p>}
        <nav aria-label="Briefing programs" className="briefing-controls mt-5 flex flex-wrap gap-5 text-sm font-semibold text-gray-800">{data.groups.map((group) => <a key={group.key} href={`#briefing-${group.key}`} className="rounded underline underline-offset-4 focus-visible:outline focus-visible:outline-2">{group.key.toUpperCase()} · {group.proposals.length} proposals</a>)}</nav>
        {data.groups.map((group) => <section id={`briefing-${group.key}`} key={group.key} className="briefing-program mt-10 scroll-mt-6" aria-labelledby={`heading-${group.key}`}>
          <h2 id={`heading-${group.key}`} className="mb-5 text-xl font-semibold text-gray-900">{group.name} ({group.key.toUpperCase()})</h2>
          {group.proposals.length ? group.proposals.map((proposal) => <Proposal key={proposal.requestId} proposal={proposal} />) : <p className="text-sm leading-6 text-gray-600">No eligible proposals in this program for this cycle.</p>}
        </section>)}
      </div>}
    </div>
    <style jsx global>{`
      @media print {
        @page { margin: 16mm; }
        header, .briefing-controls { display: none !important; }
        body, main, .program-briefing, .briefing-document { background: white !important; color: black !important; }
        main, main > div, .briefing-document { margin: 0 !important; padding: 0 !important; max-width: none !important; }
        .briefing-program + .briefing-program { break-before: page; margin-top: 0; }
        .briefing-program { margin-top: 18pt; }
        .briefing-proposal { break-inside: avoid; padding: 14pt 0; }
        .briefing-block { margin-top: 10pt; }
        .briefing-signals { margin-top: 12pt; }
        .briefing-block, h1, h2, h3, h4 { break-inside: avoid; }
        h1, h2, h3, h4 { break-after: avoid; }
        p, li { orphans: 3; widows: 3; }
        .briefing-signals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18pt; }
        .briefing-document { font-size: 9.5pt; }
        .briefing-document .text-sm { font-size: 9.5pt; line-height: 1.4; }
        .briefing-document .text-xs { font-size: 8pt; line-height: 1.35; }
        .briefing-document .text-base { font-size: 10.5pt; line-height: 1.4; }
        .briefing-document .text-xl { font-size: 13pt; line-height: 1.35; }
        .briefing-document h1 { font-size: 17pt; line-height: 1.3; }
        .briefing-document a { color: inherit; text-decoration: none; }
      }
    `}</style>
  </Layout>;
}
