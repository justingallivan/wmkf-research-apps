/**
 * Fixed provider identity for the Virtual Review Panel's three governed slots.
 * Admin model selection may change the reviewed model within a slot's provider,
 * but may never change the slot's provider.
 */

export const REVIEW_PANEL_SEATS = Object.freeze([
  Object.freeze({
    key: 'seat.claude',
    label: 'Claude reviewer',
    vendor: 'anthropic',
    enabled: true,
    defaultModel: 'claude-fable-5-1',
  }),
  Object.freeze({
    key: 'seat.openai',
    label: 'OpenAI reviewer',
    vendor: 'openai',
    enabled: true,
    defaultModel: 'gpt-5.6-sol',
  }),
  Object.freeze({
    key: 'chair',
    label: 'Claude chair',
    vendor: 'anthropic',
    enabled: true,
    defaultModel: 'claude-opus-5',
  }),
]);

export function getReviewPanelSeat(key) {
  return REVIEW_PANEL_SEATS.find((seat) => seat.key === key) || null;
}

/**
 * Short display label for user-facing copy (Progress tab seat pills, worker
 * failure messages) — same seats as REVIEW_PANEL_SEATS, but the chair reads
 * as "Chair" rather than the config's own record-keeping `label` ("Claude
 * chair"), since the model identity is already shown alongside it.
 */
export function getReviewPanelSeatLabel(key) {
  if (key === 'chair') return 'Chair';
  return getReviewPanelSeat(key)?.label || key;
}
