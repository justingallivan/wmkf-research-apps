import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProposalRankingApp from '../../shared/components/proposal-ranking/ProposalRankingApp';

const originalFetch = window.fetch.bind(window);
const token = document.querySelector('meta[name="rehearsal-token"]').content;
let generation = Number(document.querySelector('meta[name="rehearsal-generation"]').content);
const requestedProfile = Number(new URLSearchParams(window.location.search).get('profile') || 1);
const profileId = [1, 2, 3].includes(requestedProfile) ? requestedProfile : 1;
const identities = [
  { id: 1, name: 'Alex Rehearsal', role: 'Facilitator and PD' },
  { id: 2, name: 'Casey Sample', role: 'PD' },
  { id: 3, name: 'Morgan Example', role: 'PD' },
];
const identity = identities.find((person) => person.id === profileId);
document.title = `${identity.name} · Ranking rehearsal`;
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
      if (kind === 'reset') { generation = data.generation; currentRoundId = null; }
      setVersion((value) => value + 1);
      setMessage(kind === 'reset' ? 'Rehearsal cleared. Start again with a blank slate.' : 'The two simulated PDs submitted both programs. Submit your own lists, then generate and publish each composite.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <section aria-label="Rehearsal controls" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <h1 className="text-xl font-semibold">Isolated Proposal Ranking rehearsal</h1>
      <p className="mt-2 text-sm">All proposals and participants here are fictional. The real ranking screen and service run against temporary memory. Nothing here changes December 2026 or colleagues’ submissions.</p>
      <p className="mt-3 font-semibold">You are {identity.name} · {identity.role}</p>
      <p className="mt-1 text-sm">Use My rankings for your own lists, Facilitate to prepare drafts, and Meeting list for published orders.</p>
      <nav aria-label="Open rehearsal identities" className="mt-3 flex flex-wrap gap-3 text-sm">
        {identities.filter((person) => person.id !== profileId).map((person) => <a key={person.id} href={`/?profile=${person.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open {person.name} in a new tab</a>)}
      </nav>
      <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Rehearsal tools</summary>
      <p className="mt-2 text-sm">Simulate submits Casey’s and Morgan’s lists. Reset clears all rehearsal tabs; reload other tabs afterward.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => control('simulate')} className="rounded-md bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50">Simulate other PD submissions</button>
        <button type="button" disabled={busy} onClick={() => control('reset')} className="rounded-md border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50">Reset rehearsal</button>
      </div>
      </details>
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-800">{error}</p>}
    </section>
    {/* A reset or simulation discards component-local queues and reloads memory state. */}
    {!busy && <ProposalRankingApp key={`${profileId}:${version}`} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Rehearsal />);
