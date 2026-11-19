/** Existing Production values verified by owner-run probe, 2026-11-19.
 * The final three values are reserved by the additive provisioning script;
 * readers/writers verify exact live labels before offering or accepting them.
 */
export const TRIAGE_REASONS = Object.freeze([
  { value: 682090001, label: 'Too applied/translational' },
  { value: 682090000, label: 'Limited impact' },
  { value: 682090003, label: 'Continuation/incremental' },
  { value: 682090002, label: 'Basic science question unclear' },
  { value: 682090004, label: 'Implementation/risk' },
  { value: 682090005, label: 'Overlap with existing funding' },
  { value: 682090006, label: 'Overlap with a recent Keck award' },
  { value: 682090007, label: 'Other' },
]);
export const OTHER_TRIAGE_REASON = 682090007;
