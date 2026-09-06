/**
 * Compatibility re-export. The implementation moved to
 * `lib/services/reviewer-engagement/terminal-transition.js` (Stage 3B). This
 * module re-exports the same objects — `instanceof` and reference identity
 * (`toBe`) hold across both import paths.
 */
export { TerminalTransitionError, transitionReviewersTerminal, _terminalTransitionInternals } from '../reviewer-engagement/terminal-transition';
