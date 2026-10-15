import React from 'react';
import { createRoot } from 'react-dom/client';
import AssessmentWorkflow from '../../shared/components/proposal-ranking/AssessmentWorkflow';
import { loadProposalRanking } from './proposal-ranking-sandbox-client';
const root = createRoot(document.getElementById('root'));
loadProposalRanking().then(view => root.render(<React.StrictMode><aside className="border-b bg-amber-50 px-6 py-3 text-sm"><strong>Saved Dataverse sandbox rehearsal · fictional proposals</strong><p>Testing as {view.round.snapshot.roster.find(p => p.systemUserId === view.viewer.systemUserId)?.name}. Service persona; not a Microsoft sign-in. Each link opens an independent view.</p><nav className="flex gap-4">{view.round.snapshot.roster.map((p, i) => <a key={p.systemUserId} className="underline" href={`/p/${i}`} target="_blank" rel="noreferrer">{p.name}</a>)}</nav></aside><AssessmentWorkflow initial={view} cycleOptions={[{
    code: 'D98',
    label: 'D98 · Sandbox rehearsal'
  }]} onCycleChange={() => {}} /></React.StrictMode>)).catch(error => root.render(<p role="alert">{error.message}</p>));
