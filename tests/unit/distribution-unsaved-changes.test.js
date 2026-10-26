import React from 'react';
import Link from 'next/link';
import { render } from '@testing-library/react';
import useDistributionUnsavedChanges from '../../shared/components/workbench/useDistributionUnsavedChanges';
import { useRouter } from 'next/router';
jest.mock('next/router', () => ({ useRouter: jest.fn() }));
let router, handlers, pop;
function Editor({ dirty }) { useDistributionUnsavedChanges(dirty); return <><Link href="/workbench">Workbench</Link><a href="/document" target="_blank">Document</a></>; }
beforeEach(() => {
  handlers = {};
  router = { events: { on: jest.fn((name, handler) => { handlers[name] = handler; }), off: jest.fn(), emit: jest.fn() }, beforePopState: jest.fn(handler => { pop = handler; }) };
  useRouter.mockReturnValue(router);
  jest.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => jest.restoreAllMocks());
test('dirty edits block reload, shell links, programmatic routes and cancelled back navigation', () => {
  render(<Editor dirty />);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  expect(() => handlers.routeChangeStart('/workbench', {})).toThrow('Unsaved distribution email');
  const restore = jest.spyOn(window.history, 'pushState');
  expect(pop({ as: '/previous' })).toBe(false);
  expect(restore).toHaveBeenCalled();
  expect(window.confirm).toHaveBeenCalledTimes(2);
});
test('accepted navigation prompts once across delayed router events; clean state removes all guards', async () => {
  window.confirm.mockReturnValue(true);
  const view = render(<Editor dirty />);
  expect(pop({ as: '/workbench' })).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 5));
  handlers.routeChangeStart('/workbench', {});
  expect(window.confirm).toHaveBeenCalledTimes(1);
  // An approved or cancelled SPA attempt never disables native reload protection.
  const blockedReload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(blockedReload);
  expect(blockedReload.defaultPrevented).toBe(true);
  handlers.routeChangeError();
  window.confirm.mockReturnValue(false);
  expect(() => handlers.routeChangeStart('/workbench', {})).toThrow();
  view.rerender(<Editor dirty={false} />);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  expect(pop()).toBe(true);
  expect(router.events.off).toHaveBeenCalledWith('routeChangeStart', expect.any(Function));
});

test('recovery departure names loss of exact retry state', () => {
  function Recovery() { useDistributionUnsavedChanges(true, true); return null; }
  render(<Recovery />);
  expect(() => handlers.routeChangeStart('/elsewhere', {})).toThrow();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Reconcile the original email'));
});
test('pending or unconfirmed default mutation warns that the change may already be saved', () => {
  function Pending() { useDistributionUnsavedChanges(true, false, true); return null; }
  render(<Pending />);
  expect(() => handlers.routeChangeStart('/elsewhere', {})).toThrow();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('may already be saved'));
});
