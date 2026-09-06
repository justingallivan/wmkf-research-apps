/** @jest-environment node */

/**
 * Stage 3B: `lib/services/review-manager/terminal-transition-service.js` is
 * now a pure compatibility re-export of
 * `lib/services/reviewer-engagement/terminal-transition.js`. Both import
 * paths must resolve to the exact same objects — reference identity
 * (`toBe`) for the functions and the error class — so existing
 * callers/tests on the old path keep working unmodified.
 */

import {
  transitionReviewersTerminal as newTransitionReviewersTerminal,
  _terminalTransitionInternals as newInternals,
  TerminalTransitionError as NewTerminalTransitionError,
} from '../../lib/services/reviewer-engagement/terminal-transition';
import {
  transitionReviewersTerminal as oldTransitionReviewersTerminal,
  _terminalTransitionInternals as oldInternals,
  TerminalTransitionError as OldTerminalTransitionError,
} from '../../lib/services/review-manager/terminal-transition-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

describe('reviewer-engagement terminal-transition compatibility paths', () => {
  it('exports the same transitionReviewersTerminal function object from both paths', () => {
    expect(oldTransitionReviewersTerminal).toBe(newTransitionReviewersTerminal);
  });

  it('exports the same _terminalTransitionInternals object from both paths', () => {
    expect(oldInternals).toBe(newInternals);
  });

  it('exports the same TerminalTransitionError class from both paths', () => {
    expect(OldTerminalTransitionError).toBe(NewTerminalTransitionError);
  });

  it('an error thrown by the new-path transitionReviewersTerminal is instanceof both the old-path error class and ServiceHttpError', async () => {
    await expect(newTransitionReviewersTerminal({
      requestId: '11111111-1111-4111-8111-111111111111',
      suggestionIds: ['22222222-2222-4222-8222-222222222222'],
      terminalStatus: 'not_a_real_terminal_status',
      actingUserSystemId: '33333333-3333-4333-8333-333333333333',
    })).rejects.toBeInstanceOf(OldTerminalTransitionError);

    await expect(newTransitionReviewersTerminal({
      requestId: '11111111-1111-4111-8111-111111111111',
      suggestionIds: ['22222222-2222-4222-8222-222222222222'],
      terminalStatus: 'not_a_real_terminal_status',
      actingUserSystemId: '33333333-3333-4333-8333-333333333333',
    })).rejects.toBeInstanceOf(ServiceHttpError);
  });
});
