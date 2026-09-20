/**
 * @jest-environment jsdom
 *
 * AwardeesPanel — T5 gap-fill (Stage 5a). tests/unit/awardees-page.test.js
 * already pins 2xx success, empty-cycle cycle-list behavior, and the GET
 * call-shape for both fetch sites (load, cycle list, migrated to
 * requestEnvelope/requestJson). This file adds network-rejection and axis
 * (e) coverage.
 *
 * Parse-error policy: `load` was a bare `.json()` with no catch (strict);
 * migrated to `requestEnvelope` with the default `tolerantBody: false`
 * (2xx strict, matching today's throw-on-malformed-2xx). The non-2xx path
 * is always tolerant per the helper's design, and coincidentally produces
 * the same fallback text as before ('Failed to load awardees.'), since the
 * pre-migration code already funneled any parse failure through the same
 * generic catch. `cycleList`'s `.json().catch(() => ({}))` stays tolerant
 * via `requestJson`.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }) => <a href={href}>{children}</a> }));

import AwardeesPanel from '../../shared/components/workbench/AwardeesPanel';

function Harness({ initial }) {
  const [state] = useState(initial);
  return (
    <AwardeesPanel
      cycleCode={state.cycleCode}
      loadingCycles={false}
      scope={state.scope}
      onScopeChange={() => {}}
      onCycleChange={() => {}}
    />
  );
}
function renderPanel(initial = {}) {
  return render(<Harness initial={{ cycleCode: 'J26', scope: 'my', ...initial }} />);
}

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderPanel();
  expect(await screen.findByText('Failed to load awardees.')).toBeInTheDocument();
});

test('load axis (e): non-2xx unparseable body falls to the generic message, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  renderPanel();
  expect(await screen.findByText('Failed to load awardees.')).toBeInTheDocument();
});

test('load: 2xx malformed body still throws (strict), same as today\'s bare .json()', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  renderPanel();
  expect(await screen.findByText('Failed to load awardees.')).toBeInTheDocument();
});
