/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import useAdminUnsavedChangesGuard from '../../shared/components/admin/useAdminUnsavedChangesGuard';

const mockRouter = { beforePopState: jest.fn() };

jest.mock('next/router', () => ({
  useRouter: () => mockRouter,
}));

function Editor({ dirty, label }) {
  useAdminUnsavedChangesGuard(dirty, `Unsaved ${label}`);
  return <p>{label}</p>;
}

beforeEach(() => {
  mockRouter.beforePopState.mockClear();
  jest.restoreAllMocks();
});

test('one editor becoming clean cannot disable another dirty editor guard', () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const { rerender } = render(
    <>
      <Editor dirty label="Site Visit changes" />
      <Editor dirty label="Final Writeup changes" />
    </>,
  );
  expect(screen.getByText('Site Visit changes')).toBeInTheDocument();

  const combinedGuard = mockRouter.beforePopState.mock.calls.at(-1)[0];
  expect(combinedGuard()).toBe(false);
  expect(confirmSpy).toHaveBeenLastCalledWith('You have unsaved Admin changes. Leave without saving?');

  rerender(
    <>
      <Editor dirty={false} label="Site Visit changes" />
      <Editor dirty label="Final Writeup changes" />
    </>,
  );
  const remainingGuard = mockRouter.beforePopState.mock.calls.at(-1)[0];
  expect(remainingGuard()).toBe(false);
  expect(confirmSpy).toHaveBeenLastCalledWith('Unsaved Final Writeup changes');

  const dirtyUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirtyUnload);
  expect(dirtyUnload.defaultPrevented).toBe(true);
});
