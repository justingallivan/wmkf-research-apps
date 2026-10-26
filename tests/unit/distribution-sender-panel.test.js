/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import DistributionSenderPanel from '../../shared/components/workbench/DistributionSenderPanel';
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('../../shared/components/workbench/PreSiteDistributionPanel', () => {
  const { useState } = require('react');
  return { __esModule: true, default: function MockDistributionPanel(props) {
    const [original] = useState(props.actorScope);
    return <div data-testid="scope" data-original={original} data-paused={props.authPaused} data-composer={props.composer}>{props.actorScope}</div>;
  } };
});
const identity = (id = 'A', email = 'a@example.org') => ({ status: 'authenticated', data: { user: { dynamicsSystemuserId: id, azureEmail: email } } });
test('initial loading mounts no private state; transient loading retains same sender; actual replacement clears memory', () => {
  useSession.mockReturnValue({ status: 'loading' });
  const view = render(<DistributionSenderPanel requestId="request" composer="dialog" />);
  expect(screen.queryByTestId('scope')).toBeNull();
  useSession.mockReturnValue(identity()); view.rerender(<DistributionSenderPanel requestId="request" composer="dialog" />);
  const original = screen.getByTestId('scope');
  useSession.mockReturnValue({ status: 'loading' }); view.rerender(<DistributionSenderPanel requestId="request" composer="dialog" />);
  expect(screen.getByTestId('scope')).toBe(original); expect(original).not.toBeVisible(); expect(original).toHaveAttribute('data-composer','hidden');
  useSession.mockReturnValue(identity()); view.rerender(<DistributionSenderPanel requestId="request" composer="dialog" />);
  expect(screen.getByTestId('scope')).toBe(original); expect(original).toBeVisible();
  useSession.mockReturnValue(identity('B', 'b@example.org')); view.rerender(<DistributionSenderPanel requestId="request" composer="dialog" />);
  expect(screen.getByTestId('scope')).not.toBe(original); expect(screen.getByTestId('scope')).toHaveTextContent('b:b@example.org');
  useSession.mockReturnValue({ status: 'unauthenticated' }); view.rerender(<DistributionSenderPanel requestId="request" />);
  expect(screen.queryByTestId('scope')).toBeNull();
});
