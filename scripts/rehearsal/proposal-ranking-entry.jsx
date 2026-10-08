import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProposalRankingApp from '../../shared/components/proposal-ranking/ProposalRankingApp';

const originalFetch = window.fetch.bind(window);
const token = document.querySelector('meta[name="rehearsal-token"]').content;
let generation = Number(document.querySelector('meta[name="rehearsal-generation"]').content);
let profileId = 1;
let currentRoundId = null;
// This wrapper belongs only to the standalone bundle, never the live app.
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  if (url.origin !== window.location.origin || !['/api/proposal-ranking', '/rehearsal/reset', '/rehearsal/simulate'].includes(url.pathname)) {
    throw new Error('This rehearsal cannot contact live services.');
  }
  const requestGeneration = generation;
  const response = await originalFetch(url.href, { ...init, headers: { ...init.headers, 'x-rehearsal-token': token, 'x-rehearsal-profile': String(profileId), 'x-rehearsal-generation': String(requestGeneration) } });
  if (url.pathname === '/api/proposal-ranking' && response.ok && generation === requestGeneration) {
    const data = await response.clone().json();
    currentRoundId = data.mode === 'round' ? data.roundId : null;
  }
  return response;
};

function Rehearsal() {
  const [actor, setActor] = useState(1);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function control(kind) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (kind === 'simulate' && !currentRoundId) throw new Error('Open a rehearsal round first.');
      const response = await window.fetch(`/rehearsal/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roundId: currentRoundId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'The rehearsal action failed.');
      if (kind === 'reset') { generation = data.generation; currentRoundId = null; profileId = 1; setActor(1); }
      setVersion((value) => value + 1);
      setMessage(kind === 'reset' ? 'Rehearsal cleared. Start again with a blank slate.' : 'The two simulated PDs submitted both programs. Submit your own lists, then generate and publish each composite.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <section aria-label="Rehearsal controls" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <h1 className="text-xl font-semibold">Isolated Proposal Ranking rehearsal</h1>
      <p className="mt-2 text-sm">All proposals and participants here are fictional. The real ranking screen and service run against temporary memory. Nothing here changes December 2026 or colleagues’ submissions.</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>Review the sample pool and open a round.</li>
        <li>Rank and submit your SE and MR lists. Use <strong>Simulate other PD submissions</strong> for the other two participants.</li>
        <li>Generate and publish each composite, then reorder the meeting list.</li>
        <li><strong>Reset rehearsal</strong> clears everything here, even after publication.</li>
      </ol>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">Rehearsal view
          <select aria-label="Rehearsal view" value={actor} disabled={busy} onChange={(event) => { const id = Number(event.target.value); profileId = id; setActor(id); setVersion((value) => value + 1); setMessage(''); setError(''); }} className="mt-1 block rounded-md border border-amber-700 bg-white px-3 py-2 text-gray-900">
            <option value={1}>You — simulated facilitator and PD</option>
            <option value={2}>Simulated PD A</option>
            <option value={3}>Simulated PD B</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => control('simulate')} className="rounded-md bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50">Simulate other PD submissions</button>
        <button type="button" disabled={busy} onClick={() => control('reset')} className="rounded-md border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50">Reset rehearsal</button>
      </div>
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-800">{error}</p>}
    </section>
    {/* A reset or view switch discards component-local queues and reloads memory state. */}
    {!busy && <ProposalRankingApp key={`${actor}:${version}`} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Rehearsal />);
