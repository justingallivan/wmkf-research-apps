/** One Profile Settings owner for router Back, route, unload and context prompts. */
import useUnsavedChanges, { thankYouDiscardMessage } from './useReviewerThankYouDefaultsUnsavedChanges';
export default function useReviewerEmailDefaultsGuard(...controllers) {
  const states = controllers.map(controller => controller.guardState).filter(Boolean);
  const guarding = states.some(state => state.guarding);
  const pending = states.some(state => state.guarding && state.pending);
  const confirmedReload = states.some(state => state.guarding && state.confirmedReload);
  useUnsavedChanges(guarding, pending, confirmedReload);
  return () => {
    if (guarding && !window.confirm(thankYouDiscardMessage(pending, confirmedReload))) return false;
    for (const controller of controllers) controller.resetWithoutPrompt();
    return true;
  };
}
