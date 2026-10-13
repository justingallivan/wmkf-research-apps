import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AssessmentWorkflow from '../../shared/components/proposal-ranking/AssessmentWorkflow';
import {
  currentView,
  chooseActor,
  chooseFixture,
  seed,
  snapshot,
} from './proposal-ranking-v2-client';
function Rehearsal() {
  const [view, setView] = useState(currentView());
  const [key, setKey] = useState(0);
  const change = (next) => {
    setView(next);
    setKey((n) => n + 1);
  };
  return (
    <>
      <aside className="border-b bg-amber-50 px-4 py-3 text-sm">
        <strong>Fictional UI rehearsal · memory only</strong>
        <button className="ml-4 underline" onClick={() => change(chooseFixture(true))}>
          Load 100 proposals / 12 PDs
        </button>
        <button className="ml-4 underline" onClick={() => change(chooseFixture(false))}>
          Load four-card examples
        </button>
        <label className="ml-4">
          Viewing as{' '}
          <select
            value={view.viewer.systemUserId}
            onChange={(e) => change(chooseActor(e.target.value))}
          >
            {snapshot.roster.map((p) => (
              <option key={p.systemUserId} value={p.systemUserId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="ml-4 underline" onClick={() => change(seed(false))}>
          Start private preparation
        </button>
        <button className="ml-4 underline" onClick={() => change(seed(true))}>
          Show group examples
        </button>
      </aside>
      <AssessmentWorkflow
        key={key}
        initial={view}
        cycleOptions={[{ code: 'J27', label: 'J27 · Fictional' }]}
        onCycleChange={() => {}}
      />
    </>
  );
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Rehearsal />
  </React.StrictMode>,
);
